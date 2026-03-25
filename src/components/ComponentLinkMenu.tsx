import { useState, useEffect, useRef } from "react";
import { Link2 } from "lucide-react";
import { LINK_CHANNELS, getChannelById } from "../lib/link-channels";

interface ComponentLinkMenuProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
}

export default function ComponentLinkMenu({
  linkChannel,
  onSetLinkChannel,
}: ComponentLinkMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const active = getChannelById(linkChannel);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 rounded-sm p-0.5 text-white/70 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white"
        style={active ? { color: active.color } : undefined}
      >
        <Link2 className="h-2.5 w-2.5" strokeWidth={1.5} />
        {active && (
          <span className="text-[9px]" style={{ color: active.color }}>
            {active.id}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[120] mt-1 min-w-[130px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40">
          <button
            onClick={() => {
              onSetLinkChannel(null);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[10px] transition-colors duration-75 hover:bg-white/[0.06] ${
              linkChannel === null ? "text-white/70" : "text-white/40"
            }`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full border border-white/20" />
            None
          </button>
          {LINK_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => {
                onSetLinkChannel(ch.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1 text-left text-[10px] transition-colors duration-75 hover:bg-white/[0.06] ${
                linkChannel === ch.id ? "text-white/70" : "text-white/40"
              }`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: ch.color }}
              />
              <span>Link {ch.id}</span>
              <span className="ml-auto text-[9px]" style={{ color: ch.color }}>
                {ch.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
