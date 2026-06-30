const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

// Initialize Admin SDK using local active credentials
admin.initializeApp({
  projectId: "gen-lang-client-0912596020"
});

const defaultDb = getFirestore(); // Connect to (default) database
const targetDb = getFirestore("raju-planner"); // Connect to new raju-planner database

async function migrate() {
  console.log("Connecting to Firestore...");
  console.log("Reading documents from (default) database 'user_configs'...");
  
  const snapshot = await defaultDb.collection("user_configs").get();
  
  if (snapshot.empty) {
    console.log("No configs found in (default) database 'user_configs'.");
    return;
  }
  
  console.log(`Found ${snapshot.size} documents to migrate.`);
  const batch = targetDb.batch();
  
  snapshot.forEach(doc => {
    console.log(`Queueing document: ${doc.id}`);
    const docRef = targetDb.collection("user_configs").doc(doc.id);
    batch.set(docRef, doc.data());
  });
  
  console.log("Writing documents to 'raju-planner' database...");
  await batch.commit();
  console.log("Migration successfully completed!");
}

migrate().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Error during migration:", err);
  process.exit(1);
});
