import {
  PDFDocument,
  StandardFonts,
  BlendMode,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';

/**
 * Builds the edited PDF. Runs in the browser (the app) and in Node (server/index.js).
 *
 * Every item carries a 6-number matrix (computed on the client from the PDF.js
 * viewport) that maps the item's local drawing space straight into the page's
 * PDF user space, so rotation, crop boxes, and object transforms are all handled
 * by one `cm` operator.
 *
 * spec.pages[i] = {
 *   source, rotation, width, height,
 *   overlay?, overlayMatrix?,              // PNG layer for raster edits
 *   items: [ {kind:'rect'|'text', matrix, ...} ]  // vector edits
 * }
 */
export async function buildPdf(srcBytes, spec, overlays) {
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create({ updateMetadata: false });

  const copied = await out.copyPages(
    src,
    spec.pages.map((p) => p.source),
  );

  const fonts = new Map();
  const getFont = async (key) => {
    if (!fonts.has(key)) fonts.set(key, await out.embedFont(StandardFonts[key] ?? StandardFonts.Helvetica));
    return fonts.get(key);
  };

  for (let i = 0; i < spec.pages.length; i++) {
    const ps = spec.pages[i];
    const page = out.addPage(copied[i]);
    page.setRotation(degrees(ps.rotation ?? 0));

    const items = ps.items ?? [];

    // 1. Highlights first, so they sit under ink and text
    for (const item of items.filter((it) => it.kind === 'rect')) {
      withMatrix(page, item.matrix, () =>
        page.drawRectangle({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          color: toRgb(item.color),
          opacity: item.opacity ?? 1,
          blendMode: item.blend === 'Multiply' ? BlendMode.Multiply : BlendMode.Normal,
        }),
      );
    }

    // 2. Raster layer (freehand ink, shapes, images)
    if (ps.overlay && overlays.has(ps.overlay)) {
      const img = await out.embedPng(overlays.get(ps.overlay));
      withMatrix(page, ps.overlayMatrix, () =>
        page.drawImage(img, { x: 0, y: 0, width: ps.width, height: ps.height }),
      );
    }

    // 3. Real, selectable text on top
    for (const item of items.filter((it) => it.kind === 'text')) {
      const font = await getFont(item.font);
      const text = encodable(font, item.text);
      if (!text.trim()) continue;
      withMatrix(page, item.matrix, () =>
        page.drawText(text, {
          x: 0,
          y: 0,
          size: item.size,
          font,
          color: toRgb(item.color),
          opacity: item.opacity ?? 1,
        }),
      );
    }
  }

  // Keep the original document's metadata
  const title = src.getTitle();
  if (title) out.setTitle(title);
  const author = src.getAuthor();
  if (author) out.setAuthor(author);
  const subject = src.getSubject();
  if (subject) out.setSubject(subject);
  out.setProducer('PDF Editor (pdf-lib)');
  out.setModificationDate(new Date());

  return out.save();
}

function withMatrix(page, m, draw) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  draw();
  page.pushOperators(popGraphicsState());
}

function toRgb(c) {
  const [r, g, b] = Array.isArray(c) ? c : [0, 0, 0];
  return rgb(r, g, b);
}

/** Standard 14 fonts only cover WinAnsi; swap anything else for '?' rather than failing the export. */
function encodable(font, text) {
  let result = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      result += ch;
    } catch {
      result += '?';
    }
  }
  return result;
}
