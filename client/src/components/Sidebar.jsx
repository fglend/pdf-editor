import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { pageRotation } from '../lib/pdf.js';

const THUMB_WIDTH = 128;

function Thumbnail({ pdfDoc, page }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task;
    let cancelled = false;
    pdfDoc.getPage(page.srcIndex + 1).then((p) => {
      if (cancelled) return;
      const rotation = pageRotation(p, page.rotation);
      const base = p.getViewport({ scale: 1, rotation });
      const scale = (THUMB_WIDTH / base.width) * Math.min(window.devicePixelRatio || 1, 2);
      const vp = p.getViewport({ scale, rotation });
      const canvas = ref.current;
      canvas.width = vp.width;
      canvas.height = vp.height;
      task = p.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdfDoc, page.srcIndex, page.rotation, visible]);

  return <canvas ref={ref} className="thumb-canvas" style={{ width: THUMB_WIDTH }} />;
}

export default function Sidebar({ pdfDoc, pages, activeId, editCounts, onSelect, onRotate, onDelete, onMove }) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  return (
    <aside className="sidebar">
      <div className="panel-header">
        <span>Pages</span>
        <span className="muted">{pages.length}</span>
      </div>
      <p className="panel-hint">Drag to reorder. Hover a page for rotate and delete.</p>
      <ol className="thumbs">
        {pages.map((page, i) => (
          <li
            key={page.id}
            ref={page.id === activeId ? activeRef : null}
            className={[
              'thumb',
              page.id === activeId && 'is-active',
              dragIndex === i && 'is-dragging',
              overIndex === i && dragIndex !== i && (dragIndex < i ? 'drop-after' : 'drop-before'),
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) onMove(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onClick={() => onSelect(page.id)}
          >
            <div className="thumb-frame">
              <Thumbnail pdfDoc={pdfDoc} page={page} />
              {editCounts[page.id] > 0 && (
                <span className="thumb-badge" title={`${editCounts[page.id]} edit(s) on this page`}>
                  {editCounts[page.id]}
                </span>
              )}
              <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onRotate(page.id, -90)} title="Rotate left" aria-label="Rotate left">
                  <RotateCcw size={14} />
                </button>
                <button onClick={() => onRotate(page.id, 90)} title="Rotate right" aria-label="Rotate right">
                  <RotateCw size={14} />
                </button>
                <button onClick={() => onMove(i, i - 1)} disabled={i === 0} title="Move up" aria-label="Move up">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => onMove(i, i + 1)} disabled={i === pages.length - 1} title="Move down" aria-label="Move down">
                  <ChevronDown size={14} />
                </button>
                <button className="danger" onClick={() => onDelete(page.id)} title="Delete page" aria-label="Delete page">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="thumb-label">
              {i + 1}
              {page.srcIndex !== i && <span className="muted"> · was p.{page.srcIndex + 1}</span>}
              {page.rotation % 360 !== 0 && <span className="muted"> · {((page.rotation % 360) + 360) % 360}°</span>}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
