# Reusable Agent Blueprint: Building and Auto-Deploying Firebase Applications

This document serves as an instruction set and automation blueprint for an AI agent to build a new React/TypeScript web application from scratch, hook it up to Firebase, and fully automate its deployment without manual intervention.

---

## 1. Automated Project Setup & Provisioning

To initialize the app, the agent can execute the following automated shell script. Replace `PROJECT_ID`, `APP_NAME`, and `SUBDOMAIN` with your desired configuration:

```bash
#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Configure variables
PROJECT_ID="gen-lang-client-0912596020"
DATABASE_ID="my-new-app-db"
APP_NAME="My New App"
SUBDOMAIN="my-custom-subdomain" # Will deploy to https://my-custom-subdomain.web.app

echo "=== 1. Creating Firestore Database: $DATABASE_ID ==="
gcloud firestore databases create \
  --database="$DATABASE_ID" \
  --location="us-central1" \
  --project="$PROJECT_ID"

echo "=== 2. Registering Web Application in Firebase ==="
APP_INFO=$(npx firebase-tools apps:create web "$APP_NAME" --project="$PROJECT_ID" --json)
# Extract the App ID from JSON output using a script or utility
APP_ID=$(echo "$APP_INFO" | grep -o '"appId": "[^"]*' | grep -o '[^"]*$')

echo "=== 3. Registering Custom Subdomain ==="
npx firebase-tools hosting:sites:create "$SUBDOMAIN" --project="$PROJECT_ID"

echo "=== 4. Updating Google Auth Whitelist ==="
# Retrieve the current authorized domains config
curl -s -X GET \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT_ID/config" > current_auth_config.json

# Parse domains and append the new app's subdomain
# (This can be written using node/python or directly patched)
node -e '
  const fs = require("fs");
  const config = JSON.parse(fs.readFileSync("current_auth_config.json"));
  const newDomain1 = "'$SUBDOMAIN'.web.app";
  const newDomain2 = "'$SUBDOMAIN'.firebaseapp.com";
  if (!config.authorizedDomains.includes(newDomain1)) config.authorizedDomains.push(newDomain1);
  if (!config.authorizedDomains.includes(newDomain2)) config.authorizedDomains.push(newDomain2);
  fs.writeFileSync("update_payload.json", JSON.stringify({ authorizedDomains: config.authorizedDomains }));
'

# Submit updated config back to Firebase Identity Toolkit
curl -s -X PATCH \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d @update_payload.json \
  "https://identitytoolkit.googleapis.com/v2/projects/$PROJECT_ID/config?updateMask=authorizedDomains"

echo "=== Setup Completed Successfully! ==="
```

---

## 2. Standard Configuration Blueprints

Create a folder structure as follows:
```
├── firebase/
│   ├── firebase.json
│   ├── .firebaserc
│   ├── firestore.rules
│   └── storage.rules
└── frontend/
```

### 1. `firebase/firebase.json`
Specifies database ID and hosting configurations dynamically:
```json
{
  "firestore": [
    {
      "database": "my-new-app-db",
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    }
  ],
  "storage": {
    "rules": "storage.rules"
  },
  "hosting": {
    "site": "my-custom-subdomain",
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
      "codebase": "my-new-app",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log"
      ]
    }
  ]
}
```

> [!IMPORTANT]
> **Codebase Isolation**: If multiple applications/repositories share the same Firebase Project (e.g., `gen-lang-client-0912596020`), using `"codebase": "default"` will prompt Firebase to delete functions from other apps during deployments. 
> Always change `"codebase"` to a unique identifier (like `"codebase": "my-new-app"`) inside `firebase.json` to isolate its deployments.

### 2. `firebase/firestore.rules`
Restricts users from reading/writing documents that do not belong to their specific `userId`:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Restrict access to user profiles
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Catch-all rule ensuring users only modify items tagged with their userId
    match /{document=**} {
      allow read, write: if request.auth != null && 
        (resource == null || resource.data.userId == request.auth.uid) &&
        (request.resource == null || request.resource.data.userId == request.auth.uid);
    }
  }
}
```

---

## 3. Serverless AI Backend Setup (Cloud Functions)

Create a serverless endpoint using **Firebase Cloud Functions (2nd Gen)** to securely access the Gemini API using `gemini-3.1-flash-lite`.

### 1. `firebase/functions/package.json`
Configure Node 22 runtime dependencies:
```json
{
  "name": "functions",
  "scripts": {
    "build": "tsc"
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

### 2. `firebase/functions/src/index.ts`
Implement the Cloud Function logic. Note the extraction and injection of `responseSchema` to support Structured JSON Output:
```typescript
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { GoogleGenerativeAI } from "@google/generative-ai";

initializeApp();

const geminiApiKey = process.env.GEMINI_API_KEY || "";
const ai = new GoogleGenerativeAI(geminiApiKey);

export const generateAiContent = onCall({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { prompt, imageData, responseMimeType, responseSchema } = request.data as {
    prompt: string;
    imageData?: { base64: string; mimeType: string };
    responseMimeType?: string;
    responseSchema?: any;
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
    if (responseSchema) {
      config.responseSchema = responseSchema;
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: config
    });
    const response = await result.response;
    return { text: response.text() };
  } catch (error: any) {
    throw new HttpsError("internal", `AI Generation failed: ${error.message}`);
  }
});
```

### 3. Deploying Environment Secrets
Create a `.env` file under `firebase/functions/` to pass the Gemini key at deployment time:
```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

---

## 4. Frontend Integration Blueprint

For the React frontend application:

### 1. Direct-to-Storage Image Uploads
Do not upload files as Base64 to Firestore. Upload directly to Firebase Storage using the SDK and save the returned download URL:
```typescript
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

const storage = getStorage();

export async function uploadImage(file: File, userId: string): Promise<string> {
  const fileRef = ref(storage, `users/${userId}/${Date.now()}-${file.name}`);
  const snapshot = await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}
```

### 2. Calling the Cloud Function AI Proxy
Call the Cloud Function from React using the `httpsCallable` SDK, passing the prompt and schema structures:
```typescript
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions();

export async function requestAiAnalysis(prompt: string, base64Image?: string) {
  const generateFunction = httpsCallable(functions, "generateAiContent");
  
  const response = await generateFunction({
    prompt,
    imageData: base64Image ? { base64: base64Image, mimeType: "image/jpeg" } : null,
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" }
      },
      required: ["title", "summary"]
    }
  });
  
  return JSON.parse((response.data as { text: string }).text);
}
```

---

## 5. One-Click Deployment Automation Script

Save this script as `deploy.sh` in the project root to compile and push rules, database indexes, serverless functions, and static assets in one run:

```bash
#!/bin/bash
set -e

echo "=== 1. Deploying Rules and Configurations ==="
cd firebase
npx firebase-tools deploy --only firestore:rules,storage

echo "=== 2. Compiling and Deploying Serverless Functions ==="
cd functions
npm run build
cd ..
npx firebase-tools deploy --only functions:generateAiContent

# Note: If the codebase name is fully isolated as defined in Part 2,
# you can safely use the generic deploy command instead:
# npx firebase-tools deploy --only functions

echo "=== 3. Building and Deploying Frontend ==="
cd ../frontend
npm run build
rm -rf ../firebase/public/*
cp -R dist/* ../firebase/public/
cd ../firebase
npx firebase-tools deploy --only hosting

echo "=== App Successfully Deployed! ==="
```

---

## 6. Shared Project Function Protection Guidelines

> [!WARNING]
> **Accidental Deletion of Functions in Shared Firebase Projects**
> If you have multiple repositories or apps (e.g. Enphase Solar Dashboard and Toolshed Organizer) deploying to the same Firebase Project ID:
> 
> 1. **Option A (Best Practice)**: Ensure every project uses a unique `"codebase"` identifier inside its `firebase.json` configuration. Firebase CLI will only manage and clean up functions belonging to the matching codebase target.
> 2. **Option B (Targeted Deployments)**: Deploy functions explicitly by name to guarantee other functions are never touched:
>    - **For Enphase**: `npx firebase-tools deploy --only functions:syncCloudHistory`
>    - **For Toolshed**: `npx firebase-tools deploy --only functions:generateAiContent,functions:lookupBarcode`

