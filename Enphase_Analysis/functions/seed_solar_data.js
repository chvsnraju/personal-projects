const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

// Connect using local active GCP/gcloud credentials
try {
  admin.initializeApp({
    projectId: "gen-lang-client-0912596020"
  });
  console.log("Successfully initialized Firebase Admin.");
} catch (err) {
  console.error("Initialization failed:", err);
  process.exit(1);
}

const db = getFirestore("enphase-solar");

// Months mapping helper
const monthsOrder = {
  "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04", "May": "05", "Jun": "06",
  "Jul": "07", "Aug": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"
};

function getDocId(monthStr) {
  const parts = monthStr.split(" ");
  if (parts.length === 2) {
    const year = parts[1];
    const month = monthsOrder[parts[0].slice(0, 3)];
    if (month) {
      return `${year}-${month}`;
    }
  }
  return monthStr;
}

async function seed() {
  const solarAnalysisPath = path.join(__dirname, "..", "..", "Solar_Analysis");
  const dataPath = path.join(solarAnalysisPath, "data.json");
  const investmentPath = path.join(solarAnalysisPath, "investment.json");

  // 1. Seed Investment Config
  if (fs.existsSync(investmentPath)) {
    console.log("Reading investment.json...");
    const investment = JSON.parse(fs.readFileSync(investmentPath, "utf8"));
    await db.collection("configs").doc("investments").set(investment);
    console.log("Successfully seeded configs/investments in Firestore.");
  } else {
    console.warn("Could not find investment.json at " + investmentPath);
  }

  // 2. Seed Monthly Billing Records
  if (fs.existsSync(dataPath)) {
    console.log("Reading data.json...");
    const dataList = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    
    if (Array.isArray(dataList)) {
      console.log(`Found ${dataList.length} monthly records. Seeding to Firestore...`);
      const batch = db.batch();
      
      for (const record of dataList) {
        const docId = getDocId(record.month);
        const docRef = db.collection("monthly_billing").doc(docId);
        
        // Clean and prepare the record data
        const docData = {
          month: record.month,
          bill_file: record.bill_file || "",
          image_file: record.image_file || "",
          service_period: record.service_period || "",
          import_kwh: Number(record.import_kwh) || 0.0,
          export_kwh: Number(record.export_kwh) || 0.0,
          solar_gats_kwh: Number(record.solar_gats_kwh) || 0.0,
          solar_est_kwh: Number(record.solar_est_kwh) || 0.0,
          actual_charge: Number(record.actual_charge) || 0.0,
          customer_charge: Number(record.customer_charge) || 11.30,
          dist_rate: Number(record.dist_rate) || 0.09655,
          supply_rate: Number(record.supply_rate) || 0.10,
          supplier_refund: Number(record.supplier_refund) || 0.0,
          solar_kwh: Number(record.solar_kwh) || 0.0,
          cons_kwh: Number(record.cons_kwh) || 0.0,
          cost_no_solar: Number(record.cost_no_solar) || 0.0,
          savings: Number(record.savings) || 0.0
        };
        
        batch.set(docRef, docData, { merge: true });
        console.log(`Prepared doc ${docId} for ${record.month}`);
      }
      
      await batch.commit();
      console.log("Successfully seeded monthly_billing collection in Firestore.");
    }
  } else {
    console.warn("Could not find data.json at " + dataPath);
  }
}

seed()
  .then(() => {
    console.log("Seeding process completed!");
    process.exit(0);
  })
  .catch(err => {
    console.error("Error seeding data:", err);
    process.exit(1);
  });
