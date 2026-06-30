"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCloudHistory = void 0;
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)("enphase-solar");
/**
 * Refreshes the Enphase Cloud OAuth tokens and saves them back to Firestore.
 */
async function refreshCloudTokens(configRef, config) {
    console.log("Refreshing Enphase Cloud OAuth tokens...");
    if (!config.refreshToken) {
        throw new https_1.HttpsError("failed-precondition", "Refresh token is missing from Enphase configuration.");
    }
    const basicAuth = Buffer.from(`${config.developerClientId}:${config.developerClientSecret}`).toString("base64");
    const formParams = new URLSearchParams();
    formParams.append("grant_type", "refresh_token");
    formParams.append("refresh_token", config.refreshToken);
    const response = await fetch("https://api.enphaseenergy.com/oauth/token", {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formParams.toString(),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new https_1.HttpsError("aborted", `Token refresh failed (HTTP ${response.status}): ${errorText}`);
    }
    const responseData = (await response.json());
    const expiresIn = responseData.expires_in || 3600;
    const newAccessToken = responseData.access_token;
    const newRefreshToken = responseData.refresh_token;
    const newExpiresAt = Date.now() + expiresIn * 1000;
    await configRef.update({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
    });
    console.log("OAuth tokens refreshed successfully.");
    return newAccessToken;
}
/**
 * HTTPS Callable Cloud Function to synchronize solar production history from Enphase Cloud into Firestore.
 */
exports.syncCloudHistory = (0, https_1.onCall)({ cors: true }, async (request) => {
    // 1. Enforce Authentication & Whitelisted Email
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "The function must be called by an authenticated user.");
    }
    if (request.auth.token.email !== "raju.chekuri@gmail.com") {
        throw new https_1.HttpsError("permission-denied", "Unauthorized email address.");
    }
    console.log(`Sync requested by user: ${request.auth.uid}`);
    // 2. Fetch global Enphase Configuration from Firestore
    const configRef = db.collection("configs").doc("enphase");
    const configDoc = await configRef.get();
    if (!configDoc.exists) {
        throw new https_1.HttpsError("failed-precondition", "Enphase configuration not initialized in configs/enphase.");
    }
    const config = configDoc.data();
    // 3. Ensure we have valid tokens (refresh if needed)
    const expiresAt = config.expiresAt || 0;
    let accessToken = config.accessToken || "";
    // If expired or expiring within 60 seconds, trigger a refresh
    if (Date.now() >= expiresAt - 60000 || !accessToken) {
        accessToken = await refreshCloudTokens(configRef, config);
        // Reload updated config fields
        const updatedDoc = await configRef.get();
        const updatedConfig = updatedDoc.data();
        config.systemId = updatedConfig.systemId;
    }
    // 4. Auto-discover System ID if not already present
    let systemId = config.systemId || "";
    if (!systemId) {
        console.log("System ID not set. Attempting auto-discovery...");
        const sysResponse = await fetch("https://api.enphaseenergy.com/api/v4/systems", {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "key": config.developerApiKey,
            },
        });
        if (sysResponse.ok) {
            const sysData = (await sysResponse.json());
            if (sysData.systems && sysData.systems.length > 0) {
                systemId = String(sysData.systems[0].system_id);
                await configRef.update({ systemId });
                console.log(`Auto-discovered and saved System ID: ${systemId}`);
            }
        }
        else {
            console.warn(`Could not verify systems endpoint (HTTP ${sysResponse.status}).`);
        }
    }
    if (!systemId) {
        throw new https_1.HttpsError("failed-precondition", "System ID is not set and could not be auto-discovered.");
    }
    // 5. Fetch energy lifetime data from Enphase Cloud
    console.log(`Requesting energy_lifetime for system: ${systemId}`);
    const energyUrl = `https://api.enphaseenergy.com/api/v4/systems/${systemId}/energy_lifetime`;
    const energyResponse = await fetch(energyUrl, {
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "key": config.developerApiKey,
        },
    });
    if (!energyResponse.ok) {
        const errText = await energyResponse.text();
        throw new https_1.HttpsError("internal", `Energy API returned HTTP ${energyResponse.status}: ${errText}`);
    }
    const energyJson = (await energyResponse.json());
    if (!energyJson.production || !Array.isArray(energyJson.production)) {
        throw new https_1.HttpsError("internal", "No production data returned from Enphase Cloud.");
    }
    const production = energyJson.production;
    const startDateStr = energyJson.start_date || "";
    if (!startDateStr) {
        throw new https_1.HttpsError("internal", "Start date is missing from Enphase Cloud response.");
    }
    const start = new Date(startDateStr + "T00:00:00");
    let addedOrUpdatedCount = 0;
    // Use a Firestore Batch to write entries efficiently
    const batch = db.batch();
    for (let i = 0; i < production.length; i++) {
        const currentDate = new Date(start);
        currentDate.setDate(start.getDate() + i);
        // Format date as YYYY-MM-DD
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
        const dd = String(currentDate.getDate()).padStart(2, "0");
        const dateStr = `${yyyy}-${mm}-${dd}`;
        // Only store data starting from 2026-04-01
        if (dateStr >= "2026-04-01") {
            const productionWh = production[i];
            const dailyProductionRef = db.collection("daily_production").doc(dateStr);
            batch.set(dailyProductionRef, {
                productionWh,
                status: "Verified",
            }, { merge: true });
            addedOrUpdatedCount++;
        }
    }
    await batch.commit();
    console.log(`Successfully synced ${addedOrUpdatedCount} entries from Enphase Cloud.`);
    return {
        success: true,
        count: addedOrUpdatedCount,
    };
});
//# sourceMappingURL=index.js.map