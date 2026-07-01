# Enphase & PECO Solar Analysis Dashboard

This project is a unified, authenticated single-page application built with React, TypeScript, and Firebase. It tracks daily solar production history (via the Enphase Cloud API) and monthly utility net metering metrics and payback progress (via PECO statement and screenshot uploads).

It is hosted at: **[https://chekuri-solar.web.app](https://chekuri-solar.web.app)**

---

## 📁 Project Structure

* **`frontend/`**: The React + Vite + TypeScript frontend source application.
  * `src/components/Dashboard.tsx`: Controls the dashboard tabs and layout.
  * `src/components/Metrics.tsx` & `Tables.tsx`: Metrics and log tables for daily solar output.
  * `src/components/MonthlyBilling.tsx`: Net metering analysis, ROI calculations, and Chart.js visualizations.
  * `src/components/DataManager.tsx`: File upload forms (for Gemini OCR parsing) and Firestore data editor.
* **`functions/`**: Node.js 22 + TypeScript Firebase Cloud Functions.
  * `src/index.ts`: Implements the OAuth Enphase API sync logic and the Gemini-powered billing PDF / screenshot parsers (`parsePecoBill`, `parseEnphaseScreenshot`).
* **`public/`**: The deployment hosting target containing the compiled Vite bundle.
* **`firestore.rules`** & **`firestore.indexes.json`**: Security rules and index specifications for the secondary Firestore database `enphase-solar`.

---

## 💻 Local Development Workflow

To work on this project locally, follow these steps:

### 1. Start the Firebase Local Emulators
Start the Auth, Firestore, Hosting, and Cloud Functions emulators:
```bash
cd Enphase_Analysis
npx firebase-tools emulators:start
```
* The emulator dashboard will be available at **`http://127.0.0.1:4000`**.
* The local mock app will be served at **`http://localhost:5002`**.

### 2. Run the React App in Dev Mode
To run the React app with hot reloading:
```bash
cd Enphase_Analysis/frontend
npm run dev
```
* When running on `localhost` (either Vite dev port or Emulator port `5002`), the app automatically detects the local environment and connects to the active Firebase Emulators instead of the production GCP services.

### 3. Log in to the Emulator
1. Open the mock app at `http://localhost:5002` (or Vite's dev server URL).
2. Click **Sign In with Google**.
3. In the emulator's sign-in popup, enter **`raju.chekuri@gmail.com`** as the email to satisfy database security rule assertions and gain dashboard access.

---

## 🛠️ Building & Copying Frontend Assets

When you finish making changes to the React source code under `frontend/src/`, you must compile it and copy the build bundle to the static `public/` directory before deploying to production hosting:

```bash
# 1. Navigate to the frontend directory
cd Enphase_Analysis/frontend

# 2. Compile the TypeScript and bundle the assets
npm run build

# 3. Copy the bundle output to the Firebase public directory
cp -rf dist/* ../public/
```

---

## 🚀 Deployment to Production

Deploy rules, functions, and hosting assets all in one step:

```bash
cd Enphase_Analysis
npx firebase-tools deploy
```

### Deploying Specific Targets
To speed up deployments, you can deploy individual components:
* **Hosting Only:** `npx firebase-tools deploy --only hosting`
* **Cloud Functions Only:** `npx firebase-tools deploy --only functions`
* **Firestore Rules Only:** `npx firebase-tools deploy --only firestore:rules`

*Note: The Cloud Functions utilize the `GEMINI_API_KEY` secret. This secret is already provisioned on the Google Cloud platform for the GCP project.*

---

## 🗄️ Database Structure (`enphase-solar` Database)

The application uses the secondary Firestore database **`enphase-solar`**. It contains the following collections:

1. **`daily_production`**:
   * Documents: Named `YYYY-MM-DD` (e.g. `2026-06-25`).
   * Fields: `productionWh` (number), `status` (string, e.g. `"Verified"`).
2. **`monthly_billing`**:
   * Documents: Named `YYYY-MM` (e.g. `2026-06`) for chronological sorting.
   * Fields: Contains utility billing records, customer charges, import/export kWh, and estimated savings.
3. **`configs`**:
   * Document `configs/investments`: Stores capital metrics (`invoice_amount`, `federal_tax_credit`, `actual_paid`, `net_investment`, etc.).
   * Document `configs/enphase`: Stores API developer credentials and OAuth access/refresh tokens.
