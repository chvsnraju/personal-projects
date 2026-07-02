import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
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
    throw new Error("Refresh token is missing from Enphase configuration.");
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
    throw new Error(
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
 * Shared helper to perform the Enphase synchronization logic.
 */
async function performEnphaseSync(): Promise<{ success: boolean; count: number }> {
  // Fetch global Enphase Configuration from Firestore
  const configRef = db.collection("configs").doc("enphase");
  const configDoc = await configRef.get();

  if (!configDoc.exists) {
    throw new Error("Enphase configuration not initialized in configs/enphase.");
  }

  const config = configDoc.data() as EnphaseConfig;

  // Ensure we have valid tokens (refresh if needed)
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

  // Auto-discover System ID if not already present
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
    throw new Error("System ID is not set and could not be auto-discovered.");
  }

  // Fetch energy lifetime data from Enphase Cloud
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
    throw new Error(`Energy API returned HTTP ${energyResponse.status}: ${errText}`);
  }

  const energyJson = (await energyResponse.json()) as {
    production?: number[];
    start_date?: string;
  };

  if (!energyJson.production || !Array.isArray(energyJson.production)) {
    throw new Error("No production data returned from Enphase Cloud.");
  }

  const production = energyJson.production;
  const startDateStr = energyJson.start_date || "";

  if (!startDateStr) {
    throw new Error("Start date is missing from Enphase Cloud response.");
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
}

/**
 * Helper to compute yesterday's date in America/New_York (ET) format YYYY-MM-DD
 */
function getYesterdayETString(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const etTodayStr = formatter.format(new Date());
  const [year, month, day] = etTodayStr.split("-").map(Number);
  
  const etToday = new Date(year, month - 1, day);
  const etYesterday = new Date(etToday.getTime() - 24 * 60 * 60 * 1000);
  
  const y = etYesterday.getFullYear();
  const m = String(etYesterday.getMonth() + 1).padStart(2, "0");
  const d = String(etYesterday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  try {
    return await performEnphaseSync();
  } catch (error: any) {
    throw new HttpsError("internal", error.message);
  }
});

/**
 * Daily Scheduled Cloud Function to synchronize Enphase readings at 6:00 AM Eastern Time
 * and email a report using the Resend API.
 */
export const dailyEnphaseSync = onSchedule({
  schedule: "0 6 * * *",
  timeZone: "America/New_York",
  secrets: ["RESEND_API_KEY"]
}, async (event) => {
  console.log("Starting daily Enphase sync scheduler...");
  try {
    const result = await performEnphaseSync();
    console.log(`Scheduled sync complete. Synced ${result.count} entries.`);
    
    // Get yesterday's date in Eastern Time
    const yesterdayStr = getYesterdayETString();
    
    // Fetch production for yesterday
    const doc = await db.collection("daily_production").doc(yesterdayStr).get();
    let productionDetails = "No data found for yesterday.";
    if (doc.exists) {
      const data = doc.data();
      if (data && typeof data.productionWh === "number") {
        const kwh = (data.productionWh / 1000).toFixed(2);
        productionDetails = `Yesterday's production: <strong>${kwh} kWh</strong>`;
      }
    }
    
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY environment variable is not set.");
      return;
    }
    
    console.log(`Sending email notification to raju.chekuri@gmail.com for date: ${yesterdayStr}`);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Solar Dashboard <onboarding@resend.dev>",
        to: "raju.chekuri@gmail.com",
        subject: `Daily Solar Production Report - ${yesterdayStr}`,
        html: `<h3>Daily Solar Sync Report</h3>
               <p>${productionDetails}</p>
               <p>Successfully synced ${result.count} history entries from Enphase Cloud.</p>
               <p>Check the dashboard at <a href="https://chekuri-solar.web.app">chekuri-solar.web.app</a>.</p>`
      })
    });
    
    if (!emailResponse.ok) {
      const errText = await emailResponse.text();
      console.error(`Failed to send email via Resend API: ${emailResponse.status} - ${errText}`);
    } else {
      console.log("Sync report email sent successfully.");
    }
  } catch (error: any) {
    console.error("Error running daily Enphase sync scheduler:", error);
  }
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

