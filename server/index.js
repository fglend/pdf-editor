import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPdf } from '../client/src/lib/buildPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const MAX_BYTES = 200 * 1024 * 1024;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /api/export (multipart)
 *   file      – the original PDF
 *   spec      – JSON describing page order/rotation and the edits for each page
 *   overlays  – PNG layers (freehand, shapes, images), referenced by name from spec
 */
app.post(
  '/api/export',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'overlays', maxCount: 5000 },
  ]),
  async (req, res) => {
    try {
      const pdf = req.files?.file?.[0];
      if (!pdf) return res.status(400).json({ error: 'Missing PDF file.' });

      let spec;
      try {
        spec = JSON.parse(req.body.spec ?? '');
      } catch {
        return res.status(400).json({ error: 'Invalid edit spec.' });
      }
      if (!Array.isArray(spec?.pages) || spec.pages.length === 0) {
        return res.status(400).json({ error: 'The document has no pages to export.' });
      }

      const overlays = new Map((req.files.overlays ?? []).map((f) => [f.originalname, f.buffer]));
      const started = Date.now();
      const bytes = await buildPdf(pdf.buffer, spec, overlays);

      console.log(
        `[export] ${spec.pages.length} pages, ${overlays.size} overlays → ${(bytes.length / 1024).toFixed(0)} KB in ${Date.now() - started}ms`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', bytes.length);
      res.end(Buffer.from(bytes));
    } catch (err) {
      console.error('[export] failed:', err);
      const encrypted = /encrypt/i.test(err?.message ?? '');
      res.status(500).json({
        error: encrypted
          ? 'This PDF is encrypted and cannot be re-saved.'
          : `Export failed: ${err?.message ?? 'unknown error'}`,
      });
    }
  },
);

app.use((err, _req, res, _next) => {
  const tooLarge = err?.code === 'LIMIT_FILE_SIZE';
  res.status(tooLarge ? 413 : 500).json({ error: tooLarge ? 'File is too large (200 MB max).' : err.message });
});

// Production: serve the built client
const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`PDF editor API listening on http://localhost:${PORT}`));
