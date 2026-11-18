import { useEffect, useRef, useState } from 'react';
import { Canvas, PencilBrush } from 'fabric';
import { DRAG_TOOLS, createShape, createText } from '../lib/tools.js';
import { pageRotation } from '../lib/pdf.js';
import { extractLines, lineBox, sampleColors, createReplacement } from '../lib/textEdit.js';

/** Configure a Fabric canvas for the active tool. Also re-run after undo/redo reloads objects. */
function applyTool(fc, tool, options) {
  const editText = tool === 'edittext';
  const selecting = tool === 'select' || tool === 'text' || editText;
  fc.isDrawingMode = tool === 'draw';
  fc.selection = tool === 'select';
  fc.skipTargetFind = DRAG_TOOLS.has(tool) || tool === 'draw';
  fc.defaultCursor = tool === 'text' ? 'text' : tool === 'select' || editText ? 'default' : 'crosshair';
  fc.hoverCursor = tool === 'eraser' ? 'pointer' : editText ? 'text' : 'move';
  fc.forEachObject((o) => {
    if (o.kind === 'cover') {
      // Patches over replaced text are never directly interactive
      o.selectable = false;
      o.evented = false;
      return;
    }
    o.selectable = editText ? o.kind === 'text' : selecting;
    o.evented = editText ? o.kind === 'text' : true;
    o.hoverCursor = tool === 'eraser' ? 'pointer' : null;
  });
  if (!selecting) fc.discardActiveObject();
  if (tool === 'draw') {
    const brush = new PencilBrush(fc);
    brush.color = options.inkColor;
    brush.width = options.strokeWidth;
    brush.decimate = 2;
    fc.freeDrawingBrush = brush;
  }
  fc.requestRenderAll();
}

/**
 * One PDF page: a PDF.js-rendered canvas underneath and a Fabric.js canvas on top
 * holding the user's edits. Fabric works in unscaled PDF points (1 unit = 1pt);
 * zoom is applied through Fabric's viewport so object coordinates never change.
 */
export default function PageView({
  page,
  index,
  pdfDoc,
  zoom,
  tool,
  options,
  registry,
  history,
  active,
  onActivate,
  onSelection,
  onToolDone,
}) {
  const wrapRef = useRef(null);
  const bgRef = useRef(null);
  const hostRef = useRef(null);
  const fcRef = useRef(null);
  const pdfPageRef = useRef(null);
  const loadingRef = useRef(false);
  const [size, setSize] = useState(null); // page size in points, after rotation
  const [nearViewport, setNearViewport] = useState(index < 3);
  const [rendering, setRendering] = useState(true);
  const [lines, setLines] = useState(null); // the PDF's own text, for the Edit text tool

  // Latest values for Fabric event handlers (bound once)
  const live = useRef({});
  live.current = { tool, options, onActivate, onSelection, onToolDone, zoom };

  // 1. Resolve the page and its size
  useEffect(() => {
    let cancelled = false;
    pdfDoc.getPage(page.srcIndex + 1).then((p) => {
      if (cancelled) return;
      pdfPageRef.current = p;
      const vp = p.getViewport({ scale: 1, rotation: pageRotation(p, page.rotation) });
      setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page.srcIndex, page.rotation]);

  // 2. Only rasterize pages near the viewport
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNearViewport(true), {
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 3. Render the PDF page (re-runs on zoom / rotation)
  useEffect(() => {
    const p = pdfPageRef.current;
    if (!size || !p || !nearViewport) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = p.getViewport({ scale: zoom * dpr, rotation: pageRotation(p, page.rotation) });
    const canvas = bgRef.current;
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    setRendering(true);
    const task = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    task.promise.then(
      () => setRendering(false),
      () => {}, // cancelled
    );
    return () => task.cancel();
  }, [size, zoom, nearViewport, page.rotation]);

  // 4. Create the Fabric canvas once
  const ready = !!size;
  useEffect(() => {
    if (!ready) return;
    const el = document.createElement('canvas');
    hostRef.current.appendChild(el);
    const fc = new Canvas(el, {
      width: size.w * zoom,
      height: size.h * zoom,
      preserveObjectStacking: true,
      selectionColor: 'rgba(99, 102, 241, 0.08)',
      selectionBorderColor: '#6366f1',
      selectionLineWidth: 1,
      enableRetinaScaling: true,
    });
    fc.setZoom(zoom);
    fcRef.current = fc;

    const entry = {
      canvas: fc,
      size,
      isLoading: () => loadingRef.current,
      /** Run several changes as a single undo step. */
      batch(fn) {
        loadingRef.current = true;
        try {
          fn();
        } finally {
          loadingRef.current = false;
        }
        history.commit(page.id);
      },
      async load(json) {
        loadingRef.current = true;
        try {
          fc.discardActiveObject();
          await fc.loadFromJSON(json);
          applyTool(fc, live.current.tool, live.current.options);
        } finally {
          loadingRef.current = false;
        }
        live.current.onSelection(page.id, null);
      },
    };
    registry.set(page.id, entry);
    history.init(page.id, fc);

    const commit = () => !loadingRef.current && history.commit(page.id);
    let drag = null;

    fc.on('mouse:down', (opt) => {
      const { tool, options } = live.current;
      live.current.onActivate(page.id);
      const pt = fc.getScenePoint(opt.e);

      if (tool === 'text') {
        if (opt.target) return; // clicking existing text selects / edits it
        const tb = createText(pt, options);
        fc.add(tb);
        fc.setActiveObject(tb);
        tb.enterEditing();
        live.current.onToolDone();
        return;
      }
      if (tool === 'eraser') {
        if (opt.target) {
          fc.remove(opt.target);
          fc.requestRenderAll();
        }
        return;
      }
      if (DRAG_TOOLS.has(tool)) drag = { start: pt, obj: null };
    });

    fc.on('mouse:move', (opt) => {
      if (!drag) return;
      const { tool, options } = live.current;
      const pt = fc.getScenePoint(opt.e);
      if (!drag.obj && Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) < 3) return;
      loadingRef.current = true; // suppress history while dragging
      if (drag.obj) fc.remove(drag.obj);
      drag.obj = createShape(tool, drag.start, pt, options, opt.e.shiftKey);
      drag.obj.selectable = false;
      fc.add(drag.obj);
      loadingRef.current = false;
      fc.requestRenderAll();
    });

    fc.on('mouse:up', () => {
      if (!drag) return;
      const obj = drag.obj;
      drag = null;
      if (!obj) return;
      obj.setCoords();
      commit();
    });

    // Empty text boxes are committed once the user finishes typing
    fc.on('object:added', ({ target }) => (target.kind === 'text' && !target.text ? null : commit()));
    fc.on('object:removed', commit);
    fc.on('object:modified', ({ target, transform }) => {
      if (target && transform) target.pristine = false; // moved / resized / rotated by hand
      commit();
    });
    // Tag freehand strokes before they're added (object:added fires before path:created)
    fc.on('before:path:created', ({ path }) => path.set({ kind: 'draw', strokeUniform: true }));
    // Fabric keeps using the object right after this event, so removals wait a tick
    fc.on('text:editing:exited', ({ target }) => setTimeout(() => finishTextEdit(target)));
    const finishTextEdit = (target) => {
      if (!fc.getObjects().includes(target)) return;
      if (target.sourceId && target.pristine && target.text === target.originalText) {
        // Opened an existing line but changed nothing: put the original back untouched
        const cover = fc.getObjects().find((o) => o.kind === 'cover' && o.sourceId === target.sourceId);
        loadingRef.current = true;
        fc.remove(...[target, cover].filter(Boolean));
        loadingRef.current = false;
        commit();
        return;
      }
      // An emptied replacement leaves its cover behind: that deletes the original line
      if (!target.text.trim()) fc.remove(target);
      else commit();
    };

    const sel = () => live.current.onSelection(page.id, fc.getActiveObjects());
    fc.on('selection:created', sel);
    fc.on('selection:updated', sel);
    fc.on('selection:cleared', sel);

    return () => {
      registry.delete(page.id);
      fc.dispose();
      fcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 5. Keep Fabric in sync with zoom and rotation
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc || !size) return;
    fc.setDimensions({ width: size.w * zoom, height: size.h * zoom });
    fc.setZoom(zoom);
    const entry = registry.get(page.id);
    if (entry) entry.size = size;
    fc.requestRenderAll();
  }, [size, zoom, registry, page.id]);

  // 6. Apply the active tool
  useEffect(() => {
    if (fcRef.current) applyTool(fcRef.current, tool, options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, options.inkColor, options.strokeWidth, ready]);

  // 7. Edit text: read the page's text once it has rendered (fonts are known by then)
  useEffect(() => setLines(null), [page.rotation]);
  useEffect(() => {
    const p = pdfPageRef.current;
    if (tool !== 'edittext' || lines || !p || !size || rendering) return;
    let cancelled = false;
    extractLines(p, pageRotation(p, page.rotation), bgRef.current)
      .then((l) => !cancelled && setLines(l))
      .catch(() => !cancelled && setLines([]));
    return () => {
      cancelled = true;
    };
  }, [tool, lines, size, rendering, page.rotation]);

  const startEdit = (line, e) => {
    const fc = fcRef.current;
    if (!fc) return;
    onActivate(page.id);
    const colors = sampleColors(bgRef.current, size.w, line);
    const { cover, text } = createReplacement(line, colors);
    text.originalFont = line.originalFont;
    // Not an undo step yet: committed when typing finishes, dropped if nothing changed
    loadingRef.current = true;
    fc.add(cover, text);
    loadingRef.current = false;
    fc.setActiveObject(text);
    text.enterEditing();
    try {
      text.setCursorByClick(e);
    } catch {
      text.selectAll();
    }
    fc.requestRenderAll();
  };

  const edited = new Set(
    (fcRef.current?.getObjects() ?? []).filter((o) => o.kind === 'cover').map((o) => o.sourceId),
  );

  return (
    <div
      ref={wrapRef}
      className={`page ${active ? 'is-active' : ''}`}
      data-page-id={page.id}
      style={size ? { width: size.w * zoom, height: size.h * zoom } : { width: 612 * zoom, height: 792 * zoom }}
    >
      <canvas ref={bgRef} className="page-bg" style={{ width: '100%', height: '100%' }} />
      <div ref={hostRef} className="page-fabric" />
      {tool === 'edittext' && lines && (
        <div className="text-layer">
          {lines
            .filter((l) => !edited.has(l.id))
            .map((l) => {
              const b = lineBox(l);
              return (
                <div
                  key={l.id}
                  className="text-line"
                  title={`Click to edit · ${l.originalFont}, ${Math.round(l.fontSize * 10) / 10} pt`}
                  style={{
                    left: b.left.x * zoom,
                    top: b.left.y * zoom,
                    width: b.width * zoom,
                    height: b.height * zoom,
                    transform: `rotate(${b.angleDeg}deg)`,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startEdit(l, e.nativeEvent);
                  }}
                />
              );
            })}
          {lines.length === 0 && (
            <div className="text-layer-empty">No editable text on this page. It may be a scanned image.</div>
          )}
        </div>
      )}
      {rendering && <div className="page-loading shimmer" />}
      <span className="page-number">{index + 1}</span>
    </div>
  );
}
