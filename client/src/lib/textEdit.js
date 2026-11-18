import { Util } from 'pdfjs-dist';
import { IText, Rect, Point } from 'fabric';
import { FONTS } from './tools.js';

/**
 * Reads the PDF's own text with PDF.js and groups the text runs into editable lines.
 * Coordinates are in viewport space at scale 1 (the same space Fabric uses).
 *
 * line = { id, text, x, y (baseline origin), angle (rad), fontSize, width,
 *          ascent, descent, fontName, family, bold, italic }
 */
export async function extractLines(pdfPage, rotation, bgCanvas) {
  const vp = pdfPage.getViewport({ scale: 1, rotation });
  const content = await pdfPage.getTextContent();
  const lines = [];
  let cur = null;

  const close = () => {
    if (cur && cur.text.trim()) lines.push(finish(cur, pdfPage, content.styles, lines.length));
    cur = null;
  };

  for (const item of content.items) {
    if (item.str === undefined) continue; // marked-content markers
    const style = content.styles[item.fontName] ?? {};
    if (style.vertical) {
      close();
      continue;
    }

    const tx = Util.transform(vp.transform, item.transform);
    const fontSize = Math.hypot(tx[2], tx[3]);
    const angle = Math.atan2(tx[1], tx[0]);
    const x = tx[4];
    const y = tx[5];

    if (!item.str.trim()) {
      if (cur && item.str.length) cur.pendingSpace = true;
      if (item.hasEOL) close();
      continue;
    }
    if (fontSize < 2) continue;

    const next = { x, y, angle, fontSize, fontName: item.fontName };
    if (cur && continues(cur, next) && !separated(cur, next, bgCanvas, vp.width)) {
      const along = (x - cur.x) * Math.cos(cur.angle) + (y - cur.y) * Math.sin(cur.angle);
      const gap = along - cur.width;
      if ((cur.pendingSpace || gap > fontSize * 0.15) && !cur.text.endsWith(' ') && !item.str.startsWith(' ')) cur.text += ' ';
      cur.text += item.str;
      cur.width = Math.max(cur.width, along + item.width);
      cur.fonts[item.fontName] = (cur.fonts[item.fontName] ?? 0) + item.str.length;
      cur.lastFont = item.fontName;
      cur.pendingSpace = false;
    } else {
      close();
      cur = {
        text: item.str,
        x,
        y,
        angle,
        fontSize,
        width: item.width,
        ascent: style.ascent,
        descent: style.descent,
        fonts: { [item.fontName]: item.str.length },
        lastFont: item.fontName,
        pendingSpace: false,
      };
    }
    if (item.hasEOL) close();
  }
  close();
  return lines;
}

/**
 * Does a text run continue the current line? It must share direction, baseline and size,
 * and the gap before it must look like a word space, not a column, tab stop or table cell.
 */
function continues(cur, next) {
  if (Math.abs(next.angle - cur.angle) > 0.01) return false;
  const ratio = next.fontSize / cur.fontSize;
  if (ratio < 0.8 || ratio > 1.25) return false;
  const dx = next.x - cur.x;
  const dy = next.y - cur.y;
  const along = dx * Math.cos(cur.angle) + dy * Math.sin(cur.angle);
  const perp = -dx * Math.sin(cur.angle) + dy * Math.cos(cur.angle);
  if (Math.abs(perp) > cur.fontSize * 0.3) return false;

  const gap = (along - cur.width) / cur.fontSize; // in ems
  if (gap < -0.5) return false; // overlaps / goes backwards
  if (gap > 0.8) return false; // wider than a word space: separate column or field
  // A font change with a gap wider than a word space (~0.25–0.35 em) means a separate
  // field ("Grand Total" bold, value regular). Inline bold words are only a space apart.
  if (next.fontName !== cur.lastFont && gap > 0.45) return false;
  return true;
}

/**
 * Is there a drawn line (e.g. a table border) in the gap between the current line and the
 * next run? Looks at the rendered page for a pixel column that is mostly "ink" from the
 * x-height up to the baseline. Only checked for horizontal text.
 */
function separated(cur, next, bgCanvas, pageWidth) {
  if (!bgCanvas?.width || Math.abs(cur.angle) > 0.01) return false;
  const k = bgCanvas.width / pageWidth;
  const x0 = Math.floor((cur.x + cur.width) * k) + 1;
  const x1 = Math.ceil(next.x * k) - 1;
  if (x1 - x0 < 1) return false;
  const y0 = Math.floor((cur.y - cur.fontSize * 0.7) * k);
  const y1 = Math.ceil(cur.y * k);
  const w = x1 - x0;
  const h = y1 - y0;
  if (h < 3 || y0 < 0) return false;
  let data;
  try {
    data = bgCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
  } catch {
    return false;
  }
  // Reference = the brightest-ish typical pixel in the gap (the cell background)
  const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let bgLum = 0;
  for (let i = 0; i < data.length; i += 4) bgLum = Math.max(bgLum, lum(i));
  for (let x = 0; x < w; x++) {
    let ink = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128 && Math.abs(lum(i) - bgLum) > 60) ink++;
    }
    if (ink >= h * 0.8) return true;
  }
  return false;
}

function finish(cur, pdfPage, styles, index) {
  // Dominant font of the line
  const fontName = Object.entries(cur.fonts).sort((a, b) => b[1] - a[1])[0][0];
  const info = fontInfo(pdfPage, fontName, styles[fontName]);
  let ascent = cur.ascent ?? 0.8;
  let descent = cur.descent ?? -0.2;
  if (!(ascent > 0.4 && ascent < 1.3)) ascent = 0.8;
  if (!(descent < 0 && descent > -0.6)) descent = -0.2;

  return {
    id: `l${index}`,
    text: cur.text.replace(/\s+$/, ''),
    x: cur.x,
    y: cur.y,
    angle: cur.angle,
    fontSize: cur.fontSize,
    width: cur.width,
    ascent,
    descent,
    fontName,
    ...info,
  };
}

/** Best-effort guess at family/weight/style from the embedded font's name. */
function fontInfo(pdfPage, fontName, style) {
  let name = '';
  let bold = false;
  let italic = false;
  let fallback = style?.fontFamily ?? 'sans-serif';
  try {
    if (pdfPage.commonObjs.has(fontName)) {
      const f = pdfPage.commonObjs.get(fontName);
      name = f?.name ?? '';
      bold = !!(f?.bold || f?.black);
      italic = !!f?.italic;
      fallback = f?.fallbackName || fallback;
    }
  } catch {
    // Font not loaded yet: fall back to the style info
  }
  const clean = name.replace(/^[A-Z]{6}\+/, '');
  bold ||= /bold|black|heavy|semibold|demi/i.test(clean);
  italic ||= /italic|oblique/i.test(clean);

  let family = FONTS[0].value; // sans
  if (/courier|mono|consol|menlo/i.test(clean) || fallback === 'monospace') family = FONTS[2].value;
  else if (/times|georgia|garamond|cambria|minion|palatino|book|serif/i.test(clean) && !/sans/i.test(clean)) family = FONTS[1].value;
  else if (!clean && fallback === 'serif') family = FONTS[1].value;

  return { family, bold, italic, originalFont: clean || fallback };
}

/** Rotate a local (x, y) offset by the line's angle (y-down space). */
function offset(line, dx, dy) {
  const c = Math.cos(line.angle);
  const s = Math.sin(line.angle);
  return new Point(line.x + dx * c - dy * s, line.y + dx * s + dy * c);
}

const PAD = 0.75;

/** Corners of a line's box in page space, for hit areas and colour sampling. */
export function lineBox(line) {
  const top = -line.ascent * line.fontSize - PAD;
  const bottom = -line.descent * line.fontSize + PAD;
  return {
    left: offset(line, -PAD, top),
    width: line.width + PAD * 2,
    height: bottom - top,
    angleDeg: (line.angle * 180) / Math.PI,
    corners: [
      offset(line, -PAD, top),
      offset(line, line.width + PAD, top),
      offset(line, line.width + PAD, bottom),
      offset(line, -PAD, bottom),
    ],
  };
}

/**
 * Samples the rendered page under a line: the most common colour around the edges
 * is the background (used for the cover patch), the most different pixel inside is the text colour.
 */
export function sampleColors(bgCanvas, pageWidth, line) {
  const fallback = { background: '#ffffff', text: '#000000' };
  if (!bgCanvas?.width) return fallback;
  const k = bgCanvas.width / pageWidth;
  const { corners } = lineBox(line);
  const xs = corners.map((p) => p.x * k);
  const ys = corners.map((p) => p.y * k);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const x1 = Math.min(bgCanvas.width, Math.ceil(Math.max(...xs)) + 2);
  const y1 = Math.min(bgCanvas.height, Math.ceil(Math.max(...ys)) + 2);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 3 || h < 3) return fallback;

  let data;
  try {
    data = bgCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
  } catch {
    return fallback;
  }

  // Background = most frequent (quantized) colour on the border ring
  const counts = new Map();
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const vote = (x, y) => {
    const [r, g, b, a] = at(x, y);
    const key = a < 10 ? 'transparent' : `${r >> 3},${g >> 3},${b >> 3}`;
    const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += a < 10 ? 255 : r;
    e.g += a < 10 ? 255 : g;
    e.b += a < 10 ? 255 : b;
    counts.set(key, e);
  };
  for (let x = 0; x < w; x++) {
    vote(x, 0);
    vote(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    vote(0, y);
    vote(w - 1, y);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const bg = [top.r / top.n, top.g / top.n, top.b / top.n].map(Math.round);

  // Text = pixel farthest from the background
  let best = 0;
  let fg = [0, 0, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const [r, g, b, a] = at(x, y);
      if (a < 10) continue;
      const d = (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2;
      if (d > best) {
        best = d;
        fg = [r, g, b];
      }
    }
  }
  return { background: toHex(bg), text: best > 1600 ? toHex(fg) : '#000000' };
}

const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Builds the cover patch + editable replacement text for a line. */
export function createReplacement(line, colors) {
  const box = lineBox(line);
  const deg = box.angleDeg;
  const cover = new Rect({
    kind: 'cover',
    sourceId: line.id,
    originX: 'left',
    originY: 'top',
    left: box.left.x,
    top: box.left.y,
    width: box.width,
    height: box.height,
    angle: deg,
    fill: colors.background,
    strokeWidth: 0,
    selectable: false,
    evented: false,
    objectCaching: false,
  });

  const text = new IText(line.text, {
    kind: 'text',
    sourceId: line.id,
    originalText: line.text,
    pristine: true,
    originX: 'left',
    originY: 'top',
    fontSize: line.fontSize,
    fontFamily: line.family,
    fontWeight: line.bold ? 'bold' : 'normal',
    fontStyle: line.italic ? 'italic' : 'normal',
    fill: colors.text,
    cursorColor: colors.text,
    lineHeight: 1.2,
    angle: deg,
    strokeUniform: true,
    borderColor: '#6366f1',
    editingBorderColor: '#6366f1',
    cornerColor: '#ffffff',
    cornerStrokeColor: '#6366f1',
    cornerStyle: 'circle',
    cornerSize: 10,
    transparentCorners: false,
  });
  // Put Fabric's first baseline exactly on the original baseline
  const baseline = text.getHeightOfLineImpl(0) * (1 - text._fontSizeFraction);
  const topLeft = offset(line, 0, -baseline);
  text.set({ left: topLeft.x, top: topLeft.y });
  text.setCoords();
  return { cover, text };
}
