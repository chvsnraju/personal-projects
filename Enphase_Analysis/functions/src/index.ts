import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenerativeAI } from "@google/generative-ai";

initializeApp();
const db = getFirestore("enphase-solar");

interface EnphaseConfig {
  developerApiKey: string;
  developerClientId: string;
  developerClientSecret: string;
  systemId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Refreshes the Enphase Cloud OAuth tokens and saves them back to Firestore.
 */
async function refreshCloudTokens(configRef: FirebaseFirestore.DocumentReference, config: EnphaseConfig): Promise<string> {
  console.log("Refreshing Enphase Cloud OAuth tokens...");

  if (!config.refreshToken) {
    throw new HttpsError("failed-precondition", "Refresh token is missing from Enphase configuration.");
  }

  const basicAuth = Buffer.from(
    `${config.developerClientId}:${config.developerClientSecret}`
  ).toString("base64");

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
    throw new HttpsError(
      "aborted",
      `Token refresh failed (HTTP ${response.status}): ${errorText}`
    );
  }

  const responseData = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };

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
export const syncCloudHistory = onCall({ cors: true }, async (request) => {
  // 1. Enforce Authentication & Whitelisted Email
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called by an authenticated user.");
  }
  if (request.auth.token.email !== "raju.chekuri@gmail.com") {
    throw new HttpsError("permission-denied", "Unauthorized email address.");
  }

  console.log(`Sync requested by user: ${request.auth.uid}`);

  // 2. Fetch global Enphase Configuration from Firestore
  const configRef = db.collection("configs").doc("enphase");
  const configDoc = await configRef.get();

  if (!configDoc.exists) {
    throw new HttpsError("failed-precondition", "Enphase configuration not initialized in configs/enphase.");
  }

  const config = configDoc.data() as EnphaseConfig;

  // 3. Ensure we have valid tokens (refresh if needed)
  const expiresAt = config.expiresAt || 0;
  let accessToken = config.accessToken || "";

  // If expired or expiring within 60 seconds, trigger a refresh
  if (Date.now() >= expiresAt - 60000 || !accessToken) {
    accessToken = await refreshCloudTokens(configRef, config);
    // Reload updated config fields
    const updatedDoc = await configRef.get();
    const updatedConfig = updatedDoc.data() as EnphaseConfig;
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
      const sysData = (await sysResponse.json()) as {
        systems?: Array<{ system_id: number | string }>;
      };
      if (sysData.systems && sysData.systems.length > 0) {
        systemId = String(sysData.systems[0].system_id);
        await configRef.update({ systemId });
        console.log(`Auto-discovered and saved System ID: ${systemId}`);
      }
    } else {
      console.warn(`Could not verify systems endpoint (HTTP ${sysResponse.status}).`);
    }
  }

  if (!systemId) {
    throw new HttpsError("failed-precondition", "System ID is not set and could not be auto-discovered.");
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
    throw new HttpsError(
      "internal",
      `Energy API returned HTTP ${energyResponse.status}: ${errText}`
    );
  }

  const energyJson = (await energyResponse.json()) as {
    production?: number[];
    start_date?: string;
  };

  if (!energyJson.production || !Array.isArray(energyJson.production)) {
    throw new HttpsError("internal", "No production data returned from Enphase Cloud.");
  }

  const production = energyJson.production;
  const startDateStr = energyJson.start_date || "";

  if (!startDateStr) {
    throw new HttpsError("internal", "Start date is missing from Enphase Cloud response.");
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

      batch.set(
        dailyProductionRef,
        {
          productionWh,
          status: "Verified",
        },
        { merge: true }
      );

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

/**
 * HTTPS Callable Cloud Function to parse a PECO electric bill PDF (base64) using Gemini.
 */
export const parsePecoBill = onCall({ cors: true, secrets: ["GEMINI_API_KEY"] }, async (request) => {
  // Enforce authentication & whitelisted email
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called by an authenticated user.");
  }
  if (request.auth.token.email !== "raju.chekuri@gmail.com") {
    throw new HttpsError("permission-denied", "Unauthorized email address.");
  }

  const { fileBase64 } = request.data as { fileBase64: string };
  if (!fileBase64) {
    throw new HttpsError("invalid-argument", "Missing fileBase64 data.");
  }

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || "";
    const ai = new GoogleGenerativeAI(geminiApiKey);
    const model = ai.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const prompt = `You are an expert utility bill analyzer. Analyze this PECO electric bill PDF document and extract the following details precisely as JSON:
- month: "MMM YYYY" (e.g. "Jun 2026") corresponding to the billing statement month.
- service_period: "MM/DD/YYYY - MM/DD/YYYY" (e.g., "05/22/2026 - 06/23/2026")
- import_kwh: Number (total kWh imported/received from grid, labeled "kwh from grid" or "Total kWh Used")
- export_kwh: Number (total kWh exported/delivered to grid, labeled "kwh to grid")
- actual_charge: Number (current period charges for electricity; if there is a credit balance or a negative amount, include a minus sign)
- customer_charge: Number (the fixed customer charge, usually 11.30)
- dist_rate: Number (distribution charge rate per kWh, usually 0.09655)
- supply_rate: Number (generation/supply rate per kWh, usually 0.10)
- supplier_refund: Number (if there's any generation credit or refund shown, e.g. 209.95, otherwise 0)

Respond ONLY with a valid JSON object matching this schema. Do not wrap the response in markdown code blocks.`;

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "application/pdf",
                data: fileBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const text = result.response.text();
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error parsing PECO bill:", error);
    throw new HttpsError("internal", `PECO bill parsing failed: ${error.message}`);
  }
});

/**
 * HTTPS Callable Cloud Function to parse an Enphase monthly production screenshot (base64) using Gemini.
 */
export const parseEnphaseScreenshot = onCall({ cors: true, secrets: ["GEMINI_API_KEY"] }, async (request) => {
  // Enforce authentication & whitelisted email
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called by an authenticated user.");
  }
  if (request.auth.token.email !== "raju.chekuri@gmail.com") {
    throw new HttpsError("permission-denied", "Unauthorized email address.");
  }

  const { fileBase64, mimeType } = request.data as { fileBase64: string; mimeType?: string };
  if (!fileBase64) {
    throw new HttpsError("invalid-argument", "Missing fileBase64 data.");
  }

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || "";
    const ai = new GoogleGenerativeAI(geminiApiKey);
    const model = ai.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const prompt = `You are an expert solar production screenshot analyzer. Analyze this Enphase screenshot image showing monthly solar generation.
Extract the following details precisely as JSON:
- month: "MMM YYYY" (e.g., "Jun 2026") shown at the top of the screenshot (capitalize first letter, e.g. "Jun 2026", "Nov 2025").
- solar_gats_kwh: Number (the total "Production" value in kWh, if shown in MWh convert to kWh by multiplying by 1000)
- panel_values: Array of Numbers (find the microinverter physical layout grid and extract all the individual panel numeric generation values shown in each panel tile, e.g., 68.2, 70.1, etc. There should be up to 24 panel values).

Respond ONLY with a valid JSON object matching this schema. Do not wrap the response in markdown code blocks.`;

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: fileBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    const text = result.response.text();
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error parsing Enphase screenshot:", error);
    throw new HttpsError("internal", `Enphase screenshot parsing failed: ${error.message}`);
  }
});

