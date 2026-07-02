import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import {
  parseWorkbook,
  fillWorkbook,
  extractAccountDetails,
  buildAnalysis,
  fetchChaosMetrics,
  ChaosMetrics,
} from './success-plan-engine';
import { AnalysisResult } from './types';
import { generatePdf } from './exports/pdf';
import { generateDocx } from './exports/docx';
import { generatePptx } from './exports/pptx';
import { fileStem } from './exports/theme';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Accept JSON payloads (the analysis result) for export endpoints.
app.use(express.json({ limit: '4mb' }));

// Serve the static UI.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Accept a single .xlsx/.xls upload, in memory, max 15 MB.
const ALLOWED = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/octet-stream', // some browsers
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okExt = ext === '.xlsx' || ext === '.xls';
    if (okExt || ALLOWED.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Please upload an Excel file (.xlsx or .xls).'));
    }
  },
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.post(
  '/api/analyze',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof Error) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      // Fetch the four chaos metrics from Harness and inject them into the
      // Chaos-Data-Questionnaire tab. If Harness is unreachable, continue
      // analyzing the questionnaire tabs without the chaos data.
      let metrics: ChaosMetrics | undefined;
      const warnings: string[] = [];
      try {
        metrics = await fetchChaosMetrics();
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('Chaos metrics fetch failed:', reason);
        warnings.push(
          'Live chaos data could not be fetched, so the Chaos-Data-Questionnaire ' +
            'values were left blank and its fields are scored as gaps. Set ' +
            'HARNESS_API_KEY, HARNESS_BASE_URL and HARNESS_ACCOUNT_ID in the ' +
            'environment to enable them.'
        );
      }

      const items = await parseWorkbook(req.file.buffer, metrics);
      const accountDetails = await extractAccountDetails(req.file.buffer);

      if (items.length === 0) {
        return res.status(422).json({
          error:
            'No checkbox / Yes-No answers could be detected in the workbook. ' +
            'Make sure ticked items are represented as TRUE/FALSE, Yes/No, or ✓ markers in cells.',
        });
      }

      const analysis = buildAnalysis(
        req.file.originalname,
        items,
        warnings,
        metrics,
        accountDetails
      );
      res.json(analysis);
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error:
          'Failed to process the workbook. Please confirm it is a valid Excel file.',
      });
    }
  }
);

// --------------------------------------------------------------------------
// Filled workbook: return the uploaded Excel with the four chaos metrics
// written into Col 2 of the Chaos-Data-Questionnaire tab.
// --------------------------------------------------------------------------
app.post(
  '/api/fill',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof Error) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const metrics = await fetchChaosMetrics();
      const buffer = await fillWorkbook(req.file.buffer, metrics);

      const base = req.file.originalname.replace(/\.[^.]+$/, '');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${base}-filled.xlsx"`
      );
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (e) {
      console.error('Fill failed:', e);
      res.status(500).json({
        error:
          'Failed to fill the workbook. Confirm the Harness credentials in .env and that the file is a valid Excel workbook.',
      });
    }
  }
);

// --------------------------------------------------------------------------
// Export endpoints: PDF / Word / PowerPoint
// The client POSTs the AnalysisResult it already has; we render a document.
// --------------------------------------------------------------------------

function isAnalysis(body: unknown): body is AnalysisResult {
  const b = body as AnalysisResult;
  return (
    !!b &&
    typeof b === 'object' &&
    !!b.overall &&
    Array.isArray(b.plan) &&
    Array.isArray(b.tabs)
  );
}

type ExportFormat = 'pdf' | 'docx' | 'pptx';

const CONTENT_TYPE: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  docx:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

app.post('/api/export/:format', async (req: Request, res: Response) => {
  const format = req.params.format as ExportFormat;
  if (!['pdf', 'docx', 'pptx'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported export format.' });
  }
  if (!isAnalysis(req.body)) {
    return res
      .status(400)
      .json({ error: 'Invalid or missing analysis payload.' });
  }

  const data = req.body as AnalysisResult;

  try {
    let buffer: Buffer;
    if (format === 'pdf') buffer = await generatePdf(data);
    else if (format === 'docx') buffer = await generateDocx(data);
    else buffer = await generatePptx(data);

    const filename = `${fileStem(data.fileName || 'account')}.${format}`;
    res.setHeader('Content-Type', CONTENT_TYPE[format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) {
    console.error(`Export (${format}) failed:`, e);
    res
      .status(500)
      .json({ error: `Failed to generate the ${format.toUpperCase()} file.` });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Red Account Plan running at http://localhost:${PORT}\n`);
});
