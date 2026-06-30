# Raju's Financial Plan & Retirement Optimizer

A high-performance, single-page client-side application for compiling financial forecasts, claim break-even analyses, and spousal retirement strategy calculations. 

The application is built as a static client-side web page, utilizes **Firebase Hosting** for web deployment, and uses **Cloud Firestore & Firebase Authentication** as its database and secure session backend.

---

## 🚀 Quick Start (Local Run)

Since the frontend is a pure static page, you can run it locally without a compilation step:
1. Open the [index.html](index.html) file directly in your web browser, OR
2. Serve it using a lightweight local web server (e.g., VS Code Live Server or `npx serve .`).

---

## ⚡ Deployment Instructions

Deployments are performed locally from your developer terminal directly to Firebase Hosting.

### Prerequisites
Ensure you have the Firebase CLI tools available. You can run them via `npx` (which downloads them on demand) or install them globally:
```bash
npm install -g firebase-tools
```

### Steps to Deploy:
1. **Log in to Firebase**:
   ```bash
   npx firebase-tools login
   ```
2. **Deploy the Site**:
   ```bash
   npx firebase-tools deploy
   ```
This command uploads [index.html](index.html) and configuration templates directly to your Firebase Hosting environment.

---

## 🗄️ Database & Security Setup (Firebase)

The application stores user configurations in the **Cloud Firestore** document collection named `user_configs`.

### Firestore Security Rules
To secure user data so that owners can only read and write their own calculations, apply these security rules under the **Firestore > Rules** tab in your Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /user_configs/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Authentication Providers
Enable **Google** or **Email/Password** sign-in methods in the **Authentication > Sign-in method** tab of the Firebase Console.

---

## ⚙️ Configuration & Credentials

### Option 1: Live Deployment (Automatic)
When running on Firebase Hosting, **no credentials setup is required**. The application automatically fetches the correct config dynamically from the reserved hosting helper path `/__/firebase/init.json`.

### Option 2: Local Developer Run
If you run the app locally on your laptop, the reserved hosting helper path will not be available. The app will look for fallback credentials:
1. **Local JSON file**: Copy the example template [config.json.example](config.json.example) to create `config.json`:
   ```bash
   cp config.json.example config.json
   ```
2. Add your Firebase keys in `config.json`:
   ```json
   {
     "apiKey": "YOUR_FIREBASE_API_KEY",
     "projectId": "YOUR_PROJECT_ID",
     "authDomain": "YOUR_AUTH_DOMAIN"
   }
   ```
3. **Manual Input**: If no configuration files are found, the app will show a connection modal asking you to paste these key parameters, which will be saved securely in your browser's local storage.
