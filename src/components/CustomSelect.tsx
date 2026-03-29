import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  optionClassName?: string;
  size?: "sm" | "md";
  align?: "start" | "end";
  matchTriggerWidth?: boolean;
  panelWidth?: number;
  renderValue?: (option: CustomSelectOption | null) => ReactNode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled = false,
  className,
  triggerClassName,
  panelClassName,
  optionClassName,
  size = "md",
  align = "start",
  matchTriggerWidth = true,
  panelWidth,
  renderValue,
}: CustomSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const enabledOptions = useMemo(
    () => options.filter((option) => !option.disabled),
    [options],
  );

  const triggerSizeClass = size === "sm"
    ? "h-6 px-2 text-[10px]"
    : "h-9 px-3 text-[11px]";

  useEffect(() => {
    if (!open) return;

    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const width = panelWidth ?? (matchTriggerWidth ? rect.width : Math.max(rect.width, 220));
      const leftBase = align === "end" ? rect.right - width : rect.left;
      const left = clamp(leftBase, 8, Math.max(8, window.innerWidth - width - 8));
      const maxHeight = Math.max(180, window.innerHeight - rect.bottom - 20);

      setPanelStyle({
        left,
        top: rect.bottom + 6,
        width,
        maxHeight: Math.min(360, maxHeight),
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [align, matchTriggerWidth, open, panelWidth]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeEl = panelRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function selectValue(next: string) {
    if (next !== value) onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(step: 1 | -1) {
    if (enabledOptions.length === 0) return;
    const currentEnabledIndex = enabledOptions.findIndex((option) => option.value === options[activeIndex]?.value);
    const nextEnabledIndex = currentEnabledIndex < 0
      ? 0
      : (currentEnabledIndex + step + enabledOptions.length) % enabledOptions.length;
    const nextValue = enabledOptions[nextEnabledIndex]?.value;
    const nextIndex = options.findIndex((option) => option.value === nextValue);
    setActiveIndex(nextIndex);
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option && !option.disabled) selectValue(option.value);
    }
  }

  const valueContent = renderValue
    ? renderValue(selectedOption)
    : <span className="truncate">{selectedOption?.label ?? placeholder}</span>;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => { if (!disabled) setOpen((current) => !current); }}
        onKeyDown={handleTriggerKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-sm border border-white/[0.08] bg-[#0D1117] text-left text-white/78 outline-none transition-colors hover:border-white/[0.18] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-45 ${triggerSizeClass} ${triggerClassName ?? ""}`}
      >
        <span className="min-w-0 flex-1 truncate">{valueContent}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-white/32 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
      </button>

      {open ? createPortal(
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          onKeyDown={handlePanelKeyDown}
          className={`fixed z-[1000] overflow-y-auto rounded-md border border-white/[0.10] bg-[#161B22] p-1 shadow-2xl shadow-black/60 backdrop-blur-sm scrollbar-dark ${panelClassName ?? ""}`}
          style={panelStyle}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                id={`${listboxId}-option-${index}`}
                data-option-index={index}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { if (!option.disabled) selectValue(option.value); }}
                className={`flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left transition-colors ${selected ? "bg-blue/[0.14] text-white" : active ? "bg-white/[0.06] text-white/90" : "text-white/64"} ${option.disabled ? "cursor-not-allowed opacity-35" : ""} ${optionClassName ?? ""}`}
              >
                <span className="flex-1">
                  <span className="block font-mono text-[10px]">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[9px] leading-4 text-white/36">{option.description}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 h-3.5 w-3.5 shrink-0">
                  {selected ? <Check className="h-3.5 w-3.5 text-blue" strokeWidth={1.7} /> : null}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
