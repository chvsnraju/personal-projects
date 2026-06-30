const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const admin = require("firebase-admin");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

// Load backend environment variables to get DB configuration
function loadEnv(filePath) {
  const env = {};
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx !== -1) {
          const key = trimmed.substring(0, idx).trim();
          const val = trimmed.substring(idx + 1).trim();
          env[key] = val;
        }
      }
    });
  }
  return env;
}

const env = loadEnv(path.join(__dirname, "../backend/.env"));

// Pin to Firebase project
admin.initializeApp({
  projectId: "gen-lang-client-0912596020",
  storageBucket: "gen-lang-client-0912596020-storage"
});

const db = getFirestore("toolshed-organizer");
const bucket = getStorage().bucket();

async function runMigration() {
  const client = new Client({
    host: env.DB_HOST || "localhost",
    port: parseInt(env.DB_PORT || "5432", 10),
    database: env.DB_NAME || "postgres",
    user: env.DB_USER || "postgres",
    password: env.DB_PASSWORD || "postgres",
    ssl: env.DB_HOST && env.DB_HOST !== "localhost" ? { rejectUnauthorized: false } : false
  });

  await client.connect();
  console.log("Connected to PostgreSQL database.");

  // Set the search path schema
  const schema = env.DB_SCHEMA || "hometools";
  await client.query(`SET search_path TO ${schema}`);
  console.log(`Schema set to ${schema}.`);

  // Helper to construct public CDN URL for media items
  function getFirebaseStorageUrl(filename) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/media%2F${filename}?alt=media`;
  }

  // 1. Migrate Media BLOBs to Firebase Storage
  console.log("Migrating media BLOBs...");
  const mediaRes = await client.query("SELECT id, content, mime_type FROM media");
  console.log(`Found ${mediaRes.rows.length} media records.`);
  for (const row of mediaRes.rows) {
    console.log(`Uploading file ${row.id} to Storage...`);
    const file = bucket.file(`media/${row.id}`);
    await file.save(row.content, {
      contentType: row.mime_type,
      metadata: { cacheControl: "public, max-age=31536000" }
    });
  }

  // 2. Migrate Users (both Firestore and Auth)
  console.log("Migrating users...");
  const usersRes = await client.query("SELECT * FROM users");
  console.log(`Found ${usersRes.rows.length} users.`);
  
  const authUsersToImport = [];
  for (const user of usersRes.rows) {
    const userIdStr = user.id.toString();
    const email = `${user.username}@toolshed-organizer.com`;
    
    // Save to Firestore
    await db.collection("users").doc(userIdStr).set({
      id: userIdStr,
      username: user.username,
      role: user.role,
      createdAt: new Date().toISOString()
    });

    // Prepare for Auth import
    authUsersToImport.push({
      uid: userIdStr,
      email: email,
      passwordHash: Buffer.from(user.password_hash)
    });
  }

  if (authUsersToImport.length > 0) {
    console.log("Importing users to Firebase Auth...");
    try {
      const importResult = await admin.auth().importUsers(authUsersToImport, {
        hash: {
          algorithm: "BCRYPT"
        }
      });
      console.log(`Successfully imported ${importResult.successCount} users.`);
      if (importResult.failureCount > 0) {
        console.error(`Failed to import ${importResult.failureCount} users:`, JSON.stringify(importResult.errors));
      }
    } catch (err) {
      console.error("Auth import error:", err);
    }
  }

  // Helper to map old URL format to new Storage URL
  function mapImageUrl(url) {
    if (!url) return url;
    if (url.startsWith("/api/storage/file/")) {
      const filename = url.replace("/api/storage/file/", "");
      return getFirebaseStorageUrl(filename);
    }
    return url;
  }

  // 3. Migrate Workspaces
  console.log("Migrating workspaces...");
  const workspacesRes = await client.query("SELECT * FROM workspaces");
  for (const workspace of workspacesRes.rows) {
    const wsId = workspace.id.toString();
    await db.collection("workspaces").doc(wsId).set({
      id: wsId,
      name: workspace.name,
      ownerId: workspace.owner_id.toString(),
      createdAt: workspace.created_at ? workspace.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 4. Migrate Workspace Members
  console.log("Migrating workspace memberships...");
  const membersRes = await client.query("SELECT * FROM workspace_members");
  for (const member of membersRes.rows) {
    const mId = member.id.toString();
    await db.collection("workspace_members").doc(mId).set({
      id: mId,
      workspaceId: member.workspace_id.toString(),
      userId: member.user_id.toString(),
      role: member.role,
      createdAt: member.created_at ? member.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 5. Migrate Locations
  console.log("Migrating locations...");
  const locationsRes = await client.query("SELECT * FROM locations");
  for (const loc of locationsRes.rows) {
    const locId = loc.id.toString();
    await db.collection("locations").doc(locId).set({
      id: locId,
      name: loc.name,
      description: loc.description || null,
      imageUrl: mapImageUrl(loc.image_url) || null,
      userId: loc.user_id ? loc.user_id.toString() : null,
      workspaceId: loc.workspace_id ? loc.workspace_id.toString() : null,
      createdAt: loc.created_at ? loc.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 6. Migrate Containers
  console.log("Migrating containers...");
  const containersRes = await client.query("SELECT * FROM containers");
  for (const container of containersRes.rows) {
    const cId = container.id.toString();
    await db.collection("containers").doc(cId).set({
      id: cId,
      name: container.name,
      description: container.description || null,
      imageUrl: mapImageUrl(container.image_url) || null,
      locationId: container.location_id ? container.location_id.toString() : null,
      userId: container.user_id ? container.user_id.toString() : null,
      workspaceId: container.workspace_id ? container.workspace_id.toString() : null,
      createdAt: container.created_at ? container.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 7. Migrate Items
  console.log("Migrating items...");
  const itemsRes = await client.query("SELECT * FROM items");
  for (const item of itemsRes.rows) {
    const itemId = item.id.toString();
    
    // Map array of images
    let mappedImages = [];
    if (Array.isArray(item.images)) {
      mappedImages = item.images.map(img => mapImageUrl(img));
    } else if (item.images) {
      // Handles potential string representation of array
      mappedImages = [mapImageUrl(item.images)];
    }

    await db.collection("items").doc(itemId).set({
      id: itemId,
      name: item.name,
      description: item.description || null,
      containerId: item.container_id ? item.container_id.toString() : null,
      imageUrl: mapImageUrl(item.image_url) || null,
      images: mappedImages,
      tags: item.tags || [],
      category: item.category || null,
      userId: item.user_id ? item.user_id.toString() : null,
      locationId: item.location_id ? item.location_id.toString() : null,
      productUrl: item.product_url || null,
      userDescription: item.user_description || null,
      specs: item.specs || {},
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      condition: item.condition || "good",
      isFavorite: !!item.is_favorite,
      isConsumable: !!item.is_consumable,
      lowStockThreshold: typeof item.low_stock_threshold === 'number' ? item.low_stock_threshold : 0,
      estimatedPrice: item.estimated_price || null,
      manualUrl: item.manual_url || null,
      videoUrl: item.video_url || null,
      purchaseDate: item.purchase_date ? item.purchase_date.toISOString().split('T')[0] : null,
      purchasePrice: item.purchase_price ? parseFloat(item.purchase_price.toString()) : null,
      receiptImageUrl: mapImageUrl(item.receipt_image_url) || null,
      lastUsedAt: item.last_used_at ? item.last_used_at.toISOString() : null,
      workspaceId: item.workspace_id ? item.workspace_id.toString() : null,
      createdAt: item.created_at ? item.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 8. Migrate Item Notes
  console.log("Migrating item notes...");
  const notesRes = await client.query("SELECT * FROM item_notes");
  for (const note of notesRes.rows) {
    const noteId = note.id.toString();
    await db.collection("item_notes").doc(noteId).set({
      id: noteId,
      itemId: note.item_id.toString(),
      noteText: note.note_text,
      userId: note.user_id.toString(),
      createdAt: note.created_at ? note.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 9. Migrate Shopping List
  console.log("Migrating shopping list...");
  const shoppingRes = await client.query("SELECT * FROM shopping_list");
  for (const shop of shoppingRes.rows) {
    const sId = shop.id.toString();
    await db.collection("shopping_list").doc(sId).set({
      id: sId,
      toolName: shop.tool_name,
      estimatedPrice: shop.estimated_price || null,
      notes: shop.notes || null,
      purchased: !!shop.purchased,
      userId: shop.user_id ? shop.user_id.toString() : null,
      workspaceId: shop.workspace_id ? shop.workspace_id.toString() : null,
      createdAt: shop.created_at ? shop.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 10. Migrate Tool Loans
  console.log("Migrating tool loans...");
  const loansRes = await client.query("SELECT * FROM tool_loans");
  for (const loan of loansRes.rows) {
    const loanId = loan.id.toString();
    await db.collection("tool_loans").doc(loanId).set({
      id: loanId,
      itemId: loan.item_id.toString(),
      borrowerName: loan.borrower_name,
      borrowedDate: loan.borrowed_date ? loan.borrowed_date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      expectedReturnDate: loan.expected_return_date ? loan.expected_return_date.toISOString().split('T')[0] : null,
      returnedDate: loan.returned_date ? loan.returned_date.toISOString().split('T')[0] : null,
      notes: loan.notes || null,
      userId: loan.user_id ? loan.user_id.toString() : null,
      workspaceId: loan.workspace_id ? loan.workspace_id.toString() : null,
      createdAt: loan.created_at ? loan.created_at.toISOString() : new Date().toISOString()
    });
  }

  // 11. Migrate Maintenance Reminders
  console.log("Migrating maintenance reminders...");
  const maintenanceRes = await client.query("SELECT * FROM maintenance_reminders");
  for (const m of maintenanceRes.rows) {
    const mId = m.id.toString();
    await db.collection("maintenance_reminders").doc(mId).set({
      id: mId,
      itemId: m.item_id.toString(),
      taskDescription: m.task_description,
      intervalDays: typeof m.interval_days === 'number' ? m.interval_days : null,
      lastPerformed: m.last_performed ? m.last_performed.toISOString().split('T')[0] : null,
      nextDue: m.next_due ? m.next_due.toISOString().split('T')[0] : null,
      isRecurring: !!m.is_recurring,
      userId: m.user_id ? m.user_id.toString() : null,
      workspaceId: m.workspace_id ? m.workspace_id.toString() : null,
      createdAt: m.created_at ? m.created_at.toISOString() : new Date().toISOString()
    });
  }

  console.log("Migration complete!");
  await client.end();
}

runMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
