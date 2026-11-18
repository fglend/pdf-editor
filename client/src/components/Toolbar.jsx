import {
  FileText,
  FolderOpen,
  Download,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  ImagePlus,
  Loader2,
  Keyboard,
} from 'lucide-react';
import { TOOLS } from '../lib/tools.js';

const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

export default function Toolbar({
  doc,
  dirty,
  tool,
  setTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoom,
  onFit,
  onOpen,
  onImage,
  onExport,
  exporting,
  onShortcuts,
}) {
  const disabled = !doc;
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <FileText size={18} strokeWidth={2.25} />
        </div>
        <div className="brand-text">
          <span className="brand-name">{doc ? doc.name : 'PDF Editor'}</span>
          {doc && (
            <span className={`brand-status ${dirty ? 'is-dirty' : ''}`}>
              {dirty ? 'Unsaved changes' : 'No changes yet'}
            </span>
          )}
        </div>
      </div>

      <nav className="tools" aria-label="Editing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? 'is-active' : ''}`}
            onClick={() => setTool(t.id)}
            disabled={disabled}
            data-tip={`${t.label} (${t.key})`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
          >
            <t.icon size={18} />
          </button>
        ))}
        <span className="divider" />
        <button className="tool-btn" onClick={onImage} disabled={disabled} data-tip="Insert image or signature (I)" aria-label="Insert image">
          <ImagePlus size={18} />
        </button>
        <span className="divider" />
        <button className="tool-btn" onClick={onUndo} disabled={!canUndo} data-tip={`Undo (${mod}Z)`} aria-label="Undo">
          <Undo2 size={18} />
        </button>
        <button className="tool-btn" onClick={onRedo} disabled={!canRedo} data-tip={`Redo (${mod}⇧Z)`} aria-label="Redo">
          <Redo2 size={18} />
        </button>
      </nav>

      <div className="topbar-right">
        <div className="zoom" aria-label="Zoom">
          <button className="icon-btn" onClick={() => onZoom(-1)} disabled={disabled} data-tip={`Zoom out (${mod}−)`} aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <button className="zoom-value" onClick={onFit} disabled={disabled} data-tip="Fit to width">
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn" onClick={() => onZoom(1)} disabled={disabled} data-tip={`Zoom in (${mod}+)`} aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
        <button className="icon-btn" onClick={onShortcuts} data-tip="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard size={16} />
        </button>
        <button className="btn btn-ghost" onClick={onOpen}>
          <FolderOpen size={16} /> Open
        </button>
        <button className="btn btn-primary" onClick={onExport} disabled={disabled || exporting}>
          {exporting ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
          {exporting ? 'Saving…' : 'Download'}
        </button>
      </div>
    </header>
  );
}
