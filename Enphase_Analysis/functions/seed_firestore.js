const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

// Determine Firebase connection based on emulator environment variable
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log("Connecting to Firestore emulator at", process.env.FIRESTORE_EMULATOR_HOST);
  admin.initializeApp({ projectId: "demo-enphase-solar" });
} else {
  const serviceAccountPath = path.join(__dirname, "service-account.json");
  if (fs.existsSync(serviceAccountPath)) {
    console.log("Loading service account credentials from service-account.json...");
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    console.log("No service-account.json found. Attempting to connect via Application Default Credentials (ADC)...");
    try {
      // Connect to the production Firebase project using your local active gcloud credentials
      admin.initializeApp({
        projectId: "gen-lang-client-0912596020"
      });
      console.log("Successfully initialized Firebase Admin using local GCP/gcloud credentials.");
    } catch (err) {
      console.error("Initialization failed: Could not resolve credentials.");
      console.error("Please login using: gcloud auth application-default login");
      process.exit(1);
    }
  }
}

const db = getFirestore("enphase-solar");

async function seed() {
  // 1. Seed Enphase Config
  const configPath = "/Users/a081057/Development/poc_projects/enphase/config.json";
  if (fs.existsSync(configPath)) {
    console.log("Reading config.json...");
    const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
    
    const configDoc = {
      developerApiKey: configData.DEVELOPER_API_KEY || "",
      developerClientId: configData.DEVELOPER_CLIENT_ID || "",
      developerClientSecret: configData.DEVELOPER_CLIENT_SECRET || "",
      systemId: configData.SYSTEM_ID || "",
      accessToken: configData.access_token || "",
      refreshToken: configData.refresh_token || "",
      expiresAt: configData.expires_at || 0
    };
    
    await db.collection("configs").doc("enphase").set(configDoc);
    console.log("Successfully seeded configs/enphase document in Firestore.");
  } else {
    console.log("No config.json found at /Users/a081057/Development/poc_projects/enphase/config.json. Skipping config seed.");
  }

  // 2. Seed Daily Production History
  const historyPath = "/Users/a081057/Development/poc_projects/enphase/cloud-java/backend/src/main/resources/history.json";
  if (fs.existsSync(historyPath)) {
    console.log("Reading history.json...");
    const historyData = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    
    if (Array.isArray(historyData)) {
      console.log(`Seeding ${historyData.length} daily production records to Firestore...`);
      
      // Perform batched writes (Firestore limits batch size to 500 operations per commit)
      const maxBatchSize = 400;
      let currentBatch = db.batch();
      let operationCount = 0;
      
      for (let i = 0; i < historyData.length; i++) {
        const entry = historyData[i];
        if (entry.date) {
          const docRef = db.collection("daily_production").doc(entry.date);
          currentBatch.set(docRef, {
            productionWh: entry.productionWh || 0,
            status: entry.status || "Verified"
          }, { merge: true });
          
          operationCount++;
          
          if (operationCount >= maxBatchSize) {
            console.log(`Committing batch of ${operationCount} documents...`);
            await currentBatch.commit();
            currentBatch = db.batch();
            operationCount = 0;
          }
        }
      }
      
      if (operationCount > 0) {
        console.log(`Committing remaining ${operationCount} documents...`);
        await currentBatch.commit();
      }
      
      console.log("Successfully seeded daily_production collection.");
    }
  } else {
    console.log("No history.json found. Skipping production history seed.");
  }
}

seed().then(() => {
  console.log("Seeding complete!");
  process.exit(0);
}).catch(err => {
  console.error("Error seeding Firestore:", err);
  process.exit(1);
});
