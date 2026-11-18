import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActiveSelection } from 'fabric';
import { SlidersHorizontal, Info, CheckCircle2, AlertCircle, X } from 'lucide-react';

import Toolbar from './components/Toolbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import PageView from './components/PageView.jsx';
import PropertiesPanel from './components/PropertiesPanel.jsx';
import DocumentInfo, { formatBytes, paperName } from './components/DocumentInfo.jsx';
import EmptyState from './components/EmptyState.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import { loadPdf, readMetadata, pageRotation } from './lib/pdf.js';
import { History } from './lib/history.js';
import { exportPdf } from './lib/exportPdf.js';
import { CUSTOM_PROPS, DEFAULT_OPTIONS, TOOLS, createImage, rotateObjects } from './lib/tools.js';

let seq = 0;
const newId = (p = 'p') => `${p}${++seq}`;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const NO_SELECTION = { pageId: null, objects: [] };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
const isImage = (f) => f && f.type.startsWith('image/');

export default function App() {
  const [doc, setDoc] = useState(null);
  const [pages, setPages] = useState([]);
  const [tool, setTool] = useState('select');
  const [options, setOptionsState] = useState(DEFAULT_OPTIONS);
  const [zoom, setZoom] = useState(1);
  const [activeId, setActiveId] = useState(null);
  const [selection, setSelection] = useState(NO_SELECTION);
  const [panel, setPanel] = useState('edit');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pagesDirty, setPagesDirty] = useState(false);
  const [savedTop, setSavedTop] = useState(undefined);
  const [toast, setToast] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [serverOk, setServerOk] = useState(null);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const registry = useMemo(() => new Map(), []);
  const history = useMemo(() => new History(registry, bump), [registry, bump]);
  const viewerRef = useRef(null);
  const pdfInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const commitTimers = useRef(new Map());
  const pendingRestore = useRef(new Map());
  const historyBusy = useRef(false);

  const selRef = useRef(selection);
  selRef.current = selection;

  // ── Derived info ─────────────────────────────────────────────
  const undoTop = history.undoStack.at(-1);
  const dirty = pagesDirty || undoTop !== savedTop;
  const editCounts = {};
  let totalEdits = 0;
  let replacedLines = 0;
  for (const p of pages) {
    const objs = registry.get(p.id)?.canvas.getObjects() ?? [];
    replacedLines += objs.filter((o) => o.kind === 'cover').length;
    // A replaced line is one edit (its cover patch isn't counted separately)
    const n = objs.filter((o) => o.kind !== 'cover' || !objs.some((t) => t.kind === 'text' && t.sourceId === o.sourceId)).length;
    editCounts[p.id] = n;
    totalEdits += n;
  }
  const activeIndex = Math.max(0, pages.findIndex((p) => p.id === activeId));
  const activeSize = registry.get(activeId)?.size ?? null;
  const toolInfo = TOOLS.find((t) => t.id === tool);

  // ── Helpers ──────────────────────────────────────────────────
  const notify = useCallback((type, message, action) => {
    setToast({ id: newId('t'), type, message, action });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const setOptions = useCallback((patch) => setOptionsState((o) => ({ ...o, ...patch })), []);

  const scheduleCommit = useCallback(
    (pageId) => {
      clearTimeout(commitTimers.current.get(pageId));
      commitTimers.current.set(
        pageId,
        setTimeout(() => history.commit(pageId), 350),
      );
    },
    [history],
  );

  const fitZoom = useCallback(async (pdfDoc, list) => {
    const viewer = viewerRef.current;
    if (!viewer || !list.length) return 1;
    const p = await pdfDoc.getPage(list[0].srcIndex + 1);
    const vp = p.getViewport({ scale: 1, rotation: pageRotation(p, list[0].rotation) });
    return clamp((viewer.clientWidth - 80) / vp.width, MIN_ZOOM, 2);
  }, []);

  const scrollToPage = useCallback((id) => {
    viewerRef.current?.querySelector(`[data-page-id="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveId(id);
  }, []);

  // ── Open ─────────────────────────────────────────────────────
  const openFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!isPdf(file)) return notify('error', `“${file.name}” isn’t a PDF file.`);
      if (dirty && !window.confirm('You have unsaved changes. Discard them and open another file?')) return;
      setLoading(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdfDoc = await loadPdf(bytes);
        const meta = await readMetadata(pdfDoc);
        doc?.pdfDoc.destroy();
        history.undoStack = [];
        history.redoStack = [];
        const list = Array.from({ length: pdfDoc.numPages }, (_, i) => ({ id: newId(), srcIndex: i, rotation: 0 }));
        setDoc({ id: newId('d'), name: file.name, size: file.size, bytes, pdfDoc, meta });
        setPages(list);
        setActiveId(list[0]?.id ?? null);
        setSelection(NO_SELECTION);
        setTool('select');
        setPagesDirty(false);
        setSavedTop(undefined);
        const fitted = await fitZoom(pdfDoc, list);
        if (fitted !== prevZoom.current) skipZoomAnchor.current = true; // a new document starts at the top
        setZoom(fitted);
        viewerRef.current?.scrollTo({ top: 0 });
      } catch (err) {
        console.error(err);
        notify(
          'error',
          err?.name === 'PasswordException'
            ? 'This PDF is password-protected. Remove the password and try again.'
            : 'Couldn’t open that file. It may be damaged or not a valid PDF.',
        );
      } finally {
        setLoading(false);
      }
    },
    [dirty, doc, history, notify, fitZoom],
  );

  // ── Export ───────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!doc || exporting) return;
    setExporting(true);
    try {
      const blob = await exportPdf({ bytes: doc.bytes, pdfDoc: doc.pdfDoc, pages, registry });
      const name = doc.name.replace(/\.pdf$/i, '') + ' (edited).pdf';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setSavedTop(history.undoStack.at(-1));
      setPagesDirty(false);
      setSelection(NO_SELECTION);
      notify('success', `Downloaded “${name}” · ${formatBytes(blob.size)}`);
    } catch (err) {
      console.error(err);
      notify(
        'error',
        err instanceof TypeError ? 'Can’t reach the export server. Is it running? (npm run dev)' : err.message,
      );
    } finally {
      setExporting(false);
    }
  }, [doc, exporting, pages, registry, history, notify]);

  // ── Selection & object editing ───────────────────────────────
  const handleSelection = useCallback(
    (pageId, objects) => {
      const prev = selRef.current;
      if (objects?.length) {
        if (prev.pageId && prev.pageId !== pageId) {
          const c = registry.get(prev.pageId)?.canvas;
          c?.discardActiveObject();
          c?.requestRenderAll();
        }
        setSelection({ pageId, objects: [...objects] });
        setPanel('edit');
      } else if (!prev.pageId || prev.pageId === pageId) {
        setSelection(NO_SELECTION);
      }
    },
    [registry],
  );

  const updateSelection = useCallback(
    (props) => {
      const { pageId, objects } = selRef.current;
      const c = registry.get(pageId)?.canvas;
      if (!c) return;
      objects.forEach((o) => {
        o.set({ ...props, pristine: false });
        o.setCoords();
      });
      c.requestRenderAll();
      bump();
      scheduleCommit(pageId);
    },
    [registry, bump, scheduleCommit],
  );

  const selectionAction = useCallback(
    async (action) => {
      const { pageId, objects } = selRef.current;
      const entry = registry.get(pageId);
      if (!entry || !objects.length) return;
      const c = entry.canvas;

      if (action === 'restore') {
        // Drop the replacement and its cover patch: the original PDF text shows again
        const ids = new Set(objects.map((o) => o.sourceId).filter(Boolean));
        const covers = c.getObjects().filter((o) => o.kind === 'cover' && ids.has(o.sourceId));
        c.discardActiveObject();
        entry.batch(() => c.remove(...objects.filter((o) => o.sourceId), ...covers));
      } else if (action === 'delete') {
        c.discardActiveObject();
        entry.batch(() => c.remove(...objects));
      } else if (action === 'front' || action === 'back') {
        objects.forEach((o) => (action === 'front' ? c.bringObjectToFront(o) : c.sendObjectToBack(o)));
        history.commit(pageId);
      } else if (action === 'duplicate') {
        c.discardActiveObject(); // returns grouped objects to page coordinates
        const clones = await Promise.all(objects.map((o) => o.clone(CUSTOM_PROPS)));
        entry.batch(() =>
          clones.forEach((o) => {
            // A copy of a replaced line is just ordinary added text
            o.set({ left: o.left + 12, top: o.top + 12, sourceId: undefined, originalText: undefined, pristine: false });
            c.add(o);
          }),
        );
        c.setActiveObject(clones.length === 1 ? clones[0] : new ActiveSelection(clones, { canvas: c }));
      }
      c.requestRenderAll();
    },
    [registry, history],
  );

  const nudge = useCallback(
    (dx, dy) => {
      const { pageId } = selRef.current;
      const c = registry.get(pageId)?.canvas;
      const a = c?.getActiveObject();
      if (!a) return;
      a.set({ left: a.left + dx, top: a.top + dy });
      a.setCoords();
      c.requestRenderAll();
      bump();
      scheduleCommit(pageId);
    },
    [registry, bump, scheduleCommit],
  );

  // ── Undo / redo ──────────────────────────────────────────────
  const runHistory = useCallback(
    async (dir) => {
      if (historyBusy.current) return;
      historyBusy.current = true;
      try {
        setSelection(NO_SELECTION);
        const pageId = dir === 'undo' ? await history.undo() : await history.redo();
        if (pageId && pageId !== activeId) scrollToPage(pageId);
      } finally {
        historyBusy.current = false;
      }
    },
    [history, activeId, scrollToPage],
  );

  // ── Pages ────────────────────────────────────────────────────
  const rotatePage = useCallback(
    (id, delta) => {
      const entry = registry.get(id);
      if (entry) {
        entry.canvas.discardActiveObject();
        rotateObjects(entry.canvas, entry.size, delta);
        history.forget(id); // older snapshots used the old orientation
        history.init(id, entry.canvas);
      }
      setPages((ps) => ps.map((p) => (p.id === id ? { ...p, rotation: p.rotation + delta } : p)));
      setPagesDirty(true);
    },
    [registry, history],
  );

  const movePage = useCallback((from, to) => {
    setPages((ps) => {
      if (to < 0 || to >= ps.length) return ps;
      const next = [...ps];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setPagesDirty(true);
  }, []);

  const deletePage = useCallback(
    (id) => {
      if (pages.length <= 1) return notify('error', 'A PDF needs at least one page.');
      const index = pages.findIndex((p) => p.id === id);
      const page = pages[index];
      const canvas = registry.get(id)?.canvas;
      const json = canvas?.getObjects().length ? JSON.stringify(canvas.toObject(CUSTOM_PROPS)) : null;

      history.forget(id);
      if (selRef.current.pageId === id) setSelection(NO_SELECTION);
      if (activeId === id) setActiveId(pages[index + 1]?.id ?? pages[index - 1]?.id);
      setPages((ps) => ps.filter((p) => p.id !== id));
      setPagesDirty(true);

      notify('info', `Page ${index + 1} deleted.`, {
        label: 'Undo',
        run: () => {
          if (json) pendingRestore.current.set(id, json);
          setPages((ps) => {
            const next = [...ps];
            next.splice(Math.min(index, next.length), 0, page);
            return next;
          });
        },
      });
    },
    [pages, registry, history, activeId, notify],
  );

  // Restore edits of an un-deleted page once its canvas exists
  useEffect(() => {
    for (const [id, json] of pendingRestore.current) {
      const entry = registry.get(id);
      if (!entry) continue;
      pendingRestore.current.delete(id);
      entry.load(json).then(() => {
        history.init(id, entry.canvas);
        bump();
      });
    }
  });

  // ── Images ───────────────────────────────────────────────────
  const insertImage = useCallback(
    async (file) => {
      const id = activeId ?? pages[0]?.id;
      const entry = registry.get(id);
      if (!entry || !isImage(file)) return;
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      try {
        const img = await createImage(dataUrl, entry.size);
        setTool('select');
        entry.canvas.add(img);
        entry.canvas.setActiveObject(img);
        entry.canvas.requestRenderAll();
        notify('success', `Image added to page ${pages.findIndex((p) => p.id === id) + 1}. Drag to place it.`);
      } catch {
        notify('error', 'That image couldn’t be loaded.');
      }
    },
    [activeId, pages, registry, notify],
  );

  // ── Zoom ─────────────────────────────────────────────────────
  const stepZoom = useCallback((dir) => {
    setZoom((z) =>
      dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM,
    );
  }, []);

  const fit = useCallback(async () => {
    if (doc) setZoom(await fitZoom(doc.pdfDoc, pages));
  }, [doc, pages, fitZoom]);

  // Keep the point in the middle of the screen steady while zooming
  const prevZoom = useRef(zoom);
  const skipZoomAnchor = useRef(false);
  useLayoutEffect(() => {
    const v = viewerRef.current;
    if (skipZoomAnchor.current) {
      skipZoomAnchor.current = false;
      v?.scrollTo({ top: 0 });
    } else if (v && prevZoom.current !== zoom) {
      const ratio = zoom / prevZoom.current;
      v.scrollTop = (v.scrollTop + v.clientHeight / 2) * ratio - v.clientHeight / 2;
    }
    prevZoom.current = zoom;
  }, [zoom]);

  // Pinch / ctrl+wheel zoom
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(Math.round(z * Math.exp(-e.deltaY * 0.01) * 100) / 100, MIN_ZOOM, MAX_ZOOM));
    };
    v.addEventListener('wheel', onWheel, { passive: false });
    return () => v.removeEventListener('wheel', onWheel);
  }, [doc]);

  // Track which page is in view
  const onScroll = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const line = v.getBoundingClientRect().top + v.clientHeight * 0.35;
    for (const el of v.querySelectorAll('.page')) {
      if (el.getBoundingClientRect().bottom > line) {
        const id = el.dataset.pageId;
        setActiveId((cur) => (cur === id ? cur : id));
        break;
      }
    }
  }, []);

  // ── Global keyboard, paste, drop, unload ─────────────────────
  const keyHandler = useRef(null);
  keyHandler.current = (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const cmd = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (cmd && k === 'o') return e.preventDefault(), pdfInputRef.current?.click();
    if (!doc) return;
    if (cmd && k === 's') return e.preventDefault(), handleExport();
    if (cmd && k === 'z') return e.preventDefault(), runHistory(e.shiftKey ? 'redo' : 'undo');
    if (cmd && k === 'y') return e.preventDefault(), runHistory('redo');
    if (cmd && (k === '=' || k === '+')) return e.preventDefault(), stepZoom(1);
    if (cmd && k === '-') return e.preventDefault(), stepZoom(-1);
    if (cmd && k === '0') return e.preventDefault(), fit();
    if (cmd && k === 'd') return e.preventDefault(), selectionAction('duplicate');
    if (cmd || e.altKey) return;

    if ((k === 'delete' || k === 'backspace') && selRef.current.objects.length) return e.preventDefault(), selectionAction('delete');
    if (k.startsWith('arrow') && selRef.current.objects.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      return nudge(k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0);
    }
    if (k === 'escape') {
      if (tool !== 'select') setTool('select');
      const c = registry.get(selRef.current.pageId)?.canvas;
      c?.discardActiveObject();
      c?.requestRenderAll();
      setShowShortcuts(false);
      return;
    }
    if (e.key === '?') return setShowShortcuts((s) => !s);
    if (k === 'i') return imageInputRef.current?.click();
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t) setTool(t.id);
  };

  useEffect(() => {
    const onKey = (e) => keyHandler.current(e);
    const onPaste = (e) => {
      if (!doc || e.target.closest?.('input, textarea')) return;
      const file = [...(e.clipboardData?.files ?? [])].find(isImage);
      if (file) {
        e.preventDefault();
        insertImage(file);
      }
    };
    const onDragOver = (e) => e.preventDefault();
    const onDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (isPdf(file)) openFile(file);
      else if (doc && isImage(file)) insertImage(file);
    };
    const onUnload = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [doc, dirty, insertImage, openFile]);

  // Is the export server up?
  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServerOk(r.ok))
      .catch(() => setServerOk(false));
  }, [exporting]);

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="app">
      <Toolbar
        doc={doc}
        dirty={dirty}
        tool={tool}
        setTool={setTool}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={() => runHistory('undo')}
        onRedo={() => runHistory('redo')}
        zoom={zoom}
        onZoom={stepZoom}
        onFit={fit}
        onOpen={() => pdfInputRef.current?.click()}
        onImage={() => imageInputRef.current?.click()}
        onExport={handleExport}
        exporting={exporting}
        onShortcuts={() => setShowShortcuts(true)}
      />

      <div className={`workspace ${doc ? '' : 'is-empty'}`}>
        {doc && (
          <Sidebar
            pdfDoc={doc.pdfDoc}
            pages={pages}
            activeId={activeId}
            editCounts={editCounts}
            onSelect={scrollToPage}
            onRotate={rotatePage}
            onDelete={deletePage}
            onMove={movePage}
          />
        )}

        <main ref={viewerRef} className="viewer" onScroll={onScroll}>
          {doc ? (
            <div className={`pages tool-${tool}`} key={doc.id}>
              {pages.map((page, i) => (
                <PageView
                  key={page.id}
                  page={page}
                  index={i}
                  pdfDoc={doc.pdfDoc}
                  zoom={zoom}
                  tool={tool}
                  options={options}
                  registry={registry}
                  history={history}
                  active={page.id === activeId}
                  onActivate={setActiveId}
                  onSelection={handleSelection}
                  onToolDone={() => setTool('select')}
                />
              ))}
            </div>
          ) : (
            <EmptyState onFile={openFile} onBrowse={() => pdfInputRef.current?.click()} loading={loading} />
          )}
        </main>

        {doc && (
          <aside className="inspector">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={panel === 'edit'} className={panel === 'edit' ? 'is-active' : ''} onClick={() => setPanel('edit')}>
                <SlidersHorizontal size={14} /> Properties
              </button>
              <button role="tab" aria-selected={panel === 'info'} className={panel === 'info' ? 'is-active' : ''} onClick={() => setPanel('info')}>
                <Info size={14} /> Document
              </button>
            </div>
            <div className="inspector-body">
              {panel === 'edit' ? (
                <PropertiesPanel
                  objects={selection.objects}
                  tool={tool}
                  options={options}
                  onOptions={setOptions}
                  onUpdate={updateSelection}
                  onAction={selectionAction}
                />
              ) : (
                <DocumentInfo doc={doc} pages={pages} pageSize={activeSize} activeIndex={activeIndex} totalEdits={totalEdits} replacedLines={replacedLines} />
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="statusbar">
        <div className="status-hint">
          {doc ? (
            <>
              <toolInfo.icon size={13} />
              <span>{toolInfo.hint}</span>
            </>
          ) : (
            <span>Open a PDF to get started. Nothing is uploaded until you download.</span>
          )}
        </div>
        <div className="status-meta">
          {doc && (
            <>
              <span>
                Page {activeIndex + 1} of {pages.length}
              </span>
              {activeSize && (
                <span>
                  {paperName(activeSize.w, activeSize.h)} · {Math.round(activeSize.w)} × {Math.round(activeSize.h)} pt
                </span>
              )}
              <span>
                {totalEdits} edit{totalEdits === 1 ? '' : 's'}
              </span>
            </>
          )}
          <span className={`server ${serverOk === false ? 'is-down' : serverOk ? 'is-up' : ''}`} title="The Node.js server builds your downloaded PDF">
            <i /> {serverOk === false ? 'Server offline' : 'Server ready'}
          </span>
        </div>
      </footer>

      {toast && (
        <div className={`toast toast-${toast.type}`} key={toast.id} role="status">
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onChange={(e) => {
          insertImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
