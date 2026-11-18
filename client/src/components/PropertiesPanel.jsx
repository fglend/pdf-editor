import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  Trash2,
  BringToFront,
  SendToBack,
  MousePointerClick,
  Undo,
} from 'lucide-react';
import { FONTS, SWATCHES, TOOLS, colorKeyFor } from '../lib/tools.js';

const KIND_LABELS = {
  text: 'Text',
  draw: 'Drawing',
  highlight: 'Highlight',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  image: 'Image',
};
const STROKED = new Set(['draw', 'rect', 'ellipse', 'line', 'arrow']);

function Section({ title, children }) {
  return (
    <section className="prop-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${value?.toLowerCase() === c ? 'is-active' : ''}`}
          style={{ '--swatch': c }}
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
        />
      ))}
      <label className="swatch swatch-custom" data-tip="Custom color" style={{ '--swatch': value }}>
        <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function TextControls({ font, size, bold, italic, align, onChange }) {
  return (
    <>
      <Section title="Font">
        <select className="select" value={font} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Slider label="Size" value={size} min={6} max={96} unit="pt" onChange={(v) => onChange({ fontSize: v })} />
        {bold !== undefined && (
          <div className="segmented">
            <button className={bold ? 'is-active' : ''} onClick={() => onChange({ fontWeight: bold ? 'normal' : 'bold' })} aria-label="Bold">
              <Bold size={15} />
            </button>
            <button className={italic ? 'is-active' : ''} onClick={() => onChange({ fontStyle: italic ? 'normal' : 'italic' })} aria-label="Italic">
              <Italic size={15} />
            </button>
            <span className="segmented-gap" />
            {[
              ['left', AlignLeft],
              ['center', AlignCenter],
              ['right', AlignRight],
            ].map(([a, Icon]) => (
              <button key={a} className={align === a ? 'is-active' : ''} onClick={() => onChange({ textAlign: a })} aria-label={`Align ${a}`}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export default function PropertiesPanel({ objects, tool, options, onOptions, onUpdate, onAction }) {
  // ── Nothing selected: show defaults for the current tool ──
  if (!objects?.length) {
    const t = TOOLS.find((x) => x.id === tool);
    const kind = tool === 'draw' ? 'draw' : tool;
    const showColor = !['select', 'eraser', 'edittext'].includes(tool);
    return (
      <div className="props">
        <div className="props-title">
          <t.icon size={16} />
          <span>{t.label} tool</span>
        </div>
        <p className="panel-hint">{t.hint}</p>
        {showColor && (
          <Section title="Color">
            <ColorPicker value={options[colorKeyFor(kind)]} onChange={(c) => onOptions({ [colorKeyFor(kind)]: c })} />
          </Section>
        )}
        {STROKED.has(kind) && (
          <Section title="Stroke">
            <Slider label="Width" value={options.strokeWidth} min={1} max={20} unit="pt" onChange={(v) => onOptions({ strokeWidth: v })} />
          </Section>
        )}
        {tool === 'text' && (
          <TextControls font={options.fontFamily} size={options.fontSize} onChange={(p) => onOptions({ fontFamily: p.fontFamily ?? options.fontFamily, fontSize: p.fontSize ?? options.fontSize })} />
        )}
        {(tool === 'select' || tool === 'eraser') && (
          <div className="empty-props">
            <MousePointerClick size={28} strokeWidth={1.5} />
            <p>Select an edit on the page to change its color, size, or position.</p>
          </div>
        )}
        {tool === 'edittext' && (
          <ul className="explain">
            <li>Editable lines are outlined on the page. Hover to see the original font.</li>
            <li>Your edit keeps the original size, color and position, in the closest standard font.</li>
            <li>Clear a line completely to delete it, or use Restore original to undo just that line.</li>
            <li>Scanned pages have no real text, so there is nothing to edit there.</li>
          </ul>
        )}
      </div>
    );
  }

  // ── Something selected ──
  const first = objects[0];
  const kinds = new Set(objects.map((o) => o.kind));
  const kind = kinds.size === 1 ? first.kind : 'mixed';
  const replaced = objects.length === 1 && first.kind === 'text' && first.sourceId;
  const title = objects.length > 1 ? `${objects.length} items selected` : replaced ? 'Edited PDF text' : KIND_LABELS[kind] ?? 'Object';
  const colorProp = kind === 'text' || kind === 'highlight' ? 'fill' : 'stroke';
  const hasColor = kind !== 'image' && kind !== 'mixed';
  const rect = objects.length === 1 ? first.getBoundingRect() : null;

  const setColor = (c) => {
    onUpdate(kind === 'text' ? { fill: c, cursorColor: c } : { [colorProp]: c });
    onOptions({ [colorKeyFor(kind)]: c });
  };

  return (
    <div className="props">
      <div className="props-title">
        <span>{title}</span>
      </div>

      {replaced && (
        <section className="prop-section">
          <div className="callout">
            <p>
              Originally <q>{first.originalText}</q>
              {first.originalFont && (
                <>
                  {' '}
                  in <strong>{first.originalFont}</strong>
                </>
              )}
              . It’s shown in the closest standard font.
            </p>
            <button className="btn btn-soft" onClick={() => onAction('restore')}>
              <Undo size={14} /> Restore original
            </button>
          </div>
        </section>
      )}

      {hasColor && (
        <Section title="Color">
          <ColorPicker value={first[colorProp]} onChange={setColor} />
        </Section>
      )}

      {STROKED.has(kind) && (
        <Section title="Stroke">
          <Slider
            label="Width"
            value={first.strokeWidth}
            min={1}
            max={20}
            unit="pt"
            onChange={(v) => {
              onUpdate({ strokeWidth: v });
              onOptions({ strokeWidth: v });
            }}
          />
        </Section>
      )}

      {kind === 'text' && (
        <TextControls
          font={first.fontFamily}
          size={first.fontSize}
          bold={first.fontWeight === 'bold'}
          italic={first.fontStyle === 'italic'}
          align={first.textAlign}
          onChange={(p) => {
            onUpdate(p);
            if (p.fontFamily || p.fontSize) onOptions(p);
          }}
        />
      )}

      <Section title="Appearance">
        <Slider
          label="Opacity"
          value={Math.round((first.opacity ?? 1) * 100)}
          min={10}
          max={100}
          unit="%"
          onChange={(v) => onUpdate({ opacity: v / 100 })}
        />
      </Section>

      {rect && (
        <Section title="Position & size">
          <dl className="metrics">
            <div>
              <dt>X</dt>
              <dd>{Math.round(rect.left)} pt</dd>
            </div>
            <div>
              <dt>Y</dt>
              <dd>{Math.round(rect.top)} pt</dd>
            </div>
            <div>
              <dt>W</dt>
              <dd>{Math.round(rect.width)} pt</dd>
            </div>
            <div>
              <dt>H</dt>
              <dd>{Math.round(rect.height)} pt</dd>
            </div>
          </dl>
          <p className="panel-hint">Tip: use the arrow keys to nudge (hold Shift for 10 pt).</p>
        </Section>
      )}

      <Section title="Arrange">
        <div className="action-grid">
          <button className="btn btn-soft" onClick={() => onAction('front')}>
            <BringToFront size={15} /> To front
          </button>
          <button className="btn btn-soft" onClick={() => onAction('back')}>
            <SendToBack size={15} /> To back
          </button>
          <button className="btn btn-soft" onClick={() => onAction('duplicate')}>
            <Copy size={15} /> Duplicate
          </button>
          <button className="btn btn-soft btn-danger" onClick={() => onAction('delete')}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </Section>
    </div>
  );
}
