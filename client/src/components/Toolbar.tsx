import { Pencil, Eraser, Undo2, Trash2 } from 'lucide-react';
import type { DrawTool } from '../types/events';

const ICON = { size: 20, strokeWidth: 2.5 } as const;

const PALETTE = [
  '#000000', '#7f7f7f', '#c1c1c1', '#ffffff',
  '#ef4444', '#f97316', '#f59e0b', '#fde047',
  '#22c55e', '#16a34a', '#06b6d4', '#3b82f6',
  '#1d4ed8', '#a855f7', '#ec4899', '#78350f',
];

// Brush sizes as fractions of canvas width.
const SIZES: { label: string; value: number }[] = [
  { label: 'S', value: 0.006 },
  { label: 'M', value: 0.015 },
  { label: 'L', value: 0.03 },
  { label: 'XL', value: 0.055 },
];

interface Props {
  color: string;
  size: number;
  tool: DrawTool;
  onColor: (c: string) => void;
  onSize: (s: number) => void;
  onTool: (t: DrawTool) => void;
  onUndo: () => void;
  onClear: () => void;
}

export function Toolbar({ color, size, tool, onColor, onSize, onTool, onUndo, onClear }: Props) {
  return (
    <div className="toolbar">
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch ${color === c && tool === 'pen' ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => {
              onColor(c);
              onTool('pen');
            }}
            aria-label={`color ${c}`}
          />
        ))}
      </div>

      <div className="sizes">
        {SIZES.map((s) => (
          <button
            key={s.label}
            className={`size ${size === s.value ? 'active' : ''}`}
            onClick={() => onSize(s.value)}
          >
            <span className="dot" style={{ width: `${s.value * 260}px`, height: `${s.value * 260}px` }} />
          </button>
        ))}
      </div>

      <div className="tools">
        <button className={tool === 'pen' ? 'active' : ''} onClick={() => onTool('pen')} title="Pen" aria-label="Pen">
          <Pencil {...ICON} />
        </button>
        <button className={tool === 'eraser' ? 'active' : ''} onClick={() => onTool('eraser')} title="Eraser" aria-label="Eraser">
          <Eraser {...ICON} />
        </button>
        <button onClick={onUndo} title="Undo" aria-label="Undo">
          <Undo2 {...ICON} />
        </button>
        <button onClick={onClear} title="Clear canvas" aria-label="Clear canvas">
          <Trash2 {...ICON} />
        </button>
      </div>
    </div>
  );
}
