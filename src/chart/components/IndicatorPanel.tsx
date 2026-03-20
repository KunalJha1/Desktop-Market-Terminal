import { useState, useMemo, useRef, useEffect } from 'react';
import { indicatorRegistry } from '../indicators/registry';
import { Search, X } from 'lucide-react';

interface IndicatorPanelProps {
  open: boolean;
  onClose: () => void;
  onAddIndicator: (name: string) => void;
}

const categories = [
  { key: 'overlay' as const, label: 'Overlays' },
  { key: 'oscillator' as const, label: 'Oscillators' },
  { key: 'volume' as const, label: 'Volume' },
];

export default function IndicatorPanel({ open, onClose, onAddIndicator }: IndicatorPanelProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose]);

  const indicators = useMemo(
    () => Object.entries(indicatorRegistry).map(([key, meta]) => ({ key, ...meta })),
    [],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return indicators;
    const q = search.toLowerCase();
    return indicators.filter(
      (ind) =>
        ind.name.toLowerCase().includes(q) ||
        ind.shortName.toLowerCase().includes(q)
    );
  }, [search, indicators]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="absolute top-[36px] left-[200px] z-50 w-[280px] bg-panel border border-border-default rounded-btn shadow-none"
    >
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Search size={12} className="text-text-muted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search indicators..."
          className="flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
          spellCheck={false}
        />
        <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
          <X size={12} />
        </button>
      </div>

      {/* Categories */}
      <div className="max-h-[320px] overflow-y-auto scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {categories.map((cat) => {
          const items = filtered.filter((ind) => ind.category === cat.key);
          if (items.length === 0) return null;
          return (
            <div key={cat.key}>
              <div className="px-3 py-1.5 text-[9px] text-text-muted uppercase tracking-wider">
                {cat.label}
              </div>
              {items.map((ind) => (
                <button
                  key={ind.key}
                  onClick={() => { onAddIndicator(ind.key); onClose(); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary
                             hover:text-text-primary hover:bg-hover transition-colors duration-120
                             flex items-center justify-between"
                >
                  <span>{ind.name}</span>
                  <span className="text-[9px] text-text-muted font-mono">{ind.shortName}</span>
                </button>
              ))}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-text-muted text-center">
            No indicators found
          </div>
        )}
      </div>
    </div>
  );
}
