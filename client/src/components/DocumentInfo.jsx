import { Type, PenLine, Layers, ShieldCheck, TextCursorInput } from 'lucide-react';

const PAPER = [
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
  ['Tabloid', 792, 1224],
  ['A3', 842, 1191],
  ['A4', 595, 842],
  ['A5', 420, 595],
];

export function paperName(w, h) {
  const [s, l] = [Math.min(w, h), Math.max(w, h)];
  const match = PAPER.find(([, pw, ph]) => Math.abs(pw - s) < 3 && Math.abs(ph - l) < 3);
  if (!match) return 'Custom';
  return `${match[0]} ${w > h ? 'landscape' : 'portrait'}`;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const fmtDate = (d) => (d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd title={String(value)}>{value}</dd>
    </div>
  );
}

export default function DocumentInfo({ doc, pages, pageSize, activeIndex, totalEdits, replacedLines }) {
  const m = doc.meta ?? {};
  const removed = doc.pdfDoc.numPages - new Set(pages.map((p) => p.srcIndex)).size;
  const rotated = pages.filter((p) => p.rotation % 360 !== 0).length;
  const reordered = pages.some((p, i) => p.srcIndex !== i);

  return (
    <div className="props">
      <section className="prop-section">
        <h4>File</h4>
        <dl className="info">
          <Row label="Name" value={doc.name} />
          <Row label="Size" value={formatBytes(doc.size)} />
          <Row label="Pages" value={`${pages.length}${pages.length !== doc.pdfDoc.numPages ? ` (originally ${doc.pdfDoc.numPages})` : ''}`} />
          <Row label="PDF version" value={m.version} />
        </dl>
      </section>

      {pageSize && (
        <section className="prop-section">
          <h4>Current page ({activeIndex + 1})</h4>
          <dl className="info">
            <Row label="Paper" value={paperName(pageSize.w, pageSize.h)} />
            <Row label="Points" value={`${Math.round(pageSize.w)} × ${Math.round(pageSize.h)} pt`} />
            <Row label="Inches" value={`${(pageSize.w / 72).toFixed(2)} × ${(pageSize.h / 72).toFixed(2)} in`} />
            <Row label="Millimetres" value={`${Math.round((pageSize.w / 72) * 25.4)} × ${Math.round((pageSize.h / 72) * 25.4)} mm`} />
          </dl>
        </section>
      )}

      <section className="prop-section">
        <h4>Metadata</h4>
        <dl className="info">
          <Row label="Title" value={m.title || '—'} />
          <Row label="Author" value={m.author} />
          <Row label="Subject" value={m.subject} />
          <Row label="Created with" value={m.creator} />
          <Row label="Producer" value={m.producer} />
          <Row label="Created" value={fmtDate(m.created)} />
          <Row label="Modified" value={fmtDate(m.modified)} />
        </dl>
      </section>

      <section className="prop-section">
        <h4>Your changes</h4>
        <ul className="change-list">
          <li>
            <strong>{totalEdits}</strong> edit{totalEdits === 1 ? '' : 's'} on the pages
          </li>
          {replacedLines > 0 && (
            <li>
              <strong>{replacedLines}</strong> line{replacedLines === 1 ? '' : 's'} of original text changed or deleted
            </li>
          )}
          {removed > 0 && (
            <li>
              <strong>{removed}</strong> page{removed === 1 ? '' : 's'} removed
            </li>
          )}
          {rotated > 0 && (
            <li>
              <strong>{rotated}</strong> page{rotated === 1 ? '' : 's'} rotated
            </li>
          )}
          {reordered && <li>Pages reordered</li>}
        </ul>
      </section>

      <section className="prop-section">
        <h4>How your download is saved</h4>
        <ul className="explain">
          <li>
            <Type size={14} /> Text you add stays real text: you can still select and search it.
          </li>
          <li>
            <TextCursorInput size={14} /> Edited lines are covered with a patch matching the background, and your new
            text goes on top in Helvetica, Times or Courier. The old text still exists underneath, so don’t rely on
            this to hide sensitive information.
          </li>
          <li>
            <PenLine size={14} /> Drawings, shapes and images are flattened onto the page.
          </li>
          <li>
            <Layers size={14} /> The original page content and links are kept.
          </li>
          <li>
            <ShieldCheck size={14} /> Your PDF never leaves your device. It’s opened, edited and saved right in your browser.
          </li>
        </ul>
      </section>
    </div>
  );
}
