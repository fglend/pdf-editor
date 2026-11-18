import { X } from 'lucide-react';
import { TOOLS } from '../lib/tools.js';

const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';

const GENERAL = [
  [[mod, 'O'], 'Open a PDF'],
  [[mod, 'S'], 'Download edited PDF'],
  [[mod, 'Z'], 'Undo'],
  [[mod, '⇧', 'Z'], 'Redo'],
  [[mod, 'D'], 'Duplicate selection'],
  [['Del'], 'Delete selection'],
  [['←↑→↓'], 'Nudge selection (⇧ for 10 pt)'],
  [[mod, '+ / −'], 'Zoom in / out'],
  [[mod, '0'], 'Fit to width'],
  [['I'], 'Insert image'],
  [['Esc'], 'Deselect / finish typing'],
];

export default function ShortcutsDialog({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Keyboard shortcuts</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-cols">
          <div>
            <h4>Tools</h4>
            {TOOLS.map((t) => (
              <div className="shortcut" key={t.id}>
                <span>
                  <t.icon size={14} /> {t.label}
                </span>
                <kbd>{t.key}</kbd>
              </div>
            ))}
          </div>
          <div>
            <h4>General</h4>
            {GENERAL.map(([keys, label]) => (
              <div className="shortcut" key={label}>
                <span>{label}</span>
                <span>
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
