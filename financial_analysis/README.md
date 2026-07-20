# Financial Forecast & Retirement Strategy Optimizer

A high-performance, responsive single-page web application and serverless platform for financial forecasting, retirement drawdown simulations, Social Security break-even analysis, spousal strategy optimization, and automated weekly net worth tracking.

---

## 🏛️ System Architecture

The application uses a hybrid serverless architecture combining a zero-compilation static client SPA with GCP/Firebase Cloud Functions for automated financial aggregation.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                FRONTEND CLIENT                                  │
│  index.html (Single Page App - Vanilla JS, CSS3, Chart.js, FontAwesome)         │
│  - Interactive Projections, SS Breakeven Tool, Drawdown Simulator, History      │
└────────────────────────┬────────────────────────────────┬───────────────────────┘
                         │                                │
        Firebase Auth    │                                │ Firestore Read/Write
        (Google / Email) │                                │ Target: 'raju-planner'
                         ▼                                ▼
              ┌─────────────────────┐          ┌──────────────────────────┐
              │    Firebase Auth    │          │  Cloud Firestore (GCP)   │
              │  Identity Platform  │          │  Database: raju-planner  │
              └─────────────────────┘          │  Collection: user_configs│
                                               └────────────▲─────────────┘
                                                            │
                                         Firestore Write    │ Automated Sync &
                                       Target: raju-planner │ Snapshots
                                                            │
                                               ┌────────────┴─────────────┐
                                               │   FIREBASE CLOUD FUNCTIONS│
                                               │   Node.js 22 (2nd Gen)   │
                                               │  - syncBalancesOnDemand  │
                                               │  - dailyMonarchSync      │
                                               └────────────▲─────────────┘
                                                            │
                                       GCP Secret Manager   │ GraphQL API Fetch
                                       Credentials          │ (monarch-money-ts)
                                                            │
                                               ┌────────────┴─────────────┐
                                               │   Monarch Money API      │
                                               │   Financial Accounts     │
                                               └──────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technology / Library | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | Vanilla HTML5, ES6+ JavaScript | Zero-build, instant loading static client application |
| **Styling & Design System** | Vanilla CSS3 (Custom Design Tokens) | Modern glassmorphism UI, light/dark mode support, responsive grid |
| **Visualizations** | Chart.js | Dynamic canvas charts for portfolio projections & Social Security breakeven |
| **Authentication** | Firebase Auth SDK (v10 compat) | Secure Google OAuth & Email/Password session management |
| **Database** | Cloud Firestore (`raju-planner` instance) | Remote document persistence for user states & history logs |
| **Cloud Hosting** | Firebase Hosting | CDN hosting under domain `https://rajuplanner.web.app` |
| **Serverless Functions** | Firebase Cloud Functions (2nd Gen, Node 22) | Automated background sync & GraphQL data integration |
| **External API Sync** | `monarch-money-ts` GraphQL Client | Fetch real-time account balances from Monarch Money |
| **Secrets Manager** | GCP Secret Manager | Securely stores Monarch credentials & target user IDs |
| **Scheduler** | GCP Cloud Scheduler | Triggers daily Monarch sync cron at 5:00 AM ET (`0 5 * * *`) |

---

## 📊 Dynamic vs. Hardcoded Logic

To ensure accurate review by developers and AI agents, the table below categorizes what is dynamically configured by users versus what is hardcoded as constant financial baseline rules.

### 1. Dynamic / User-Configurable Parameters

| Category | Parameter | Description / Behavior |
| :--- | :--- | :--- |
| **User Profiles** | Names, Birth Month & Year | Primary (`p1`) and Spouse (`p2`). Ages are computed dynamically relative to current date. |
| **Social Security Statements** | PIA & SSA Estimates | Primary and Spouse Primary Insurance Amount (PIA) at FRA (67), plus custom statement estimates for ages 62–70. |
| **Account Balances** | 401(k), Roth IRA, HSA, Brokerage | Primary & Spouse balances for 401(k), Roth IRA, Taxable Brokerage, and HSA. Synced from Monarch Money or entered manually. |
| **Contributions & Matches** | Monthly Additions & Matches | 401(k) monthly contributions, employer match %, Roth IRA monthly additions, and Taxable Brokerage monthly additions. |
| **Global Assumptions** | Return Rate (%) | Annual portfolio compound return rate (synced across all views). |
| **Global Assumptions** | Inflation / COLA (%) | Annual inflation rate used for Cost-of-Living-Adjustments (COLA) and real-dollar purchasing power views. |
| **Global Assumptions** | Withdrawal Tax Rate (%) | Effective tax rate on 401(k) / Tax-Deferred withdrawals in retirement. |
| **Tax Settings** | Tax Drag & Capital Gains Rate | Annual drag % and final capital gains tax % on Taxable Brokerage accounts. |
| **Retirement Parameters** | Target Retirement Age | Claiming age for Social Security, stop working age, and life expectancy (Primary & Spouse). |
| **History & Snapshots** | Settings History & Portfolio History | User configurations version ledger and weekly portfolio net worth snapshots. |

### 2. Hardcoded / Financial Baseline Constants

| Constant Rule | Value | Rationale / Source |
| :--- | :--- | :--- |
| **Full Retirement Age (FRA)** | Age 67 | Benchmark age under US Social Security law for 100% PIA benefit. |
| **Standard Early/Late SSA Multipliers** | 62: 70%, 63: 75%, 64: 80%, 65: 86.7%, 66: 93.3%, 67: 100%, 68: 108%, 69: 116%, 70: 124% | Statutory Social Security reduction/delay benefit multipliers (overridden dynamically if custom statement estimates are provided). |
| **SSA Provisional Tax Thresholds (Joint)** | 50% tax tier at $32,000; 85% tax tier at $44,000 | IRS combined income thresholds determining taxable portion of Social Security benefits. |
| **SSA Provisional Tax Thresholds (Single)** | 50% tax tier at $25,000; 85% tax tier at $34,000 | IRS combined income thresholds for individual filers. |
| **Default 401(k) Limit (2026)** | $23,500 | Standard IRS annual contribution ceiling. |
| **Default IRA Limit (2026)** | $7,000 | Standard IRS annual contribution ceiling. |

---

## 🔄 Data Sync & Serverless Pipelines

### 1. Monarch Money GraphQL Aggregation Pipeline

```
  Monarch Money GraphQL API
           │
           │ (Authenticated via MONARCH_EMAIL, MONARCH_PASSWORD, MONARCH_MFA_SECRET)
           ▼
  Cloud Function: performMonarchSync()
           │
           ├─► Matches account display names/subtypes to 401(k), Roth, and Brokerage
           ├─► Calculates aggregate totals for Primary & Spouse
           ├─► Updates user_configs/{userId}.config.inputs in 'raju-planner' database
           │
           └─► Automated Weekly Snapshot Check:
               If latest snapshot in portfolio_history is >= 7 days old,
               appends new snapshot to portfolio_history array.
```

### 2. Firestore Multi-Database Binding (Client Fix)

The web client uses Firebase JS SDK v10 compat mode. To prevent Firebase from defaulting to the `(default)` database, the client explicitly overrides `db._delegate` to bind to the **`raju-planner`** database:

```javascript
db = fbApp.firestore();
const modularDb = fbApp.container.getProvider('firestore').getImmediate({ identifier: 'raju-planner' });
if (modularDb) {
    db._delegate = modularDb;
}
```

Similarly, the Cloud Functions backend passes `"raju-planner"` to Node Admin SDK:
```typescript
const db = getFirestore("raju-planner");
```

---

## 🗄️ Database Data Schema (`raju-planner`)

Document Path: `user_configs/{userId}`

```json
{
  "config": {
    "userConfig": {
      "p1": {
        "name": "Raju V. Chekuri",
        "birthMonth": 5,
        "birthYear": 1975,
        "age": 51,
        "pia": 4127,
        "salary": 176100,
        "ssa_estimates": {
          "62": 2744, "63": 2970, "64": 3208, "65": 3519, 
          "66": 3826, "67": 4127, "68": 4377, "69": 4725, "70": 5186
        }
      },
      "p2": {
        "name": "Anuradha Chekuri",
        "birthMonth": 10,
        "birthYear": 1979,
        "age": 46,
        "pia": 1536,
        "salary": 41419,
        "ssa_estimates": {
          "62": 970, "63": 1057, "64": 1153, "65": 1277, 
          "66": 1404, "67": 1536, "68": 1599, "69": 1759, "70": 2021
        }
      },
      "defaults": {
        "return": 6.0,
        "cola": 3.0,
        "tax": 20.0
      }
    },
    "inputs": {
      "k401Balance": "772159",
      "k401BalanceSpouse": "5806",
      "rothBalance": "97934",
      "rothBalanceSpouse": "38027",
      "hsaBalance": "80000",
      "taxableBalance": "624951",
      "taxableBalanceSpouse": "10168",
      "retirementTax": "20"
    }
  },
  "history": [
    {
      "id": "hist_1784500000000",
      "timestamp": "2026-07-19T22:00:00.000Z",
      "label": "Saved Configuration v1",
      "favorite": true
    }
  ],
  "portfolio_history": [
    {
      "id": "snap_1784500000000",
      "timestamp": "2026-07-20T05:00:00.000Z",
      "dateLabel": "Jul 20, 2026",
      "note": "Automated Weekly Snapshot (Monarch Sync)",
      "favorite": false,
      "balances": {
        "k401P1": 772159,
        "k401P2": 5806,
        "rothP1": 97934,
        "rothP2": 38027,
        "hsa": 80000,
        "taxableP1": 624951,
        "taxableP2": 10168
      },
      "totals": {
        "k401Total": 777965,
        "rothTotal": 135961,
        "hsaTotal": 80000,
        "taxableTotal": 635119,
        "netWorth": 1629045
      }
    }
  ]
}
```

---

## 🔒 Security & Security Rules

### Firestore Security Rules (`firestore.rules`)
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

### On-Demand Cloud Function Security
The `syncBalancesOnDemand` Cloud Function restricts execution to authenticated users with `request.auth.token.email === "raju.chekuri@gmail.com"`.

---

## 🚀 Deployment Commands

### 1. Build Cloud Functions TypeScript
```bash
cd functions
npm run build
```

### 2. Deploy Cloud Functions
```bash
npx -y firebase-tools deploy --only functions
```

### 3. Deploy Web Application (Firebase Hosting)
```bash
npx -y firebase-tools deploy --only hosting:rajuplanner
```
