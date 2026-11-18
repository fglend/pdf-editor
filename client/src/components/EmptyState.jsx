import { useState } from 'react';
import { Upload, Type, PenLine, Highlighter, Shapes, ImagePlus, Files, Loader2 } from 'lucide-react';

const FEATURES = [
  { icon: Type, title: 'Add text', text: 'Fill forms and add notes as real, searchable text.' },
  { icon: Highlighter, title: 'Highlight', text: 'Mark up passages the way you would on paper.' },
  { icon: PenLine, title: 'Draw & sign', text: 'Sign freehand, or drop in an image of your signature.' },
  { icon: Shapes, title: 'Shapes & arrows', text: 'Point things out with boxes, circles and arrows.' },
  { icon: ImagePlus, title: 'Images', text: 'Place logos, stamps and photos anywhere.' },
  { icon: Files, title: 'Organize pages', text: 'Reorder, rotate and delete pages.' },
];

export default function EmptyState({ onFile, onBrowse, loading }) {
  const [over, setOver] = useState(false);

  return (
    <div className="empty">
      <div
        className={`dropzone ${over ? 'is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={onBrowse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onBrowse()}
      >
        <div className="dropzone-icon">{loading ? <Loader2 size={28} className="spin" /> : <Upload size={28} />}</div>
        <h1>{loading ? 'Opening your PDF…' : 'Drop a PDF here to start editing'}</h1>
        <p>
          or <span className="link">browse your files</span>. Files up to 200 MB.
        </p>
      </div>

      <ul className="features">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <f.icon size={18} />
            <div>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
