"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyMonarchSync = exports.syncBalancesOnDemand = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const monarch_money_ts_1 = require("monarch-money-ts");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)("raju-planner");
function parseAccountRules() {
    const defaults = {
        include: [],
        exclude: ["529", "education"],
        spouse: ["spouse"],
        retirement: [],
        taxable: [],
    };
    const rawRules = process.env.MONARCH_ACCOUNT_RULES;
    if (!rawRules)
        return defaults;
    try {
        const configured = JSON.parse(rawRules);
        return {
            include: configured.include ?? defaults.include,
            exclude: configured.exclude ?? defaults.exclude,
            spouse: configured.spouse ?? defaults.spouse,
            retirement: configured.retirement ?? defaults.retirement,
            taxable: configured.taxable ?? defaults.taxable,
        };
    }
    catch {
        throw new Error("MONARCH_ACCOUNT_RULES must be valid JSON.");
    }
}
function matchesRule(value, rules) {
    return rules.some((rule) => rule.trim() !== "" && value.includes(rule.toLowerCase()));
}
/**
 * Helper to fetch accounts using raw GraphQL request to bypass strict Zod validation failures
 * on fields like logoUrl and institution that might be null in the user's Monarch account.
 */
async function fetchAccountsRaw(auth, client) {
    const query = `
    query Web_GetAccounts($filters: AccountFilters) {
      accounts(filters: $filters) {
        id
        displayName
        name
        type {
          name
        }
        subtype {
          display
        }
        currentBalance
        institution {
          name
        }
      }
    }
  `;
    const doRequest = async () => {
        const token = await auth.getToken();
        const headers = (0, monarch_money_ts_1.buildAuthHeaders)(token);
        const raw = await client.client.request(query, {}, headers);
        return raw.accounts || [];
    };
    try {
        return await doRequest();
    }
    catch (err) {
        const isAuthErr = client.isAuthError(err);
        if (isAuthErr) {
            console.info("Monarch authentication expired; refreshing credentials and retrying.");
            await auth.invalidate();
            return await doRequest();
        }
        throw err;
    }
}
/**
 * Common logic to authenticate with Monarch Money, pull Fidelity account balances,
 * and update Firestore inputs for the specified user document.
 */
async function performMonarchSync(userId) {
    const email = process.env.MONARCH_EMAIL;
    const password = process.env.MONARCH_PASSWORD;
    const totpKey = process.env.MONARCH_MFA_SECRET;
    if (!email || !password) {
        throw new Error("Monarch credentials are not configured in environment secrets.");
    }
    console.info("Initializing Monarch Money client.");
    const auth = new monarch_money_ts_1.EmailPasswordAuthProvider({
        email,
        password,
        totpKey,
    });
    const client = new monarch_money_ts_1.MonarchGraphQLClient();
    console.info("Fetching accounts from Monarch.");
    const accounts = await fetchAccountsRaw(auth, client);
    const accountRules = parseAccountRules();
    console.info(`Fetched ${accounts.length} accounts from Monarch.`);
    // Restrict synchronization to the configured institutions and account names.
    const targetAccounts = accounts.filter((acc) => {
        const instName = acc.institution?.name?.toLowerCase() || "";
        const accName = acc.name?.toLowerCase() || "";
        const dispName = acc.displayName?.toLowerCase() || "";
        const searchableName = `${instName} ${accName} ${dispName}`;
        if (matchesRule(searchableName, accountRules.exclude))
            return false;
        const isFidelity = instName.includes("fidelity") || accName.includes("fidelity") || dispName.includes("fidelity");
        return isFidelity || matchesRule(searchableName, accountRules.include);
    });
    console.info(`Found ${targetAccounts.length} relevant accounts.`);
    let total401k = 0;
    let total401kSpouse = 0;
    let totalRoth = 0;
    let totalRothSpouse = 0;
    let totalHsa = 0;
    let totalTaxable = 0;
    let totalTaxableSpouse = 0;
    let has401k = false;
    let has401kSpouse = false;
    let hasRoth = false;
    let hasRothSpouse = false;
    let hasTaxable = false;
    let hasTaxableSpouse = false;
    let appliedAccountsCount = 0;
    targetAccounts.forEach((acc) => {
        const name = (acc.name || "").toLowerCase();
        const displayName = (acc.displayName || "").toLowerCase();
        const searchableName = `${name} ${displayName}`;
        const isSpouse = matchesRule(searchableName, accountRules.spouse);
        const subtypeName = (acc.subtype?.display || "").toLowerCase();
        const typeName = (acc.type?.name || "").toLowerCase();
        // Explicit Overrides for specific accounts
        let isRoth = false;
        let isHsa = false;
        let is401k = false;
        let isTaxable = false;
        if (matchesRule(searchableName, accountRules.taxable)) {
            isTaxable = true;
        }
        else if (matchesRule(searchableName, accountRules.retirement)) {
            is401k = true;
        }
        else {
            // Standard matching logic
            isRoth = subtypeName === "roth" || subtypeName === "roth_ira" || name.includes("roth") || displayName.includes("roth");
            isHsa = subtypeName === "hsa" || name.includes("hsa") || displayName.includes("hsa") || name.includes("health savings") || displayName.includes("health savings");
            is401k = !isRoth && !isHsa && (subtypeName === "401k" ||
                subtypeName === "401a" ||
                subtypeName === "403b" ||
                subtypeName === "sep_ira" ||
                subtypeName === "simple_ira" ||
                subtypeName === "traditional_ira" ||
                subtypeName === "retirement" ||
                name.includes("401k") ||
                name.includes("401(k)") ||
                name.includes("deferred") ||
                name.includes("defined contribution") ||
                name.includes("traditional") ||
                name.includes("ira") ||
                displayName.includes("401k") ||
                displayName.includes("401(k)") ||
                displayName.includes("deferred") ||
                displayName.includes("defined contribution") ||
                displayName.includes("traditional") ||
                displayName.includes("ira"));
            isTaxable = !isRoth && !isHsa && !is401k && (subtypeName === "brokerage" ||
                subtypeName === "investment" ||
                name.includes("brokerage") ||
                name.includes("taxable") ||
                name.includes("individual") ||
                name.includes("joint") ||
                displayName.includes("brokerage") ||
                displayName.includes("taxable") ||
                displayName.includes("individual") ||
                displayName.includes("joint"));
        }
        const balance = Number(acc.currentBalance ?? 0);
        if (!Number.isFinite(balance)) {
            console.warn("Skipped an account with a non-numeric current balance.");
            return;
        }
        if (isRoth) {
            if (isSpouse) {
                totalRothSpouse += balance;
                hasRothSpouse = true;
            }
            else {
                totalRoth += balance;
                hasRoth = true;
            }
            appliedAccountsCount++;
        }
        else if (isHsa) {
            // HSA totals are computed but never persisted (manual entry preserved),
            // so HSA accounts do not count as applied.
            totalHsa += balance;
        }
        else if (is401k) {
            if (isSpouse) {
                total401kSpouse += balance;
                has401kSpouse = true;
            }
            else {
                total401k += balance;
                has401k = true;
            }
            appliedAccountsCount++;
        }
        else if (isTaxable) {
            if (isSpouse) {
                totalTaxableSpouse += balance;
                hasTaxableSpouse = true;
            }
            else {
                totalTaxable += balance;
                hasTaxable = true;
            }
            appliedAccountsCount++;
        }
        else {
            // Fallback: treat general investments as taxable brokerage if unmatched
            if (typeName === "investment") {
                if (isSpouse) {
                    totalTaxableSpouse += balance;
                    hasTaxableSpouse = true;
                }
                else {
                    totalTaxable += balance;
                    hasTaxable = true;
                }
                appliedAccountsCount++;
            }
        }
    });
    console.info("Calculated aggregated balances for matched account categories.");
    // Write to Firestore
    const docRef = db.collection("user_configs").doc(userId);
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        if (!doc.exists) {
            throw new Error(`User configuration document not found for user ID: ${userId}`);
        }
        const docData = doc.data() || {};
        const configState = docData.config || {};
        const inputs = configState.inputs || {};
        // Update balances (convert to rounded string since UI expects matching values)
        if (has401k)
            inputs.k401Balance = String(Math.round(total401k));
        if (has401kSpouse)
            inputs.k401BalanceSpouse = String(Math.round(total401kSpouse));
        if (hasRoth)
            inputs.rothBalance = String(Math.round(totalRoth));
        if (hasRothSpouse)
            inputs.rothBalanceSpouse = String(Math.round(totalRothSpouse));
        // hsaBalance is skipped to preserve manual entry in the UI
        if (hasTaxable)
            inputs.taxableBalance = String(Math.round(totalTaxable));
        if (hasTaxableSpouse)
            inputs.taxableBalanceSpouse = String(Math.round(totalTaxableSpouse));
        // Automated Weekly Snapshot Logic:
        // If no portfolio_history exists, or if the latest snapshot in portfolio_history is >= 7 days old,
        // automatically append a new weekly portfolio snapshot.
        const portfolioHistory = docData.portfolio_history || [];
        const now = new Date();
        let shouldCaptureSnapshot = false;
        if (portfolioHistory.length === 0) {
            shouldCaptureSnapshot = true;
        }
        else {
            const latestTs = portfolioHistory.reduce((max, snap) => {
                const t = new Date(snap.timestamp).getTime();
                return t > max ? t : max;
            }, 0);
            const daysDiff = (now.getTime() - latestTs) / (1000 * 60 * 60 * 24);
            if (daysDiff >= 7) {
                shouldCaptureSnapshot = true;
            }
        }
        if (shouldCaptureSnapshot) {
            const k401P1 = has401k ? Math.round(total401k) : (parseFloat(inputs.k401Balance) || 0);
            const k401P2 = has401kSpouse ? Math.round(total401kSpouse) : (parseFloat(inputs.k401BalanceSpouse) || 0);
            const rothP1 = hasRoth ? Math.round(totalRoth) : (parseFloat(inputs.rothBalance) || 0);
            const rothP2 = hasRothSpouse ? Math.round(totalRothSpouse) : (parseFloat(inputs.rothBalanceSpouse) || 0);
            const hsa = parseFloat(inputs.hsaBalance) || 0;
            const taxableP1 = hasTaxable ? Math.round(totalTaxable) : (parseFloat(inputs.taxableBalance) || 0);
            const taxableP2 = hasTaxableSpouse ? Math.round(totalTaxableSpouse) : (parseFloat(inputs.taxableBalanceSpouse) || 0);
            const k401Tot = k401P1 + k401P2;
            const rothTot = rothP1 + rothP2;
            const hsaTot = hsa;
            const taxableTot = taxableP1 + taxableP2;
            const netWorth = k401Tot + rothTot + hsaTot + taxableTot;
            const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            portfolioHistory.unshift({
                id: 'snap_' + Date.now(),
                timestamp: now.toISOString(),
                dateLabel,
                note: 'Automated Weekly Snapshot (Monarch Sync)',
                favorite: false,
                balances: {
                    k401P1, k401P2, rothP1, rothP2, hsa, taxableP1, taxableP2
                },
                totals: {
                    k401Total: k401Tot,
                    rothTotal: rothTot,
                    hsaTotal: hsaTot,
                    taxableTotal: taxableTot,
                    netWorth
                }
            });
            console.info(`Captured automated weekly portfolio snapshot on ${dateLabel}.`);
        }
        transaction.update(docRef, {
            "config.inputs": inputs,
            "portfolio_history": portfolioHistory
        });
    });
    console.info("Firestore balance update committed successfully.");
    return {
        success: true,
        relevantAccountsCount: targetAccounts.length,
        appliedAccountsCount,
        balances: {
            k401k: has401k ? Math.round(total401k) : null,
            roth: hasRoth ? Math.round(totalRoth) : null,
            hsa: null, // manual entry preserved
            taxable: hasTaxable ? Math.round(totalTaxable) : null,
        }
    };
}
/**
 * HTTPS Callable Cloud Function to run the Monarch sync on demand.
 * Restricts access to the configured target Firebase user.
 */
exports.syncBalancesOnDemand = (0, https_1.onCall)({
    cors: [
        "https://rajuplanner.web.app",
        "https://rajuplanner.firebaseapp.com",
        /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
    ],
    secrets: ["MONARCH_EMAIL", "MONARCH_PASSWORD", "MONARCH_MFA_SECRET", "MONARCH_ACCOUNT_RULES", "TARGET_USER_ID"]
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    }
    const targetUserId = process.env.TARGET_USER_ID;
    if (!targetUserId || request.auth.uid !== targetUserId) {
        throw new https_1.HttpsError("permission-denied", "User is not authorized to synchronize balances.");
    }
    try {
        const userId = request.auth.uid;
        return await performMonarchSync(userId);
    }
    catch (error) {
        console.error("Error in syncBalancesOnDemand:", error);
        throw new https_1.HttpsError("internal", "Unable to synchronize balances right now.");
    }
});
/**
 * Scheduled Cloud Function that runs daily to sync Monarch balances.
 */
exports.dailyMonarchSync = (0, scheduler_1.onSchedule)({
    schedule: "0 5 * * *", // 5:00 AM Eastern Time daily
    timeZone: "America/New_York",
    secrets: ["MONARCH_EMAIL", "MONARCH_PASSWORD", "MONARCH_MFA_SECRET", "MONARCH_ACCOUNT_RULES", "TARGET_USER_ID"]
}, async (event) => {
    const targetUserId = process.env.TARGET_USER_ID;
    if (!targetUserId) {
        console.error("TARGET_USER_ID secret is not set. Scheduled sync aborted.");
        return;
    }
    console.info("Starting scheduled daily Monarch sync.");
    try {
        const result = await performMonarchSync(targetUserId);
        console.info(`Scheduled sync completed: ${result.appliedAccountsCount} of ${result.relevantAccountsCount} relevant accounts applied.`);
    }
    catch (error) {
        console.error("Scheduled sync failed:", error);
        throw error;
    }
});
//# sourceMappingURL=index.js.map