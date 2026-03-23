import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  GripVertical,
  Settings2,
  X,
} from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { getSymbolName } from "../lib/market-data";
import { useWatchlistData } from "../lib/use-market-data";
import { usePortfolioData, type CashBalance, type PortfolioPosition } from "../lib/use-portfolio-data";
import { useTechScores } from "../lib/use-technicals";

type ColumnKey =
  | "symbol"
  | "name"
  | "account"
  | "quantity"
  | "avgCost"
  | "costBasis"
  | "currentPrice"
  | "marketValue"
  | "dayPnl"
  | "dayPnlPct"
  | "totalPnl"
  | "totalPnlPct"
  | "realizedPnl"
  | "technical"
  | "currency"
  | "exchange"
  | "updatedAt";

type SortDir = "asc" | "desc";

interface PortfolioColumn {
  key: ColumnKey;
  label: string;
  width: number;
  minWidth: number;
  align: "left" | "right" | "center";
}

interface PortfolioRow extends PortfolioPosition {
  resolvedName: string;
  dayPnl: number | null;
  dayPnlPct: number | null;
  totalPnl: number;
  totalPnlPct: number | null;
  technical: number | null;
  updatedAt: number;
}

interface PortfolioCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

const COLUMN_DEFS: PortfolioColumn[] = [
  { key: "symbol", label: "Symbol", width: 90, minWidth: 72, align: "left" },
  { key: "name", label: "Name", width: 220, minWidth: 140, align: "left" },
  { key: "account", label: "Account", width: 120, minWidth: 96, align: "left" },
  { key: "quantity", label: "Position", width: 100, minWidth: 80, align: "right" },
  { key: "avgCost", label: "Avg Price", width: 104, minWidth: 88, align: "right" },
  { key: "costBasis", label: "Cost Basis", width: 116, minWidth: 98, align: "right" },
  { key: "currentPrice", label: "Last", width: 100, minWidth: 80, align: "right" },
  { key: "marketValue", label: "Market Value", width: 120, minWidth: 104, align: "right" },
  { key: "dayPnl", label: "Daily P&L", width: 114, minWidth: 96, align: "right" },
  { key: "dayPnlPct", label: "Change", width: 88, minWidth: 72, align: "right" },
  { key: "totalPnl", label: "Unrealized P&L", width: 130, minWidth: 108, align: "right" },
  { key: "totalPnlPct", label: "Unreal. %", width: 88, minWidth: 72, align: "right" },
  { key: "realizedPnl", label: "Realized P&L", width: 116, minWidth: 98, align: "right" },
  { key: "technical", label: "Tech Score 1D", width: 104, minWidth: 84, align: "center" },
  { key: "currency", label: "CCY", width: 76, minWidth: 62, align: "center" },
  { key: "exchange", label: "Exchange", width: 98, minWidth: 84, align: "left" },
  { key: "updatedAt", label: "Updated", width: 120, minWidth: 104, align: "right" },
];

const DEFAULT_COLUMNS: ColumnKey[] = [
  "totalPnl",
  "dayPnl",
  "symbol",
  "quantity",
  "technical",
  "currentPrice",
  "avgCost",
  "dayPnlPct",
  "marketValue",
];

const DEFAULT_SORT = { key: "marketValue" as ColumnKey, dir: "desc" as SortDir };
const DEFAULT_TECHNICAL_TIMEFRAME = "1d";

function isColumnKey(value: unknown): value is ColumnKey {
  return typeof value === "string" && COLUMN_DEFS.some((col) => col.key === value);
}

function readColumns(config: Record<string, unknown>): ColumnKey[] {
  const raw = config.columns;
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS;
  const next = raw.filter(isColumnKey);
  return next.length > 0 ? Array.from(new Set(next)) : DEFAULT_COLUMNS;
}

function readColumnWidths(config: Record<string, unknown>): Partial<Record<ColumnKey, number>> {
  const raw = config.columnWidths;
  if (!raw || typeof raw !== "object") return {};
  const next: Partial<Record<ColumnKey, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isColumnKey(key) && typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return next;
}

function readSort(config: Record<string, unknown>): { key: ColumnKey; dir: SortDir } {
  const raw = config.sort;
  if (!raw || typeof raw !== "object") return DEFAULT_SORT;
  const sortKey = (raw as Record<string, unknown>).key;
  const sortDir = (raw as Record<string, unknown>).dir;
  return {
    key: isColumnKey(sortKey) ? sortKey : DEFAULT_SORT.key,
    dir: sortDir === "asc" ? "asc" : "desc",
  };
}

function readString(config: Record<string, unknown>, key: string, fallback: string): string {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function fmtMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtNumber(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function pnlTextClass(value: number | null): string {
  if (value == null) return "text-white/30";
  if (value > 0) return "text-green";
  if (value < 0) return "text-red";
  return "text-white/50";
}

function pnlCellBg(value: number | null): string {
  if (value == null || value === 0) return "";
  return value > 0 ? "bg-green/[0.20]" : "bg-red/[0.22]";
}

function technicalTone(score: number | null): string {
  if (score == null) return "text-white/25";
  if (score >= 65) return "text-green";
  if (score <= 35) return "text-red";
  return "text-amber";
}

function cellClass(align: PortfolioColumn["align"]): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function formatUpdatedAt(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function IBKRPortfolioCard({
  linkChannel,
  onSetLinkChannel,
  onClose,
  config,
  onConfigChange,
}: PortfolioCardProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnKey[]>(() => readColumns(config));
  const [columnWidths, setColumnWidths] = useState<Partial<Record<ColumnKey, number>>>(() => readColumnWidths(config));
  const [sort, setSort] = useState(() => readSort(config));
  const [accountFilter, setAccountFilter] = useState(() => readString(config, "accountFilter", "all"));
  const [technicalTimeframe, setTechnicalTimeframe] = useState(
    () => readString(config, "technicalTimeframe", DEFAULT_TECHNICAL_TIMEFRAME),
  );
  const [changeMode, setChangeMode] = useState<"pct" | "dollar">("pct");
  const settingsRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setColumns(readColumns(config));
    setColumnWidths(readColumnWidths(config));
    setSort(readSort(config));
    setAccountFilter(readString(config, "accountFilter", "all"));
    setTechnicalTimeframe(readString(config, "technicalTimeframe", DEFAULT_TECHNICAL_TIMEFRAME));
  }, [config]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const persistConfig = (updates: Record<string, unknown>) => {
    onConfigChange({ ...config, ...updates });
  };

  const { positions, cashBalances, updatedAt, connected, loading, error } = usePortfolioData();
  const symbols = useMemo(
    () => Array.from(new Set(positions.map((row) => row.symbol).filter(Boolean))),
    [positions],
  );
  const { quotes } = useWatchlistData(symbols);
  const techScores = useTechScores(symbols, [technicalTimeframe]);
  const channelInfo = getChannelById(linkChannel);

  const accounts = useMemo(
    () => Array.from(new Set(positions.map((row) => row.account).filter(Boolean))).sort(),
    [positions],
  );

  const rows = useMemo<PortfolioRow[]>(() => {
    return positions.map((position) => {
      const quote = quotes.get(position.symbol);
      const score = techScores.get(position.symbol)?.get(technicalTimeframe) ?? null;
      const livePrice = quote?.last ?? position.currentPrice ?? null;
      const marketValue = livePrice != null ? livePrice * position.quantity : position.marketValue ?? 0;
      const prevClose = quote?.prevClose ?? null;
      const dayPnl =
        prevClose && livePrice != null && Number.isFinite(prevClose)
          ? livePrice - prevClose
          : null;
      const dayPnlDollar = dayPnl == null ? null : dayPnl * position.quantity;
      const dayPnlPct =
        prevClose && livePrice != null && Number.isFinite(prevClose) && prevClose !== 0
          ? ((livePrice - prevClose) / prevClose) * 100
          : null;
      const totalPnl = marketValue - position.costBasis;
      const totalPnlPct = position.costBasis !== 0 ? (totalPnl / position.costBasis) * 100 : null;

      return {
        ...position,
        currentPrice: livePrice,
        marketValue,
        resolvedName: getSymbolName(position.symbol) || position.name || position.symbol,
        dayPnl: dayPnlDollar,
        dayPnlPct,
        totalPnl,
        totalPnlPct,
        technical: score,
        updatedAt,
      };
    });
  }, [positions, quotes, techScores, technicalTimeframe, updatedAt]);

  const filteredRows = useMemo(() => {
    const base = rows.filter((row) => accountFilter === "all" || row.account === accountFilter);

    if (accountFilter !== "all") return base;

    // Merge same-symbol positions across accounts into one combined row
    const merged = new Map<string, PortfolioRow>();
    for (const row of base) {
      const existing = merged.get(row.symbol);
      if (!existing) {
        merged.set(row.symbol, { ...row, account: "ALL" });
        continue;
      }
      const combinedQty = existing.quantity + row.quantity;
      const combinedCostBasis = existing.costBasis + row.costBasis;
      const combinedMarketValue = (existing.marketValue ?? 0) + (row.marketValue ?? 0);
      const combinedTotalPnl = combinedMarketValue - combinedCostBasis;
      const combinedDayPnl =
        existing.dayPnl != null && row.dayPnl != null ? existing.dayPnl + row.dayPnl : null;
      merged.set(row.symbol, {
        ...existing,
        quantity: combinedQty,
        costBasis: combinedCostBasis,
        marketValue: combinedMarketValue,
        avgCost: combinedQty !== 0 ? combinedCostBasis / combinedQty : 0,
        totalPnl: combinedTotalPnl,
        totalPnlPct: combinedCostBasis !== 0 ? (combinedTotalPnl / combinedCostBasis) * 100 : null,
        dayPnl: combinedDayPnl,
        dayPnlPct: existing.dayPnlPct, // same price, pct unchanged
        realizedPnl:
          existing.realizedPnl != null && row.realizedPnl != null
            ? existing.realizedPnl + row.realizedPnl
            : existing.realizedPnl ?? row.realizedPnl,
      });
    }
    return Array.from(merged.values());
  }, [rows, accountFilter]);

  const filteredCash = useMemo(() => {
    if (accountFilter !== "all") {
      return cashBalances.filter((c) => c.account === accountFilter);
    }
    // Merge cash balances of the same currency across accounts
    const merged = new Map<string, typeof cashBalances[0]>();
    for (const c of cashBalances) {
      const existing = merged.get(c.currency);
      merged.set(c.currency, {
        account: "ALL",
        currency: c.currency,
        balance: (existing?.balance ?? 0) + c.balance,
      });
    }
    return Array.from(merged.values());
  }, [cashBalances, accountFilter]);

  const sortedRows = useMemo(() => {
    const next = [...filteredRows];
    const dir = sort.dir === "asc" ? 1 : -1;
    next.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];

      if (typeof av === "string" || typeof bv === "string") {
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      }

      const na = typeof av === "number" ? av : -Infinity;
      const nb = typeof bv === "number" ? bv : -Infinity;
      return (na - nb) * dir;
    });
    return next;
  }, [filteredRows, sort]);

  const summary = useMemo(() => {
    let marketValue = 0;
    let costBasis = 0;
    let dayPnl = 0;
    let totalPnl = 0;

    for (const row of filteredRows) {
      marketValue += row.marketValue ?? 0;
      costBasis += row.costBasis;
      dayPnl += row.dayPnl ?? 0;
      totalPnl += row.totalPnl;
    }

    // Include USD cash balances in market value total (non-USD cash is not converted here)
    const cashTotal = filteredCash.reduce((sum, c) => sum + (c.currency === "USD" ? c.balance : 0), 0);

    return {
      positions: filteredRows.length,
      marketValue: marketValue + cashTotal,
      costBasis,
      dayPnl,
      totalPnl,
      totalPnlPct: costBasis !== 0 ? (totalPnl / costBasis) * 100 : null,
    };
  }, [filteredRows, filteredCash]);

  const visibleColumns = useMemo(
    () =>
      columns
        .map((key) => {
          const def = COLUMN_DEFS.find((col) => col.key === key);
          if (!def) return null;
          if (key === "technical") {
            return { ...def, label: `Tech Score ${technicalTimeframe.toUpperCase()}` };
          }
          return def;
        })
        .filter(Boolean) as PortfolioColumn[],
    [columns, technicalTimeframe],
  );

  const toggleColumn = (key: ColumnKey) => {
    const isVisible = columns.includes(key);
    let next = columns;

    if (isVisible) {
      next = columns.filter((col) => col !== key);
      if (next.length === 0) return;
    } else {
      next = [...columns, key];
    }

    setColumns(next);
    persistConfig({ columns: next });
  };

  const moveColumn = (key: ColumnKey, direction: -1 | 1) => {
    const index = columns.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= columns.length) return;
    const next = [...columns];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setColumns(next);
    persistConfig({ columns: next });
  };

  const handleSort = (key: ColumnKey) => {
    const next =
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" as SortDir }
        : { key, dir: key === "symbol" || key === "name" ? "asc" : "desc" as SortDir };
    setSort(next);
    persistConfig({ sort: next });
  };

  const startResize = (event: React.MouseEvent, column: PortfolioColumn) => {
    event.preventDefault();
    event.stopPropagation();

    const startWidth = columnWidths[column.key] ?? column.width;
    resizeStateRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidth,
    };

    const onMove = (moveEvent: MouseEvent) => {
      const active = resizeStateRef.current;
      if (!active) return;
      const minWidth = COLUMN_DEFS.find((col) => col.key === active.key)?.minWidth ?? 72;
      const nextWidth = Math.max(minWidth, active.startWidth + moveEvent.clientX - active.startX);
      setColumnWidths((prev) => ({ ...prev, [active.key]: nextWidth }));
    };

    const onUp = () => {
      const active = resizeStateRef.current;
      resizeStateRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!active) return;
      const latestWidth = Math.max(
        COLUMN_DEFS.find((col) => col.key === active.key)?.minWidth ?? 72,
        (columnWidths[active.key] ?? active.startWidth),
      );
      persistConfig({
        columnWidths: {
          ...columnWidths,
          [active.key]: latestWidth,
        },
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const renderCell = (row: PortfolioRow, column: PortfolioColumn) => {
    switch (column.key) {
      case "symbol":
        return <span className="font-mono font-semibold text-white/85">{row.symbol}</span>;
      case "name":
        return <span className="truncate text-white/60">{row.resolvedName}</span>;
      case "account":
        return <span className="font-mono text-white/55">{row.account}</span>;
      case "quantity": {
        const qtyClass = row.quantity > 0 ? "text-green" : row.quantity < 0 ? "text-red" : "text-white/40";
        return <span className={`font-semibold ${qtyClass}`}>{fmtNumber(row.quantity, 4)}</span>;
      }
      case "avgCost":
        return <span>{fmtMoney(row.avgCost)}</span>;
      case "costBasis":
        return <span>{fmtMoney(row.costBasis)}</span>;
      case "currentPrice":
        return <span>{fmtMoney(row.currentPrice)}</span>;
      case "marketValue":
        return <span>{fmtMoney(row.marketValue)}</span>;
      case "dayPnl":
        return <span className="font-semibold text-white">{fmtMoney(row.dayPnl)}</span>;
      case "dayPnlPct":
        return changeMode === "dollar"
          ? <span className={pnlTextClass(row.dayPnl)}>{fmtMoney(row.dayPnl)}</span>
          : <span className={pnlTextClass(row.dayPnlPct)}>{fmtPct(row.dayPnlPct)}</span>;
      case "totalPnl":
        return <span className="font-semibold text-white">{fmtMoney(row.totalPnl)}</span>;
      case "totalPnlPct":
        return <span className={pnlTextClass(row.totalPnlPct)}>{fmtPct(row.totalPnlPct)}</span>;
      case "realizedPnl":
        return <span className={pnlTextClass(row.realizedPnl)}>{fmtMoney(row.realizedPnl)}</span>;
      case "technical":
        return (
          <span className={`font-mono font-semibold ${technicalTone(row.technical)}`}>
            {row.technical == null ? "—" : Math.round(row.technical)}
          </span>
        );
      case "currency":
        return <span className="font-mono text-white/50">{row.currency || "—"}</span>;
      case "exchange":
        return <span className="text-white/45">{row.primaryExchange || row.exchange || "—"}</span>;
      case "updatedAt":
        return <span className="font-mono text-white/40">{formatUpdatedAt(row.updatedAt)}</span>;
      default:
        return <span>—</span>;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-white/75">IBKR Portfolio</span>
          {channelInfo ? (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: channelInfo.color }}
            />
          ) : null}
          <span
            className={`rounded-sm px-1.5 py-[1px] text-[9px] font-mono ${
              connected ? "bg-green/10 text-green" : "bg-white/[0.05] text-white/35"
            }`}
          >
            {connected ? "LIVE" : loading ? "LOADING" : "DISCONNECTED"}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((value) => !value)}
              className="rounded-sm p-0.5 text-white/30 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/60"
              title="Customize columns"
            >
              <Settings2 className="h-2.5 w-2.5" strokeWidth={1.5} />
            </button>

            {settingsOpen ? (
              <div className="absolute right-0 top-full z-[120] mt-1 w-[320px] rounded-md border border-white/[0.08] bg-[#1C2128] p-2 shadow-xl shadow-black/40">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[9px] uppercase tracking-[0.16em] text-white/25">Columns</p>
                  <button
                    onClick={() => {
                      setColumns(DEFAULT_COLUMNS);
                      setColumnWidths({});
                      setSort(DEFAULT_SORT);
                      persistConfig({
                        columns: DEFAULT_COLUMNS,
                        columnWidths: {},
                        sort: DEFAULT_SORT,
                      });
                    }}
                    className="text-[10px] text-white/35 transition-colors hover:text-white/65"
                  >
                    Reset
                  </button>
                </div>

                <div className="mb-2 max-h-[220px] overflow-y-auto pr-1 scrollbar-watchlist">
                  {COLUMN_DEFS.map((column) => {
                    const visible = columns.includes(column.key);
                    return (
                      <div
                        key={column.key}
                        className="flex items-center gap-2 rounded-sm px-1 py-1 text-[10px] text-white/55 hover:bg-white/[0.04]"
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => toggleColumn(column.key)}
                          className="h-3 w-3 accent-blue"
                        />
                        <GripVertical className="h-3 w-3 text-white/12" strokeWidth={1.5} />
                        <span className="flex-1 truncate">{column.label}</span>
                        <button
                          onClick={() => moveColumn(column.key, -1)}
                          disabled={!visible || columns.indexOf(column.key) <= 0}
                          className="rounded-sm p-0.5 text-white/25 transition-colors hover:bg-white/[0.06] hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => moveColumn(column.key, 1)}
                          disabled={!visible || columns.indexOf(column.key) === columns.length - 1}
                          className="rounded-sm p-0.5 text-white/25 transition-colors hover:bg-white/[0.06] hover:text-white/60 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-white/[0.06] pt-2">
                  <p className="mb-1.5 text-[9px] uppercase tracking-[0.16em] text-white/25">
                    Technical Timeframe
                  </p>
                  <div className="flex gap-1">
                    {["5m", "15m", "1h", "4h", "1d", "1w"].map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          setTechnicalTimeframe(tf);
                          persistConfig({ technicalTimeframe: tf });
                        }}
                        className={`flex-1 rounded-sm px-1.5 py-1 text-[10px] font-mono transition-colors ${
                          technicalTimeframe === tf
                            ? "bg-blue/[0.15] text-blue border border-blue/30"
                            : "border border-white/[0.06] text-white/40 hover:border-white/[0.14] hover:text-white/65"
                        }`}
                      >
                        {tf.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <ComponentLinkMenu
            linkChannel={linkChannel}
            onSetLinkChannel={onSetLinkChannel}
          />

          <button
            onClick={onClose}
            className="rounded-sm p-0.5 text-white/30 transition-colors duration-75 hover:bg-white/[0.06] hover:text-red"
          >
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#10151C] px-3 py-2">
        <PnLBox
          label="Unrealized P&L"
          value={fmtMoney(summary.totalPnl)}
          sub={fmtPct(summary.totalPnlPct)}
          pnl={summary.totalPnl}
        />
        <PnLBox
          label="Daily P&L"
          value={fmtMoney(summary.dayPnl)}
          pnl={summary.dayPnl}
        />

        <SummaryStat label="Market Value" value={fmtMoney(summary.marketValue)} />

        {accounts.length > 0 && (
          <div className="ml-auto">
            <AccountDropdown
              accounts={accounts}
              value={accountFilter}
              onChange={(v) => { setAccountFilter(v); persistConfig({ accountFilter: v }); }}
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-dark">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[11px] text-white/30">
            Loading IBKR positions...
          </div>
        ) : !connected && positions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[12px] text-white/55">No live IBKR portfolio data</p>
            <p className="max-w-[460px] text-[10px] leading-5 text-white/28">
              Make sure TWS or IB Gateway is running with API access enabled. The card will reconnect automatically.
            </p>
            {error ? (
              <p className="font-mono text-[10px] text-red/60">{error}</p>
            ) : null}
          </div>
        ) : (
          <div
            className="min-w-max"
            style={{
              gridTemplateColumns: visibleColumns
                .map((column) => `${columnWidths[column.key] ?? column.width}px`)
                .join(" "),
            }}
          >
            <div
              className="sticky top-0 z-10 grid border-b border-white/[0.08] bg-[#131925]"
              style={{
                gridTemplateColumns: visibleColumns
                  .map((column) => `${columnWidths[column.key] ?? column.width}px`)
                  .join(" "),
              }}
            >
              {visibleColumns.map((column) => {
                const activeSort = sort.key === column.key;
                const isChangeCol = column.key === "dayPnlPct";
                return (
                  <button
                    key={column.key}
                    onClick={() => handleSort(column.key)}
                    className={`group relative flex h-8 items-center border-r border-white/[0.06] px-2 text-[10px] uppercase tracking-[0.14em] text-white/35 transition-colors hover:bg-white/[0.03] hover:text-white/60 ${cellClass(column.align)}`}
                  >
                    <span className={`flex-1 ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""}`}>
                      {isChangeCol ? (changeMode === "pct" ? "Change %" : "Change $") : column.label}
                    </span>
                    {isChangeCol ? (
                      <span
                        onClick={(e) => { e.stopPropagation(); setChangeMode((m) => m === "pct" ? "dollar" : "pct"); }}
                        className="ml-1 rounded-sm border border-white/[0.10] bg-white/[0.04] px-1 py-px text-[8px] font-mono text-white/40 hover:border-blue/40 hover:bg-blue/[0.08] hover:text-blue transition-colors cursor-pointer"
                        title="Toggle $ / %"
                      >
                        {changeMode === "pct" ? "%" : "$"}
                      </span>
                    ) : null}
                    <span className={`ml-1 ${activeSort ? "text-white/60" : "text-white/18"}`}>
                      <ChevronsUpDown className="h-3 w-3" strokeWidth={1.5} />
                    </span>
                    <span
                      onMouseDown={(event) => startResize(event, column)}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize group/resize hover:bg-blue/[0.15]"
                    >
                      <span className="absolute right-0 top-1/2 h-3/5 w-px -translate-y-1/2 bg-white/[0.08] group-hover/resize:bg-blue/50 transition-colors" />
                    </span>
                  </button>
                );
              })}
            </div>

            {sortedRows.map((row) => {
              const active = selectedSymbol === row.symbol;
              const weakTechnical = row.technical != null && row.technical < 40;
              return (
                <button
                  key={`${row.account}:${row.symbol}`}
                  onClick={() => {
                    setSelectedSymbol(row.symbol);
                    if (linkChannel) linkBus.publish(linkChannel, row.symbol);
                  }}
                  className={`grid min-w-max border-b text-[11px] outline-none transition-colors ${
                    weakTechnical
                      ? "border border-red/60 bg-red/[0.06]"
                      : `border-white/[0.04] ${active ? "bg-blue/[0.08]" : "hover:bg-white/[0.025]"}`
                  }`}
                  style={{
                    gridTemplateColumns: visibleColumns
                      .map((column) => `${columnWidths[column.key] ?? column.width}px`)
                      .join(" "),
                  }}
                >
                  {visibleColumns.map((column) => {
                    const isPnlCell = column.key === "totalPnl" || column.key === "dayPnl";
                    const pnlValue = column.key === "totalPnl" ? row.totalPnl : column.key === "dayPnl" ? row.dayPnl : null;
                    const bgClass = isPnlCell ? pnlCellBg(pnlValue) : "";
                    return (
                      <div
                        key={column.key}
                        className={`truncate border-r border-white/[0.04] px-2 py-2 font-mono ${cellClass(column.align)} ${bgClass}`}
                      >
                        {renderCell(row, column)}
                      </div>
                    );
                  })}
                </button>
              );
            })}

            {filteredCash.map((cash) => (
              <CashRow
                key={`${cash.account}:${cash.currency}`}
                cash={cash}
                visibleColumns={visibleColumns}
                columnWidths={columnWidths}
              />
            ))}

            <TotalRow
              visibleColumns={visibleColumns}
              columnWidths={columnWidths}
              marketValue={summary.marketValue}
            />
          </div>
        )}
      </div>

    </div>
  );
}

function CashRow({
  cash,
  visibleColumns,
  columnWidths,
}: {
  cash: CashBalance;
  visibleColumns: PortfolioColumn[];
  columnWidths: Partial<Record<ColumnKey, number>>;
}) {
  const isPos = cash.balance > 0;
  const isNeg = cash.balance < 0;
  const gridCols = visibleColumns.map((col) => `${columnWidths[col.key] ?? col.width}px`).join(" ");
  return (
    <div
      className="grid min-w-max border-b border-white/[0.04] text-[11px]"
      style={{ gridTemplateColumns: gridCols }}
    >
      {visibleColumns.map((column) => {
        let content: React.ReactNode = null;
        let extraClass = "";
        if (column.key === "symbol") {
          content = (
            <span className="font-mono font-semibold text-white/55">
              {cash.currency} CASH
            </span>
          );
        } else if (column.key === "marketValue") {
          const bg = isPos ? "bg-green/[0.18]" : isNeg ? "bg-red/[0.18]" : "";
          const txt = isPos ? "text-white font-semibold" : isNeg ? "text-white font-semibold" : "text-white/50";
          extraClass = bg;
          content = <span className={txt}>{fmtMoney(cash.balance)}</span>;
        } else {
          content = <span className="text-white/15">—</span>;
        }
        return (
          <div
            key={column.key}
            className={`truncate border-r border-white/[0.04] px-2 py-2 font-mono ${cellClass(column.align)} ${extraClass}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function TotalRow({
  visibleColumns,
  columnWidths,
  marketValue,
}: {
  visibleColumns: PortfolioColumn[];
  columnWidths: Partial<Record<ColumnKey, number>>;
  marketValue: number;
}) {
  const gridCols = visibleColumns.map((col) => `${columnWidths[col.key] ?? col.width}px`).join(" ");
  return (
    <div
      className="grid min-w-max border-t border-white/[0.10] bg-[#131925] text-[11px]"
      style={{ gridTemplateColumns: gridCols }}
    >
      {visibleColumns.map((column) => {
        let content: React.ReactNode = null;
        if (column.key === "symbol") {
          content = (
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/30 font-sans">
              Total
            </span>
          );
        } else if (column.key === "marketValue") {
          content = (
            <span className="font-mono font-semibold text-white/80">{fmtMoney(marketValue)}</span>
          );
        }
        return (
          <div
            key={column.key}
            className={`truncate border-r border-white/[0.04] px-2 py-2 font-mono ${cellClass(column.align)}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function AccountDropdown({
  accounts,
  value,
  onChange,
}: {
  accounts: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = [{ label: "All Accounts", value: "all" }, ...accounts.map((a) => ({ label: a, value: a }))];
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-[30px] min-w-[140px] items-center justify-between gap-2 rounded-sm border px-2.5 text-[10px] font-mono transition-colors ${
          open
            ? "border-blue/40 bg-blue/[0.08] text-blue"
            : "border-white/[0.10] bg-white/[0.03] text-white/60 hover:border-white/[0.18] hover:text-white/80"
        }`}
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-120 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.5}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[130] mt-1 min-w-[160px] overflow-hidden rounded-sm border border-white/[0.10] bg-[#1C2128] py-1 shadow-xl shadow-black/50">
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-[10px] font-mono transition-colors ${
                  active
                    ? "bg-blue/[0.12] text-blue"
                    : "text-white/55 hover:bg-white/[0.05] hover:text-white/80"
                }`}
              >
                {active && <span className="h-1 w-1 shrink-0 rounded-full bg-blue" />}
                {!active && <span className="h-1 w-1 shrink-0" />}
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STAT_BOX = "w-[168px] h-[58px] shrink-0 rounded-sm border px-3 py-2";

function PnLBox({ label, value, sub, pnl }: { label: string; value: string; sub?: string; pnl: number | null }) {
  const isPos = pnl != null && pnl > 0;
  const isNeg = pnl != null && pnl < 0;
  const bgClass = isPos
    ? "bg-green/[0.14] border-green/30"
    : isNeg
      ? "bg-red/[0.14] border-red/30"
      : "bg-white/[0.03] border-white/[0.06]";
  const textClass = isPos ? "text-green" : isNeg ? "text-red" : "text-white/55";
  return (
    <div className={`${STAT_BOX} ${bgClass}`}>
      <p className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className={`font-mono text-[13px] font-semibold leading-none ${textClass}`}>{value}</p>
      {sub ? <p className={`mt-0.5 font-mono text-[10px] ${textClass} opacity-75`}>{sub}</p> : null}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`${STAT_BOX} border-white/[0.06] bg-white/[0.02]`}>
      <p className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-white/25">{label}</p>
      <p className={`truncate font-mono text-[13px] font-semibold leading-none ${tone ?? "text-white/75"}`}>{value}</p>
    </div>
  );
}
