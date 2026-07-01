# Red Account Plan

A **Node.js + TypeScript** web app that turns an Excel **account health assessment** into an actionable **30-60-90 day Customer Success plan** to move an account from **Red → Yellow → Green**.

## What it does

1. **Upload** — A clean, drag-and-drop UI lets you upload an Excel workbook (`.xlsx` / `.xls`).
2. **Parse** — The backend reads **every tab** in the workbook and interprets checkboxes:
   - **Ticked = Yes** (`TRUE`, `Yes`, `Y`, `x`, `✓`, `1`, `[x]`, native cell checkboxes, …)
   - **Unticked = No** (`FALSE`, `No`, `N`, empty, `☐`, `0`, …)
3. **Plan** — A Customer Success engine scores account health across CS pillars
   (Relationship, Value, Adoption, Sentiment, Support, Commercial) and generates a
   phased 30-60-90 recovery plan with owners, success metrics, and exit criteria.
4. **Export** — Download the plan as an executive-ready **PDF**, **Word (.docx)**,
   or **PowerPoint (.pptx)** — all sharing one consistent, branded design system.

## Tech

- **Backend:** Express + TypeScript
- **Excel parsing:** ExcelJS (multi-format checkbox detection)
- **Upload:** Multer (in-memory, nothing persisted)
- **Exports:** PDFKit (PDF), docx (Word), pptxgenjs (PowerPoint)
- **Frontend:** Vanilla HTML/CSS/JS (no build step), Inter typeface

## Run it

```bash
npm install
npm run build
npm start
# open http://localhost:3000
```

Or in watch mode during development:

```bash
npm run dev
```

## Deploy for free on Render

This repo is deploy-ready for [Render](https://render.com) (free tier). It
includes a `render.yaml` Blueprint, a pinned Node version (`.node-version`),
and a `/api/health` health check.

### Option A — Blueprint (recommended, zero config)

1. Push this project to a GitHub repo.
2. In Render: **New +  ->  Blueprint**, select your repo.
3. Render reads `render.yaml` and provisions the web service automatically.
   Click **Apply** and wait for the first build.

### Option B — Manual web service

1. In Render: **New +  ->  Web Service**, connect your repo.
2. Configure:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
3. Create the service.

Notes:

- The app reads `process.env.PORT`, which Render injects automatically — no
  changes needed.
- On the **free** plan the instance sleeps after ~15 min idle; the first
  request afterward takes ~30–50s to wake (cold start). This is expected.
- Nothing is persisted to disk; uploads and generated documents are handled in
  memory per request, which suits Render's ephemeral filesystem.

## Generate a sample workbook to try

```bash
npm run build
node dist/scripts/makeSample.js
# creates sample-account-health.xlsx in the project root
```

## How checkboxes are interpreted

Excel templates encode "checkboxes" in several ways. This app handles the common ones:

| In the sheet                         | Interpreted as |
| ------------------------------------ | -------------- |
| `TRUE` / native cell checkbox on     | ✅ Yes         |
| `Yes`, `Y`, `x`, `✓`, `✔`, `1`, `[x]` | ✅ Yes         |
| `FALSE`, `No`, `N`, blank, `0`, `[ ]` | ❌ No          |

### Positive vs. negative (risk-flag) questions

Most questions are **positive** — ticked (Yes) is *good*. But some are **risk
flags** where ticking the box signals a *problem*, so ticked = bad. These are
detected automatically (see `src/polarity.ts`) and correctly **lower** the
health score. Examples:

- Did Champion Leave the Company
- Did Sponsor Leave the Company?
- Is there a re-org that happened?
- Training Gap
- Customer Resource Constraints
- Customer Technical Constraints
- Vulnerability Constraints
- Infosec Constraints
- Product Feature Gaps
- Product Bugs

Internally every answer is normalized to a health signal (`isRisk`):

| Question type | Ticked (Yes) | Unticked (No) |
| ------------- | ------------ | ------------- |
| Positive      | healthy ✅   | problem ❌    |
| Negative/risk | problem ❌   | healthy ✅    |

Each row is scanned for a **label** (the question text) and an **answer** (a
boolean-ish marker). Legacy form-control checkboxes are read from the raw sheet
XML when present.

## Project structure

```
src/
  server.ts        Express app + upload & export endpoints
  excelParser.ts   Reads tabs & detects ticked checkboxes
  planEngine.ts    Scores health & builds the 30-60-90 plan
  types.ts         Shared domain types
  exports/
    theme.ts       Shared brand palette / design tokens
    pdf.ts         Executive-ready PDF generator (PDFKit)
    docx.ts        Word document generator (docx)
    pptx.ts        PowerPoint deck generator (pptxgenjs)
  scripts/
    makeSample.ts  Generates a demo assessment workbook
public/
  index.html       Upload + results UI
  styles.css       Design system
  app.js           Client logic, rendering & export downloads
```

> No uploaded data is stored — files are processed in memory for the request only.
