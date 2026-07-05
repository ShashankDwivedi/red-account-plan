# Red Account Plan

A Node.js + TypeScript web app for Harness Customer Success teams. Upload an Excel account health assessment and get an instant, AI-quality **30-60-90 day success plan** that diagnoses why an account is at risk and prescribes the exact actions needed to move it from Red → Yellow → Green.

---

## What Does the App Do?

### 1. Upload & Parse an Account Health Assessment

Drag and drop a structured Excel workbook (`.xlsx`). The app reads two questionnaire tabs:

- **`Harness-Questionnaire`** — checkbox-based questions across business dimensions (adoption, stakeholder engagement, support health, product fit, etc.)
- **`Chaos-Data-Questionnaire`** — chaos engineering metrics (license utilisation, teams onboarded, experiment runs, etc.)
- **`Account_Details`** — optional account metadata (name, ARR, region, renewal date, CSM, etc.)

### 2. Fetch Live Chaos Metrics from Harness API *(optional)*

If a `HARNESS_API_KEY` or `HARNESS_BEARER_TOKEN` is configured, the app automatically fetches four chaos metrics from the Harness platform for the account:

| Metric | Description |
|---|---|
| **Teams Onboarded %** | Projects actively running chaos vs. entitlement threshold |
| **License Utilisation %** | Services utilised vs. secondary entitlement |
| **Avg Monthly Experiment Runs** | Average runs per month over the selected date window |
| **Total Experiment Runs** | Cumulative runs in the date window |

> **On-prem / SMP customers**: If these four values are already filled in the Excel, the app skips the API call and uses the manual data instead.

> **Custom date range**: You can specify a `From` and `To` date in the UI to scope the chaos metrics query. Defaults to the last 365 days.

### 3. Identify What's Working & What's Not

The app scores every question and categorises findings into:

- **What's Not Working Well** — risks, split into *Business Related* and *Chaos* categories, with each answer shown (Yes/No or absolute value)
- **What's Working Well** — strengths, similarly categorised

### 4. Correlate Risks into Patterns

Individual risks are correlated into root-cause clusters (e.g. *"Low Platform Adoption"*, *"Chaos Engineering Not Operationalised"*, *"Weak Executive Alignment"*). This mimics how a senior Customer Success consultant thinks — looking past individual symptoms to understand the underlying problem.

### 5. Generate a Consultant-Quality 30-60-90 Day Plan

The plan engine produces three prioritised, actionable phases:

| Phase | Focus |
|---|---|
| **Days 1–30** | Stabilise — address the most critical risks immediately |
| **Days 31–60** | Build — establish repeatable processes and quick wins |
| **Days 61–90** | Scale — drive strategic alignment and long-term value |

Each phase surfaces the **top 3 actionable items**, tagged with the pattern they address.

### 6. Export to PDF, Word, and PowerPoint

One click generates executive-ready documents, all matching the UI layout:

- 📄 **PDF** — full plan with cover, account details, executive summary, chaos metrics, risk patterns, risks/strengths, and phased actions
- 📝 **Word (.docx)** — same content in an editable Word document
- 📊 **PowerPoint (.pptx)** — slide deck ready for executive presentations

---

## Project Structure

```
red-account-plan/
├── public/                        # Frontend (vanilla JS / HTML / CSS)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/
│   ├── server.ts                  # Express server & API endpoints
│   ├── types.ts                   # Shared TypeScript types
│   ├── chaos-data/                # Harness API integration
│   │   └── src/
│   │       ├── index.ts           # CLI tool: npx ts-node src/chaos-data/src/index.ts
│   │       ├── config.ts          # Loads .env config (API key / bearer token)
│   │       ├── harnessClient.ts   # HTTP client for Harness APIs
│   │       └── thresholds.ts     # Metric scoring & threshold calculations
│   ├── success-plan-engine/       # Core plan generation logic
│   │   ├── excelParser.ts         # Reads & scores the Excel questionnaire
│   │   ├── planEngine.ts          # Pattern detection + 30-60-90 plan builder
│   │   ├── chaosData.ts           # Bridges chaos-data lib into the engine
│   │   └── polarity.ts            # Classifies positive vs. risk-flag questions
│   └── exports/                   # Document generation
│       ├── pdf.ts
│       ├── docx.ts
│       └── pptx.ts
├── .env                           # Local credentials (not committed)
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js** ≥ 20 (check with `node -v`)
- **npm** ≥ 9 (bundled with Node 20+)
- A Harness account with Chaos module (optional — only needed for live metric fetching)

---

## Setup

### Option A — Cursor (Recommended)

1. **Open the project in Cursor**
   ```bash
   cursor /path/to/red-account-plan
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create your `.env` file** in the project root:
   ```env
   # Use ONE of the following auth options:

   # Option 1 — Personal Access Token (PAT)
   HARNESS_API_KEY=pat.YOUR_ACCOUNT_ID.YOUR_KEY_ID.YOUR_SECRET

   # Option 2 — Bearer Token (use this if HARNESS_API_KEY is unavailable)
   HARNESS_BEARER_TOKEN=your-bearer-token-here

   HARNESS_BASE_URL=https://app.harness.io
   HARNESS_ACCOUNT_ID=your-harness-account-id
   ```
   > If `HARNESS_API_KEY` is commented out or absent, the app automatically falls back to `HARNESS_BEARER_TOKEN`.

4. **Start the dev server**
   ```bash
   npx ts-node src/server.ts
   ```
   The app is now running at **http://localhost:3000**

5. *(Optional)* Ask Cursor's AI agent to help: open the chat panel and say *"restart the server"* or *"fetch chaos data for account X"*.

---

### Option B — VS Code

1. **Open the project**
   ```bash
   code /path/to/red-account-plan
   ```

2. **Install dependencies** in the VS Code terminal:
   ```bash
   npm install
   ```

3. **Create your `.env` file** (same as above).

4. **Add a launch configuration** — create `.vscode/launch.json`:
   ```json
   {
     "version": "0.2.0",
     "configurations": [
       {
         "name": "Start Server",
         "type": "node",
         "request": "launch",
         "runtimeExecutable": "npx",
         "runtimeArgs": ["ts-node", "src/server.ts"],
         "cwd": "${workspaceFolder}",
         "console": "integratedTerminal",
         "env": {}
       }
     ]
   }
   ```
   Press **F5** to start, or run in the terminal:
   ```bash
   npx ts-node src/server.ts
   ```

5. Open **http://localhost:3000** in your browser.

---

### Option C — Claude (Claude.ai Projects / MCP)

If you are using Claude with MCP filesystem access:

1. Point Claude at the project directory via your MCP filesystem config.
2. Ask Claude to:
   - Read the `.env` file for account credentials
   - Run `npx ts-node src/chaos-data/src/index.ts` to fetch chaos metrics
   - Start the server with `npx ts-node src/server.ts`
3. Claude can answer questions about account data, fetch Harness metrics, and help debug the plan output — all by reading the project files directly.

---

## Running the Chaos Data CLI

You can fetch chaos metrics independently from the command line without uploading an Excel file:

```bash
# Last 365 days (default)
npx ts-node src/chaos-data/src/index.ts

# Custom date range
npx ts-node src/chaos-data/src/index.ts --start-date 2026-01-01 --end-date 2026-06-30

# Custom lookback window
npx ts-node src/chaos-data/src/index.ts --days 90
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serves the web UI |
| `POST` | `/api/analyze` | Upload Excel → returns full success plan JSON |
| `POST` | `/api/fill` | Upload Excel → returns filled workbook with chaos data |
| `POST` | `/api/export/pdf` | Upload Excel → returns generated PDF |
| `POST` | `/api/export/docx` | Upload Excel → returns generated Word document |
| `POST` | `/api/export/pptx` | Upload Excel → returns generated PowerPoint |

All `POST` endpoints accept `multipart/form-data` with:
- `file` — the `.xlsx` workbook
- `startDate` *(optional)* — `YYYY-MM-DD` start of chaos data window
- `endDate` *(optional)* — `YYYY-MM-DD` end of chaos data window

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HARNESS_API_KEY` | One of these | Personal Access Token (`pat.ACCOUNT.KEY.SECRET`) |
| `HARNESS_BEARER_TOKEN` | ↑ | JWT bearer token (fallback when API key is absent) |
| `HARNESS_ACCOUNT_ID` | Yes | Your Harness account ID |
| `HARNESS_BASE_URL` | No | Defaults to `https://app.harness.io` |

---

## Building for Production

```bash
npm run build       # Compiles TypeScript → dist/
npm start           # Runs the compiled server
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Excel parsing | ExcelJS |
| PDF generation | PDFKit |
| Word generation | docx |
| PowerPoint generation | pptxgenjs |
| File uploads | Multer |
| Frontend | Vanilla HTML / CSS / JavaScript |
