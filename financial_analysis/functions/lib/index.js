"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyMonarchSync = exports.syncBalancesOnDemand = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const monarch_money_ts_1 = require("monarch-money-ts");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
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
            console.log("Token expired or unauthorized. Invalidating token and retrying...");
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
    console.log("Initializing Monarch Money client...");
    const auth = new monarch_money_ts_1.EmailPasswordAuthProvider({
        email,
        password,
        totpKey,
    });
    const client = new monarch_money_ts_1.MonarchGraphQLClient();
    console.log("Fetching accounts from Monarch (raw request)...");
    const accounts = await fetchAccountsRaw(auth, client);
    console.log(`Successfully fetched ${accounts.length} accounts from Monarch.`);
    // Log accounts for diagnostic visibility
    accounts.forEach((acc) => {
        console.log(`[Account Diagnostic] Name: "${acc.name}", Display: "${acc.displayName}", Type: "${acc.type?.name || "Unknown"}", Subtype: "${acc.subtype?.display || "None"}", Balance: ${acc.currentBalance}, Institution: "${acc.institution?.name || "Unknown"}"`);
    });
    // Filter down to Fidelity accounts
    const fidelityAccounts = accounts.filter((acc) => {
        const instName = acc.institution?.name?.toLowerCase() || "";
        const accName = acc.name?.toLowerCase() || "";
        const dispName = acc.displayName?.toLowerCase() || "";
        return instName.includes("fidelity") || accName.includes("fidelity") || dispName.includes("fidelity");
    });
    console.log(`Found ${fidelityAccounts.length} Fidelity accounts.`);
    let total401k = 0;
    let totalRoth = 0;
    let totalHsa = 0;
    let totalTaxable = 0;
    let has401k = false;
    let hasRoth = false;
    let hasTaxable = false;
    fidelityAccounts.forEach((acc) => {
        const name = (acc.name || "").toLowerCase();
        const displayName = (acc.displayName || "").toLowerCase();
        // Exclude Ritsika's accounts (e.g. child/education accounts)
        if (name.includes("ritsika") || displayName.includes("ritsika")) {
            console.log(`Excluding Ritsika's account: "${acc.displayName || acc.name}"`);
            return;
        }
        const subtypeName = (acc.subtype?.display || "").toLowerCase();
        const typeName = (acc.type?.name || "").toLowerCase();
        // Check if Roth
        const isRoth = subtypeName === "roth" || subtypeName === "roth_ira" || name.includes("roth") || displayName.includes("roth");
        // Check if HSA
        const isHsa = subtypeName === "hsa" || name.includes("hsa") || displayName.includes("hsa") || name.includes("health savings") || displayName.includes("health savings");
        // Check if 401(k) / Tax-Deferred
        const is401k = !isRoth && !isHsa && (subtypeName === "401k" ||
            subtypeName === "403b" ||
            subtypeName === "sep_ira" ||
            subtypeName === "simple_ira" ||
            subtypeName === "traditional_ira" ||
            subtypeName === "retirement" ||
            name.includes("401k") ||
            name.includes("401(k)") ||
            name.includes("deferred") ||
            name.includes("traditional") ||
            name.includes("ira") ||
            displayName.includes("401k") ||
            displayName.includes("401(k)") ||
            displayName.includes("deferred") ||
            displayName.includes("traditional") ||
            displayName.includes("ira"));
        // Check if taxable brokerage
        const isTaxable = !isRoth && !isHsa && !is401k && (subtypeName === "brokerage" ||
            subtypeName === "investment" ||
            name.includes("brokerage") ||
            name.includes("taxable") ||
            name.includes("individual") ||
            name.includes("joint") ||
            displayName.includes("brokerage") ||
            displayName.includes("taxable") ||
            displayName.includes("individual") ||
            displayName.includes("joint"));
        const balance = acc.currentBalance || 0;
        if (isRoth) {
            totalRoth += balance;
            hasRoth = true;
            console.log(`Matched Roth: "${acc.displayName || acc.name}" = $${balance}`);
        }
        else if (isHsa) {
            totalHsa += balance;
            console.log(`Matched HSA: "${acc.displayName || acc.name}" = $${balance}`);
        }
        else if (is401k) {
            total401k += balance;
            has401k = true;
            console.log(`Matched 401k/Deferred: "${acc.displayName || acc.name}" = $${balance}`);
        }
        else if (isTaxable) {
            totalTaxable += balance;
            hasTaxable = true;
            console.log(`Matched Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
        }
        else {
            // Fallback: treat general investments as taxable brokerage if unmatched
            if (typeName === "investment") {
                totalTaxable += balance;
                hasTaxable = true;
                console.log(`Matched general investment as Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
            }
            else {
                console.log(`Skipped unmatched Fidelity account: "${acc.displayName || acc.name}" (Subtype: ${subtypeName})`);
            }
        }
    });
    console.log("Calculated aggregated totals:");
    console.log(`- 401k: $${total401k}`);
    console.log(`- Roth: $${totalRoth}`);
    console.log(`- HSA: $${totalHsa}`);
    console.log(`- Taxable: $${totalTaxable}`);
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
        if (hasRoth)
            inputs.rothBalance = String(Math.round(totalRoth));
        // hsaBalance is skipped here to preserve manual entry in the UI
        if (hasTaxable)
            inputs.taxableBalance = String(Math.round(totalTaxable));
        transaction.update(docRef, {
            "config.inputs": inputs
        });
    });
    console.log("Firestore update committed successfully.");
    return {
        success: true,
        userId,
        syncedFidelityAccountsCount: fidelityAccounts.length,
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
 * Restricts access to raju.chekuri@gmail.com.
 */
exports.syncBalancesOnDemand = (0, https_1.onCall)({
    cors: true,
    secrets: ["MONARCH_EMAIL", "MONARCH_PASSWORD", "MONARCH_MFA_SECRET"]
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated.");
    }
    if (request.auth.token.email !== "raju.chekuri@gmail.com") {
        throw new https_1.HttpsError("permission-denied", "Unauthorized user email.");
    }
    try {
        const userId = request.auth.uid;
        return await performMonarchSync(userId);
    }
    catch (error) {
        console.error("Error in syncBalancesOnDemand:", error);
        throw new https_1.HttpsError("internal", error.message || "An unexpected error occurred.");
    }
});
/**
 * Scheduled Cloud Function that runs daily to sync Monarch balances.
 */
exports.dailyMonarchSync = (0, scheduler_1.onSchedule)({
    schedule: "0 5 * * *", // 5:00 AM Eastern Time daily
    timeZone: "America/New_York",
    secrets: ["MONARCH_EMAIL", "MONARCH_PASSWORD", "MONARCH_MFA_SECRET", "TARGET_USER_ID"]
}, async (event) => {
    const targetUserId = process.env.TARGET_USER_ID;
    if (!targetUserId) {
        console.error("TARGET_USER_ID secret is not set. Scheduled sync aborted.");
        return;
    }
    console.log(`Starting scheduled daily Monarch sync for user ${targetUserId}...`);
    try {
        const result = await performMonarchSync(targetUserId);
        console.log("Scheduled sync completed successfully:", JSON.stringify(result));
    }
    catch (error) {
        console.error("Scheduled sync failed:", error);
    }
});
//# sourceMappingURL=index.js.map