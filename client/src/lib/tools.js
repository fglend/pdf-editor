import { Textbox, Rect, Ellipse, Line, Path, FabricImage, Point } from 'fabric';
import {
  MousePointer2,
  Type,
  Pencil,
  Highlighter,
  Square,
  Circle,
  Minus,
  MoveUpRight,
  Eraser,
  TextCursorInput,
} from 'lucide-react';

/** Extra properties we store on Fabric objects (kept through undo/redo). */
export const CUSTOM_PROPS = ['kind', 'sourceId', 'originalText', 'originalFont', 'pristine'];

export const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2, hint: 'Click to select. Drag to move, use the handles to resize or rotate. Double-click text to edit it.' },
  { id: 'edittext', label: 'Edit text', key: 'X', icon: TextCursorInput, hint: 'Click any text in the PDF to change it. Clear a line completely to delete it.' },
  { id: 'text', label: 'Add text', key: 'T', icon: Type, hint: 'Click anywhere on a page to add new text. Press Esc when you’re done typing.' },
  { id: 'draw', label: 'Draw', key: 'D', icon: Pencil, hint: 'Draw freehand: great for signatures and quick marks.' },
  { id: 'highlight', label: 'Highlight', key: 'H', icon: Highlighter, hint: 'Drag over text to highlight it.' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: Square, hint: 'Drag to draw a rectangle. Hold Shift for a square.' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle, hint: 'Drag to draw an ellipse. Hold Shift for a circle.' },
  { id: 'line', label: 'Line', key: 'L', icon: Minus, hint: 'Drag to draw a straight line. Hold Shift to snap to 45°.' },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight, hint: 'Drag to draw an arrow. Hold Shift to snap to 45°.' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser, hint: 'Click any edit to remove it. (Original PDF content can’t be erased.)' },
];

export const DRAG_TOOLS = new Set(['highlight', 'rect', 'ellipse', 'line', 'arrow']);

export const FONTS = [
  { label: 'Sans (Helvetica)', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Serif (Times)', value: '"Times New Roman", Times, serif' },
  { label: 'Mono (Courier)', value: '"Courier New", Courier, monospace' },
];

export const SWATCHES = ['#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#2563eb', '#8b5cf6', '#ffffff'];

export const DEFAULT_OPTIONS = {
  textColor: '#111827',
  inkColor: '#ef4444',
  shapeColor: '#2563eb',
  highlightColor: '#facc15',
  strokeWidth: 3,
  fontSize: 16,
  fontFamily: FONTS[0].value,
};

/** Which color option a tool (or object kind) uses. */
export function colorKeyFor(kind) {
  if (kind === 'text') return 'textColor';
  if (kind === 'draw') return 'inkColor';
  if (kind === 'highlight') return 'highlightColor';
  return 'shapeColor';
}

const common = {
  originX: 'left',
  originY: 'top',
  strokeUniform: true,
  borderColor: '#6366f1',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#6366f1',
  cornerStyle: 'circle',
  cornerSize: 10,
  transparentCorners: false,
};

export function createText(point, opts) {
  return new Textbox('', {
    ...common,
    kind: 'text',
    left: point.x,
    top: point.y,
    width: 220,
    fontSize: opts.fontSize,
    fontFamily: opts.fontFamily,
    fill: opts.textColor,
    lineHeight: 1.2,
    splitByGrapheme: false,
    editingBorderColor: '#6366f1',
    cursorColor: opts.textColor,
  });
}

/** Creates a drag-shape between two points; called on every mouse move. */
export function createShape(tool, a, b, opts, shift) {
  if (tool === 'line' || tool === 'arrow') {
    const end = shift ? snap45(a, b) : b;
    if (tool === 'line') {
      return new Line([a.x, a.y, end.x, end.y], {
        ...common,
        kind: 'line',
        stroke: opts.shapeColor,
        strokeWidth: opts.strokeWidth,
        strokeLineCap: 'round',
      });
    }
    return new Path(arrowPath(a, end, opts.strokeWidth), {
      ...common,
      kind: 'arrow',
      fill: '',
      stroke: opts.shapeColor,
      strokeWidth: opts.strokeWidth,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    });
  }

  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (shift && tool !== 'highlight') w = h = Math.max(w, h);
  const left = b.x < a.x ? a.x - w : a.x;
  const top = b.y < a.y ? a.y - h : a.y;

  if (tool === 'highlight') {
    return new Rect({
      ...common,
      kind: 'highlight',
      left,
      top,
      width: w,
      height: h,
      fill: opts.highlightColor,
      opacity: 0.4,
      strokeWidth: 0,
    });
  }
  const Shape = tool === 'rect' ? Rect : Ellipse;
  const dims = tool === 'rect' ? { width: w, height: h, rx: 2, ry: 2 } : { rx: w / 2, ry: h / 2 };
  return new Shape({
    ...common,
    kind: tool,
    left,
    top,
    ...dims,
    fill: '',
    stroke: opts.shapeColor,
    strokeWidth: opts.strokeWidth,
  });
}

function snap45(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return new Point(a.x + Math.cos(angle) * len, a.y + Math.sin(angle) * len);
}

function arrowPath(a, b, strokeWidth) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(10, strokeWidth * 4);
  const spread = Math.PI / 7;
  const p1 = { x: b.x - head * Math.cos(angle - spread), y: b.y - head * Math.sin(angle - spread) };
  const p2 = { x: b.x - head * Math.cos(angle + spread), y: b.y - head * Math.sin(angle + spread) };
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${p1.x} ${p1.y} L ${b.x} ${b.y} L ${p2.x} ${p2.y}`;
}

export async function createImage(dataUrl, pageSize) {
  const img = await FabricImage.fromURL(dataUrl);
  const maxW = pageSize.w * 0.5;
  const maxH = pageSize.h * 0.5;
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  img.set({
    ...common,
    kind: 'image',
    scaleX: scale,
    scaleY: scale,
    left: (pageSize.w - img.width * scale) / 2,
    top: (pageSize.h - img.height * scale) / 2,
  });
  return img;
}

/** Rotate every object on a page by ±90° along with the page itself. */
export function rotateObjects(canvas, oldSize, delta) {
  for (const obj of canvas.getObjects()) {
    const c = obj.getCenterPoint();
    const next = delta > 0 ? new Point(oldSize.h - c.y, c.x) : new Point(c.y, oldSize.w - c.x);
    obj.rotate(((obj.angle || 0) + delta + 360) % 360);
    obj.setPositionByOrigin(next, 'center', 'center');
    obj.setCoords();
  }
}

