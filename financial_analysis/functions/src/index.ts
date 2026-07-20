import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { 
  EmailPasswordAuthProvider, 
  MonarchGraphQLClient, 
  buildAuthHeaders
} from "monarch-money-ts";

initializeApp();
const db = getFirestore("raju-planner");

/**
 * Helper to fetch accounts using raw GraphQL request to bypass strict Zod validation failures
 * on fields like logoUrl and institution that might be null in the user's Monarch account.
 */
async function fetchAccountsRaw(auth: any, client: any): Promise<any[]> {
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
    const headers = buildAuthHeaders(token);
    const raw: any = await client.client.request(query, {}, headers);
    return raw.accounts || [];
  };

  try {
    return await doRequest();
  } catch (err: any) {
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
async function performMonarchSync(userId: string) {
  const email = process.env.MONARCH_EMAIL;
  const password = process.env.MONARCH_PASSWORD;
  const totpKey = process.env.MONARCH_MFA_SECRET;

  if (!email || !password) {
    throw new Error("Monarch credentials are not configured in environment secrets.");
  }

  console.log("Initializing Monarch Money client...");
  const auth = new EmailPasswordAuthProvider({
    email,
    password,
    totpKey,
  });
  const client = new MonarchGraphQLClient();

  console.log("Fetching accounts from Monarch (raw request)...");
  const accounts = await fetchAccountsRaw(auth, client);

  console.log(`Successfully fetched ${accounts.length} accounts from Monarch.`);
  
  // Log accounts for diagnostic visibility
  accounts.forEach((acc: any) => {
    console.log(`[Account Diagnostic] Name: "${acc.name}", Display: "${acc.displayName}", Type: "${acc.type?.name || "Unknown"}", Subtype: "${acc.subtype?.display || "None"}", Balance: ${acc.currentBalance}, Institution: "${acc.institution?.name || "Unknown"}"`);
  });

  // Filter down to Fidelity accounts OR Pennsylvania State Employee plans
  const targetAccounts = accounts.filter((acc: any) => {
    const instName = acc.institution?.name?.toLowerCase() || "";
    const accName = acc.name?.toLowerCase() || "";
    const dispName = acc.displayName?.toLowerCase() || "";
    
    const isFidelity = instName.includes("fidelity") || accName.includes("fidelity") || dispName.includes("fidelity");
    const isPaStateEmployees = accName.includes("pennsylvania state employees") || dispName.includes("pennsylvania state employees");
    
    return isFidelity || isPaStateEmployees;
  });

  console.log(`Found ${targetAccounts.length} relevant accounts.`);

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

  targetAccounts.forEach((acc: any) => {
    const name = (acc.name || "").toLowerCase();
    const displayName = (acc.displayName || "").toLowerCase();
    
    // Exclude Ritsika's accounts (e.g. child/education accounts)
    if (name.includes("ritsika") || displayName.includes("ritsika")) {
      console.log(`Excluding Ritsika's account: "${acc.displayName || acc.name}"`);
      return;
    }

    const isSpouse = name.includes("anuradha") || displayName.includes("anuradha") || 
                     name.includes("pennsylvania state employees") || displayName.includes("pennsylvania state employees");

    const subtypeName = (acc.subtype?.display || "").toLowerCase();
    const typeName = (acc.type?.name || "").toLowerCase();
    
    // Explicit Overrides for specific accounts
    let isRoth = false;
    let isHsa = false;
    let is401k = false;
    let isTaxable = false;

    if (displayName.includes("7801") || name.includes("7801")) {
      isTaxable = true;
    } else if (displayName.includes("7803") || name.includes("7803")) {
      is401k = true;
    } else {
      // Standard matching logic
      isRoth = subtypeName === "roth" || subtypeName === "roth_ira" || name.includes("roth") || displayName.includes("roth");
      isHsa = subtypeName === "hsa" || name.includes("hsa") || displayName.includes("hsa") || name.includes("health savings") || displayName.includes("health savings");
      is401k = !isRoth && !isHsa && (
        subtypeName === "401k" || 
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
        name.includes("pennsylvania state employees") ||
        displayName.includes("401k") || 
        displayName.includes("401(k)") || 
        displayName.includes("deferred") || 
        displayName.includes("defined contribution") ||
        displayName.includes("traditional") || 
        displayName.includes("ira") ||
        displayName.includes("pennsylvania state employees")
      );
      isTaxable = !isRoth && !isHsa && !is401k && (
        subtypeName === "brokerage" || 
        subtypeName === "investment" ||
        name.includes("brokerage") || 
        name.includes("taxable") || 
        name.includes("individual") || 
        name.includes("joint") ||
        displayName.includes("brokerage") || 
        displayName.includes("taxable") || 
        displayName.includes("individual") || 
        displayName.includes("joint")
      );
    }

    const balance = acc.currentBalance || 0;

    if (isRoth) {
      if (isSpouse) {
        totalRothSpouse += balance;
        hasRothSpouse = true;
        console.log(`Matched Spouse Roth: "${acc.displayName || acc.name}" = $${balance}`);
      } else {
        totalRoth += balance;
        hasRoth = true;
        console.log(`Matched Primary Roth: "${acc.displayName || acc.name}" = $${balance}`);
      }
    } else if (isHsa) {
      totalHsa += balance;
      console.log(`Matched HSA: "${acc.displayName || acc.name}" = $${balance}`);
    } else if (is401k) {
      if (isSpouse) {
        total401kSpouse += balance;
        has401kSpouse = true;
        console.log(`Matched Spouse 401k/Deferred: "${acc.displayName || acc.name}" = $${balance}`);
      } else {
        total401k += balance;
        has401k = true;
        console.log(`Matched Primary 401k/Deferred: "${acc.displayName || acc.name}" = $${balance}`);
      }
    } else if (isTaxable) {
      if (isSpouse) {
        totalTaxableSpouse += balance;
        hasTaxableSpouse = true;
        console.log(`Matched Spouse Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
      } else {
        totalTaxable += balance;
        hasTaxable = true;
        console.log(`Matched Primary Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
      }
    } else {
      // Fallback: treat general investments as taxable brokerage if unmatched
      if (typeName === "investment") {
        if (isSpouse) {
          totalTaxableSpouse += balance;
          hasTaxableSpouse = true;
          console.log(`Matched general investment as Spouse Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
        } else {
          totalTaxable += balance;
          hasTaxable = true;
          console.log(`Matched general investment as Primary Taxable Brokerage: "${acc.displayName || acc.name}" = $${balance}`);
        }
      } else {
        console.log(`Skipped unmatched account: "${acc.displayName || acc.name}" (Subtype: ${subtypeName})`);
      }
    }
  });

  console.log("Calculated aggregated totals:");
  console.log(`- Primary 401k: $${total401k}`);
  console.log(`- Spouse 401k: $${total401kSpouse}`);
  console.log(`- Primary Roth: $${totalRoth}`);
  console.log(`- Spouse Roth: $${totalRothSpouse}`);
  console.log(`- HSA: $${totalHsa}`);
  console.log(`- Primary Taxable: $${totalTaxable}`);
  console.log(`- Spouse Taxable: $${totalTaxableSpouse}`);

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
    if (has401k) inputs.k401Balance = String(Math.round(total401k));
    if (has401kSpouse) inputs.k401BalanceSpouse = String(Math.round(total401kSpouse));
    if (hasRoth) inputs.rothBalance = String(Math.round(totalRoth));
    if (hasRothSpouse) inputs.rothBalanceSpouse = String(Math.round(totalRothSpouse));
    // hsaBalance is skipped to preserve manual entry in the UI
    if (hasTaxable) inputs.taxableBalance = String(Math.round(totalTaxable));
    if (hasTaxableSpouse) inputs.taxableBalanceSpouse = String(Math.round(totalTaxableSpouse));

    // Automated Weekly Snapshot Logic:
    // If no portfolio_history exists, or if the latest snapshot in portfolio_history is >= 7 days old,
    // automatically append a new weekly portfolio snapshot.
    const portfolioHistory: any[] = docData.portfolio_history || [];
    const now = new Date();
    let shouldCaptureSnapshot = false;

    if (portfolioHistory.length === 0) {
      shouldCaptureSnapshot = true;
    } else {
      const latestTs = portfolioHistory.reduce((max, snap) => {
        const t = new Date(snap.timestamp).getTime();
        return t > max ? t : max;
      }, 0);
      const daysDiff = (now.getTime() - latestTs) / (1000 * 60 * 60 * 24);
      if (daysDiff >= 6.8) {
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

      console.log(`Auto-captured weekly portfolio snapshot on ${dateLabel} with Net Worth: $${netWorth}`);
    }

    transaction.update(docRef, {
      "config.inputs": inputs,
      "portfolio_history": portfolioHistory
    });
  });

  console.log("Firestore update committed successfully.");

  return {
    success: true,
    userId,
    syncedFidelityAccountsCount: targetAccounts.length,
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
export const syncBalancesOnDemand = onCall({
  cors: true,
  secrets: ["MONARCH_EMAIL", "MONARCH_PASSWORD", "MONARCH_MFA_SECRET"]
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  if (request.auth.token.email !== "raju.chekuri@gmail.com") {
    throw new HttpsError("permission-denied", "Unauthorized user email.");
  }

  try {
    const userId = request.auth.uid;
    return await performMonarchSync(userId);
  } catch (error: any) {
    console.error("Error in syncBalancesOnDemand:", error);
    throw new HttpsError("internal", error.message || "An unexpected error occurred.");
  }
});

/**
 * Scheduled Cloud Function that runs daily to sync Monarch balances.
 */
export const dailyMonarchSync = onSchedule({
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
  } catch (error: any) {
    console.error("Scheduled sync failed:", error);
  }
});
