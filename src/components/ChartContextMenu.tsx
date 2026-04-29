import { useEffect } from 'react';
import { Bell, Trash2 } from 'lucide-react';

interface ChartContextMenuProps {
  x: number;
  y: number;
  onAddAlert?: () => void;
  onDeleteAlert?: () => void;
  onClose: () => void;
}

export default function ChartContextMenu({ x, y, onAddAlert, onDeleteAlert, onClose }: ChartContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div
        className="fixed z-50 flex flex-col rounded-md border border-white/[0.1] bg-[#161B22]/95 shadow-xl shadow-black/50 backdrop-blur-sm"
        style={{ left: x, top: y, minWidth: 140 }}
      >
        {onAddAlert && (
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/80 transition-colors hover:bg-white/[0.06]"
            onClick={() => { onAddAlert(); onClose(); }}
          >
            <Bell size={13} className="text-amber-400" />
            Add Alert
          </button>
        )}
        {onDeleteAlert && (
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/80 transition-colors hover:bg-white/[0.06]"
            onClick={() => { onDeleteAlert(); onClose(); }}
          >
            <Trash2 size={13} className="text-red-400" />
            Delete Alert
          </button>
        )}
      </div>
    </>
  );
}
