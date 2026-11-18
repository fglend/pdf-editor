import { compose, invert } from './matrix.js';
import { pageRotation } from './pdf.js';

const OVERLAY_SCALE = 2.5; // raster layer resolution relative to 72 dpi
// Covers are sent as vector rects; the server draws rects in this same order, before the raster layer.

/**
 * Collects the edits from every page and asks the Node server to produce the final PDF.
 * Text and highlights are sent as vectors (text stays selectable/searchable);
 * everything else is flattened into one transparent PNG per page.
 */
export async function exportPdf({ bytes, pdfDoc, pages, registry, onProgress }) {
  const spec = { pages: [] };
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'source.pdf');

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i / pages.length);
    const pg = pages[i];
    const pdfPage = await pdfDoc.getPage(pg.srcIndex + 1);
    const rotation = pageRotation(pdfPage, pg.rotation);
    const vp = pdfPage.getViewport({ scale: 1, rotation });

    // Viewport space (y down, what Fabric uses) → PDF user space
    const toPdf = invert(vp.transform);
    const entry = { source: pg.srcIndex, rotation, width: vp.width, height: vp.height, items: [] };

    const canvas = registry.get(pg.id)?.canvas;
    if (canvas && canvas.getObjects().length) {
      const active = canvas.getActiveObject();
      if (active?.isEditing) active.exitEditing();
      canvas.discardActiveObject();

      const vector = [];
      for (const obj of canvas.getObjects()) {
        if (obj.kind === 'text') {
          entry.items.push(...textItems(obj, toPdf));
          vector.push(obj);
        } else if (obj.kind === 'highlight' || obj.kind === 'cover') {
          entry.items.push(rectItem(obj, toPdf));
          vector.push(obj);
        }
      }

      if (canvas.getObjects().length > vector.length) {
        vector.forEach((o) => (o.visible = false));
        const blob = await canvasToBlob(canvas.toCanvasElement(OVERLAY_SCALE / canvas.getZoom()));
        vector.forEach((o) => (o.visible = true));
        canvas.requestRenderAll();

        const name = `overlay-${i}.png`;
        form.append('overlays', blob, name);
        entry.overlay = name;
        // The PNG is drawn into a y-up box of width × height, flip it back into viewport space first
        entry.overlayMatrix = compose([1, 0, 0, -1, 0, vp.height], toPdf);
      }
    }
    spec.pages.push(entry);
  }

  form.append('spec', JSON.stringify(spec));
  onProgress?.(1);

  const res = await fetch('/api/export', { method: 'POST', body: form });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error || `Server responded with ${res.status}`);
  }
  return res.blob();
}

function textItems(obj, toPdf) {
  const items = [];
  const M = obj.calcTransformMatrix(); // object-local (origin at center) → page
  const color = hexToRgb(obj.fill);
  const font = pdfFontKey(obj);
  let offset = 0;

  obj.textLines.forEach((line, i) => {
    // Mirrors Fabric's baseline placement (_renderTextCommon + _renderTextLine)
    const baseline = -obj.height / 2 + offset + obj.getHeightOfLineImpl(i) * (1 - obj._fontSizeFraction);
    offset += obj.getHeightOfLine(i);
    if (!line.trim()) return;

    const left = -obj.width / 2 + obj._getLineLeftOffset(i);
    // Glyph space is y-up: flip, then move to the line's baseline
    const lineToLocal = [1, 0, 0, -1, left, baseline];
    items.push({
      kind: 'text',
      text: line,
      size: obj.fontSize,
      font,
      color,
      opacity: obj.opacity ?? 1,
      matrix: compose(compose(lineToLocal, M), toPdf),
    });
  });
  return items;
}

/** Highlights (multiply) and cover patches over replaced text (normal). */
function rectItem(obj, toPdf) {
  const cover = obj.kind === 'cover';
  return {
    kind: 'rect',
    x: -obj.width / 2,
    y: -obj.height / 2,
    width: obj.width,
    height: obj.height,
    color: hexToRgb(obj.fill),
    opacity: cover ? 1 : obj.opacity ?? 0.4,
    blend: cover ? 'Normal' : 'Multiply',
    matrix: compose(obj.calcTransformMatrix(), toPdf),
  };
}

function pdfFontKey(obj) {
  const bold = obj.fontWeight === 'bold' || Number(obj.fontWeight) >= 600;
  const italic = obj.fontStyle === 'italic';
  const family = obj.fontFamily || '';
  if (family.includes('Times')) {
    return bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold' : italic ? 'TimesRomanItalic' : 'TimesRoman';
  }
  if (family.includes('Courier')) {
    return bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold' : italic ? 'CourierOblique' : 'Courier';
  }
  return bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold' : italic ? 'HelveticaOblique' : 'Helvetica';
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function canvasToBlob(el) {
  return new Promise((resolve, reject) =>
    el.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render page edits'))), 'image/png'),
  );
}
