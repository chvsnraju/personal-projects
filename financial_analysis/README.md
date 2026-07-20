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
          (Google OAuth) │                                │ Target: 'raju-planner'
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
| **Authentication** | Firebase Auth SDK (v10 compat) | Google OAuth session management |
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
| **Account Balances** | 401(k), Roth IRA, HSA, Brokerage | Primary and spouse balances. Monarch sync updates matched retirement, Roth, and brokerage accounts; HSA remains manual. |
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
| **Full Retirement Age (FRA)** | Age 67 | Model assumption appropriate for people born in 1960 or later. |
| **Standard Early/Late SSA Multipliers** | 62: 70%, 63: 75%, 64: 80%, 65: 86.7%, 66: 93.3%, 67: 100%, 68: 108%, 69: 116%, 70: 124% | Statutory Social Security reduction/delay benefit multipliers (overridden dynamically if custom statement estimates are provided). |
| **SSA Provisional Tax Thresholds (Joint)** | 50% tax tier at $32,000; 85% tax tier at $44,000 | IRS combined income thresholds determining taxable portion of Social Security benefits. |
| **SSA Provisional Tax Thresholds (Single)** | 50% tax tier at $25,000; 85% tax tier at $34,000 | IRS combined income thresholds for individual filers. |
| **401(k) Limit (2026)** | $24,500; $32,500 at 50+; $35,750 at ages 60-63 | IRS annual employee contribution limits. Employer match is modeled separately and is not capped by this employee limit. |
| **IRA Limit (2026)** | $7,500; $8,600 at 50+ | IRS annual contribution limits. Roth income eligibility phase-outs are not modeled. |
| **Family HSA Limit (2026)** | $8,750 plus $1,000 per eligible spouse age 55+ | Assumes family HDHP coverage and combines household catch-up amounts for projection purposes. |

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
           ├─► Matches account names/subtypes using generic rules plus MONARCH_ACCOUNT_RULES
           ├─► Calculates aggregate totals for Primary & Spouse
           ├─► Updates user_configs/{userId}.config.inputs in 'raju-planner' database
           │
           └─► Automated Weekly Snapshot Check:
               If latest snapshot in portfolio_history is >= 7 days old,
               appends new snapshot to portfolio_history array.
```

### 2. Firestore Multi-Database Binding (Client Fix)

The web client uses the pinned Firebase JS SDK v10 compat build. Compat does not expose a public named-database constructor, so the client binds its delegate to **`raju-planner`**:

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

The client binding uses Firebase internals and must be regression-tested before changing the CDN SDK version. A future migration should use the modular SDK's public named-database API.

---

## 🗄️ Database Data Schema (`raju-planner`)

Document Path: `user_configs/{userId}`

```json
{
  "config": {
    "userConfig": {
      "p1": {
        "name": "Primary",
        "birthMonth": 1,
        "birthYear": 1980,
        "age": 46,
        "pia": 3000,
        "salary": 100000,
        "ssa_estimates": {
          "62": 2100, "63": 2250, "64": 2400, "65": 2600,
          "66": 2800, "68": 3240, "69": 3480, "70": 3720
        }
      },
      "p2": {
        "name": "Spouse",
        "birthMonth": 3,
        "birthYear": 1982,
        "age": 44,
        "pia": 1800,
        "salary": 75000,
        "ssa_estimates": {
          "62": 1260, "63": 1350, "64": 1440, "65": 1560,
          "66": 1680, "68": 1944, "69": 2088, "70": 2232
        }
      },
      "defaults": {
        "return": 6.0,
        "cola": 3.0,
        "tax": 20.0
      }
    },
    "inputs": {
      "k401Balance": "250000",
      "k401BalanceSpouse": "100000",
      "rothBalance": "50000",
      "rothBalanceSpouse": "30000",
      "hsaBalance": "30000",
      "taxableBalance": "150000",
      "taxableBalanceSpouse": "50000",
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
        "k401P1": 250000,
        "k401P2": 100000,
        "rothP1": 50000,
        "rothP2": 30000,
        "hsa": 30000,
        "taxableP1": 150000,
        "taxableP2": 50000
      },
      "totals": {
        "k401Total": 350000,
        "rothTotal": 80000,
        "hsaTotal": 30000,
        "taxableTotal": 200000,
        "netWorth": 660000
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
The `syncBalancesOnDemand` callable requires Firebase authentication and compares `request.auth.uid` with the `TARGET_USER_ID` secret. Firestore rules independently restrict each document to the matching authenticated UID. Callable errors are sanitized before being returned to the browser, and account names and balances are not written to logs.

---

## Local Development

Prerequisites: Node.js 22, npm, and Firebase CLI authentication for emulator or deployment commands.

```bash
cp config.json.example config.json
cd functions
npm ci
npm run lint
npm run build
```

Fill `config.json` with the Firebase web configuration for local static hosting. Firebase web API keys identify a project and are not authorization secrets; Firestore rules and Firebase Auth enforce access. Do not place Monarch credentials or account rules in this file.

Serve the repository root with a local HTTP server so `config.json` can be fetched. For example, from the project root:

```bash
npx -y serve .
```

## Secrets

Set all Functions secrets before deployment:

```bash
npx -y firebase-tools functions:secrets:set MONARCH_EMAIL
npx -y firebase-tools functions:secrets:set MONARCH_PASSWORD
npx -y firebase-tools functions:secrets:set MONARCH_MFA_SECRET
npx -y firebase-tools functions:secrets:set TARGET_USER_ID
npx -y firebase-tools functions:secrets:set MONARCH_ACCOUNT_RULES
```

`MONARCH_ACCOUNT_RULES` is a JSON object. Matching is case-insensitive and each array contains substrings:

```json
{
  "include": ["additional institution or plan"],
  "exclude": ["529", "education"],
  "spouse": ["spouse display-name keyword"],
  "retirement": ["retirement account suffix"],
  "taxable": ["taxable account suffix"]
}
```

## Deployment

### 1. Build Cloud Functions TypeScript
```bash
cd functions
npm run build
```

### 2. Deploy Cloud Functions
```bash
npx -y firebase-tools deploy --only functions
```

### 3. Deploy Firestore Rules and Indexes
```bash
npx -y firebase-tools deploy --only firestore
```

### 4. Deploy Web Application (Firebase Hosting)
```bash
npx -y firebase-tools deploy --only hosting:rajuplanner
```

## Model Scope and Limitations

- Results are deterministic planning estimates, not financial, tax, or Social Security advice.
- FRA is fixed at 67; profiles born before 1960 require a birth-year-specific FRA implementation.
- The stop-work adjustment is an approximation, not SSA's indexed 35-year earnings-record calculation.
- Federal Social Security provisional-income thresholds are modeled; state taxes, deductions, filing-status changes, IRMAA, RMDs, NIIT, and detailed tax brackets are not.
- Roth IRA income phase-outs and future inflation adjustments to contribution limits are not modeled. The current 2026 nominal limits are reused in future projection years.
- HSA balances are treated as tax-free spendable assets and contribution caps assume family coverage. Non-qualified withdrawals and coverage eligibility are not modeled.
- Survivor benefits are approximated as the larger of the two ARF-adjusted streams, paid immediately upon the first death; survivor claiming-age rules (eligibility from age 60, survivor-specific reductions) are not modeled.
- In the drawdown simulator, Social Security income above the inflation-adjusted spending target is treated as spent, not reinvested.
- Monarch account classification depends on account names/subtypes and configured match rules. Exclude rules match against the institution name as well as account names. Review sync output in the UI before relying on aggregated balances.
