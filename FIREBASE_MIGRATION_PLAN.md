# Automated Firebase Migration Plan: Toolshed Organizer

This document provides step-by-step instructions for an AI coding assistant to perform an autonomous, complete migration of the **Toolshed Organizer** application in this workspace to Firebase. 

Follow these instructions exactly to execute the migration without modifying the existing Java/Postgres code.

---

## Part 1: GCP & Firebase Resource Setup (Autonomous CLI commands)

First, run these commands in the terminal from the project root to set up the isolated resources under GCP project `gen-lang-client-0912596020` using the logged-in gcloud credentials.

### 1. Create a Dedicated Firestore Database
Create a secondary, isolated Firestore database named `toolshed-organizer`:
```bash
gcloud firestore databases create --database="toolshed-organizer" --location="us-central1"
```

### 2. Register the Web Application in Firebase
Register the web app to generate client configuration IDs:
```bash
npx firebase-tools apps:create web "Toolshed Organizer"
```
*(Copy the resulting App ID, API Key, and configuration options returned by this command to configure the frontend later).*

### 3. Register the Custom Domain/Hosting Site
Register the custom site domain `toolshed-organizer`:
```bash
npx firebase-tools hosting:sites:create toolshed-organizer
```
This registers the domain **`https://toolshed-organizer.web.app`**.

### 4. Whitelist the Domains in Firebase Auth
Whitelist the new domains in Firebase Authentication using the Identity Toolkit API:
1. Fetch the current whitelist:
   ```bash
   curl -s -X GET -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: gen-lang-client-0912596020" https://identitytoolkit.googleapis.com/v2/projects/gen-lang-client-0912596020/config > current_config.json
   ```
2. Append `toolshed-organizer.web.app` and `toolshed-organizer.firebaseapp.com` to the `authorizedDomains` array in `current_config.json`.
3. Submit the updated whitelist back:
   ```bash
   curl -s -X PATCH \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: gen-lang-client-0912596020" \
     -H "Content-Type: application/json" \
     -d '{
       "authorizedDomains": [
         "gen-lang-client-0912596020.firebaseapp.com",
         "gen-lang-client-0912596020.web.app",
         "rajuplanner.web.app",
         "rajuplanner.firebaseapp.com",
         "chekuri-solar.web.app",
         "chekuri-solar.firebaseapp.com",
         "localhost",
         "127.0.0.1",
         "toolshed-organizer.web.app",
         "toolshed-organizer.firebaseapp.com"
       ]
     }' \
     "https://identitytoolkit.googleapis.com/v2/projects/gen-lang-client-0912596020/config?updateMask=authorizedDomains"
   ```

---

## Part 2: Firebase Local Workspace Setup

Create a new directory named `firebase` in the project root:
```bash
mkdir firebase && cd firebase
```

Write the following configuration files inside the `firebase/` directory:

### 1. `firebase/firebase.json`
Configure targets to isolate database, rules, functions, and hosting:
```json
{
  "firestore": [
    {
      "database": "toolshed-organizer",
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  ],
  "storage": {
    "rules": "storage.rules"
  },
  "hosting": {
    "site": "toolshed-organizer",
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firestore-debug.log"
      ]
    }
  ]
}
```

### 2. `firebase/.firebaserc`
Pin the workspace to your active Firebase project:
```json
{
  "projects": {
    "default": "gen-lang-client-0912596020"
  }
}
```

### 3. `firebase/firestore.rules`
Write the database access rules. Authenticated users can only read and write their own documents:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /user_configs/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /items/{itemId} {
      allow read, write: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /containers/{containerId} {
      allow read, write: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /locations/{locationId} {
      allow read, write: if request.auth != null && resource.data.userId == request.auth.uid;
    }
    match /workspaces/{workspaceId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. `firebase/storage.rules`
Write storage rules to restrict user uploads and reads:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 5. `firebase/firestore.indexes.json`
Write an empty indexes configuration:
```json
{
  "indexes": [],
  "fieldOverrides": []
}
```

---

## Part 3: Backend Cloud Functions Setup

Create a `functions` folder under `firebase` and initialize the dependencies:
```bash
mkdir -p firebase/functions
cd firebase/functions
```

### 1. `firebase/functions/package.json`
Use Node.js 22 and install the required Firebase & Google AI SDK packages:
```json
{
  "name": "functions",
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions:generateAiContent,functions:lookupBarcode"
  },
  "engines": {
    "node": "22"
  },
  "main": "lib/index.js",
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 2. `firebase/functions/tsconfig.json`
Write the TypeScript configuration:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "outDir": "lib",
    "sourceMap": true,
    "strict": true,
    "target": "es2022"
  },
  "compileOnSave": true,
  "include": ["src"]
}
```

### 3. `firebase/functions/src/index.ts`
Implement the Cloud Functions to proxy **Gemini** and **UPC Barcode Database** operations:
```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/generative-ai";

initializeApp();
const db = getFirestore("toolshed-organizer");

const geminiApiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

// 1. Multimodal AI Generation Function (Gemini API Integration)
export const generateAiContent = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { prompt, imageData, responseMimeType } = request.data as {
    prompt: string;
    imageData?: { base64: string; mimeType: string };
    responseMimeType?: string;
  };

  try {
    const model = ai.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
    const parts: any[] = [{ text: prompt }];

    if (imageData && imageData.base64) {
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType || "image/jpeg",
          data: imageData.base64
        }
      });
    }

    const config: any = {};
    if (responseMimeType) {
      config.responseMimeType = responseMimeType;
    }

    const result = await model.generateContent({ contents: [{ parts }], generationConfig: config });
    const response = await result.response;
    return { text: response.text() };
  } catch (error: any) {
    throw new HttpsError("internal", `AI Generation failed: ${error.message}`);
  }
});

// 2. Barcode UPC database lookup
export const lookupBarcode = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { upc } = request.data as { upc: string };
  if (!upc) {
    throw new HttpsError("invalid-argument", "Missing UPC barcode.");
  }

  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`);
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error: any) {
    throw new HttpsError("internal", `Barcode lookup failed: ${error.message}`);
  }
});
```

---

## Part 4: Database Seeding & Media Migration Script

Write a script `migrate_data.js` under `firebase/` to extract data from your PostgreSQL instance and migrate it to Firestore and Firebase Storage.

```javascript
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const admin = require("firebase-admin");
const { Client } = require("pg");

admin.initializeApp({
  projectId: "gen-lang-client-0912596020",
  storageBucket: "gen-lang-client-0912596020.firebasestorage.app"
});

const db = getFirestore("toolshed-organizer");
const bucket = getStorage().bucket();

async function runMigration() {
  const client = new Client({
    connectionString: "YOUR_POSTGRESQL_CONNECTION_STRING"
  });
  await client.connect();

  console.log("Connected to PostgreSQL database.");

  // 1. Migrate Media BLOBs to Firebase Storage
  console.log("Migrating media BLOBs...");
  const mediaRes = await client.query("SELECT id, content, mime_type FROM media");
  for (const row of mediaRes.rows) {
    console.log(`Uploading file ${row.id} to Storage...`);
    const file = bucket.file(`media/${row.id}`);
    await file.save(row.content, {
      contentType: row.mime_type,
      metadata: { cacheControl: "public, max-age=31536000" }
    });
  }

  // 2. Migrate Items to Firestore
  console.log("Migrating items...");
  const itemsRes = await client.query("SELECT * FROM items");
  for (const item of itemsRes.rows) {
    // Map local serve file url to the new public Firebase Storage CDN URL
    if (item.image_url && item.image_url.startsWith("/api/storage/file/")) {
      const filename = item.image_url.replace("/api/storage/file/", "");
      item.image_url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/media%2F${filename}?alt=media`;
    }
    
    // Repeat for other image URL arrays...
    await db.collection("items").doc(item.id).set(item);
  }

  console.log("Migration complete!");
  await client.end();
}

runMigration().catch(console.error);
```

---

## Part 5: Frontend Migration

### 1. Configure Client Environment Variables
Create `frontend/.env` and update the keys with the registered Web App values:
```env
VITE_FIREBASE_API_KEY=YOUR_VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN=gen-lang-client-0912596020.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=gen-lang-client-0912596020
VITE_FIREBASE_STORAGE_BUCKET=gen-lang-client-0912596020.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=478577603526
VITE_FIREBASE_APP_ID=YOUR_TOOLS_WEB_APP_APP_ID
```

### 2. Client-Side Image Upload Integration
In React, implement direct-to-storage upload:
```typescript
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const storage = getStorage();

async function uploadImage(file: File): Promise<string> {
  const fileRef = ref(storage, `media/${uuidv4()}.jpg`);
  const snapshot = await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl; // Save this URL inside your Firestore item document
}
```

---

## Part 6: Deploying the Completed Project

Compile and deploy functions, rules, and hosting static assets:
```bash
# 1. Deploy Firestore Rules and Storage Rules
npx firebase-tools deploy --only firestore,storage

# 2. Compile and Deploy Cloud Functions
cd firebase/functions && npm run build && cd ..
npx firebase-tools deploy --only functions:generateAiContent,functions:lookupBarcode

# 3. Compile and Deploy Frontend
cd ../frontend
npm run build
cp -rf dist/* ../firebase/public/
cd ../firebase
npx firebase-tools deploy --only hosting
```

Your system will now be live on **`https://toolshed-organizer.web.app`**!
