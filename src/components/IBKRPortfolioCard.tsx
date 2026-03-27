import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, Pencil, Plus, Trash2, X } from "lucide-react";
import ComponentLinkMenu from "./ComponentLinkMenu";
import { getChannelById } from "../lib/link-channels";
import { linkBus } from "../lib/link-bus";
import { getSymbolName } from "../lib/market-data";
import { useWatchlistData } from "../lib/use-market-data";
import { usePortfolioData } from "../lib/use-portfolio-data";
import { describeTechScoreCell, useTechScores } from "../lib/use-technicals";
import { isTaScoreTimeframe, TA_SCORE_TIMEFRAMES } from "../lib/ta-score-timeframes";

interface PortfolioCardProps {
  linkChannel: number | null;
  onSetLinkChannel: (channel: number | null) => void;
  onClose: () => void;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}

type FilterValue = "all" | `account:${string}` | `group:${string}`;
type ManualComposerMode = "position" | "cash";
type TechScoreColorMode = "white" | "heat" | "position";
type SortDirection = "asc" | "desc";
type ColumnOrderId = `b:${string}` | `ta:${string}`;

type HeaderTintConfig = {
  builtIn?: Record<string, string>;
  ta?: Record<string, string>;
};

type HeaderMenuState =
  | { x: number; y: number; type: "builtIn"; key: string }
  | { x: number; y: number; type: "ta"; tf: string };

interface PortfolioColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  align: "left" | "right";
  defaultVisible: boolean;
}

const COLUMNS: PortfolioColDef[] = [
  { key: "unrealizedPnl", label: "Unreal P&L",  defaultWidth: 110, minWidth: 70, align: "right", defaultVisible: true },
  { key: "dayPnl",        label: "Daily P&L",   defaultWidth: 100, minWidth: 70, align: "right", defaultVisible: true },
  { key: "symbol",        label: "Symbol",       defaultWidth: 90,  minWidth: 60, align: "left",  defaultVisible: true },
  { key: "qty",           label: "Qty",          defaultWidth: 80,  minWidth: 50, align: "right", defaultVisible: true },
  { key: "last",          label: "Last",         defaultWidth: 90,  minWidth: 60, align: "right", defaultVisible: true },
  { key: "marketValue",   label: "Mkt Value",    defaultWidth: 110, minWidth: 70, align: "right", defaultVisible: true },
  { key: "change",        label: "Change",       defaultWidth: 80,  minWidth: 50, align: "right", defaultVisible: true },
  { key: "actions",       label: "Actions",      defaultWidth: 92,  minWidth: 80, align: "left",  defaultVisible: true },
  { key: "name",          label: "Name",         defaultWidth: 160, minWidth: 80, align: "left",  defaultVisible: false },
  { key: "account",       label: "Account",      defaultWidth: 160, minWidth: 80, align: "left",  defaultVisible: false },
  { key: "avgCost",       label: "Avg Cost",     defaultWidth: 90,  minWidth: 60, align: "right", defaultVisible: false },
  { key: "costBasis",     label: "Cost Basis",   defaultWidth: 100, minWidth: 70, align: "right", defaultVisible: false },
  { key: "currency",      label: "Currency",     defaultWidth: 70,  minWidth: 50, align: "left",  defaultVisible: false },
  { key: "updated",       label: "Updated",      defaultWidth: 90,  minWidth: 60, align: "right", defaultVisible: false },
];

const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
const TA_COL_W = 52;
const STAT_BOX = "h-[58px] w-[168px] shrink-0 rounded-sm border px-3 py-2";
const HEADER_TINT_PRESETS: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: "Default", value: null },
  { label: "Blue", value: "#7cc7ff" },
  { label: "Green", value: "#7ee787" },
  { label: "Amber", value: "#f2cc60" },
  { label: "Red", value: "#ff7b72" },
  { label: "Pink", value: "#f778ba" },
];

type StatTone = "positive" | "negative" | "neutral";

function fmtMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtNumber(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);
}

function formatUpdatedAt(ts: number): string {
  if (!ts) return "--";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sourceLabel(source: "ibkr" | "manual"): string {
  return source === "manual" ? "Manual" : "IBKR";
}

function pnlClass(value: number | null): string {
  if (value == null) return "text-white/30";
  if (value > 0) return "text-green";
  if (value < 0) return "text-red";
  return "text-white/50";
}

function statTone(value: number | null): StatTone {
  if (value == null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function readFilter(config: Record<string, unknown>): FilterValue {
  const raw = config.accountFilter;
  if (raw === "all") return raw;
  if (typeof raw === "string" && (raw.startsWith("account:") || raw.startsWith("group:"))) return raw as FilterValue;
  return "all";
}

function readRowHighlightTimeframe(config: Record<string, unknown>): string {
  const raw = config.rowHighlightTimeframe;
  return typeof raw === "string" && (raw === "off" || isTaScoreTimeframe(raw))
    ? raw
    : "1h";
}

function readTechScoreColorMode(config: Record<string, unknown>): TechScoreColorMode {
  const raw = config.techScoreColorMode;
  return raw === "heat" || raw === "position" || raw === "white" ? raw : "white";
}

function readSortDirection(config: Record<string, unknown>): SortDirection {
  return config.sortDirection === "desc" ? "desc" : "asc";
}

function readSortKey(config: Record<string, unknown>): string | null {
  return typeof config.sortKey === "string" && config.sortKey.trim() ? config.sortKey : null;
}

function rawManualAccountId(accountId: string): string {
  return accountId.replace(/^manual:/, "");
}

function builtInColId(key: string): ColumnOrderId {
  return `b:${key}`;
}

function taColId(tf: string): ColumnOrderId {
  return `ta:${tf}`;
}

function deriveOrderedColumnIds(
  savedOrder: string[],
  builtInKeys: string[],
  taKeys: string[],
): ColumnOrderId[] {
  const allIds = [
    ...builtInKeys.map((key) => builtInColId(key)),
    ...taKeys.map((tf) => taColId(tf)),
  ];
  const validIds = new Set(allIds);
  const ordered = savedOrder.filter((id): id is ColumnOrderId => validIds.has(id as ColumnOrderId));
  const seen = new Set(ordered);
  const appended = allIds.filter((id) => !seen.has(id));
  return [...ordered, ...appended];
}

export default function IBKRPortfolioCard({ linkChannel, onSetLinkChannel, onClose, config, onConfigChange }: PortfolioCardProps) {
  // ── Manager / composer state ──
  const [managerOpen, setManagerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [selectedManualAccountId, setSelectedManualAccountId] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ManualComposerMode>("position");
  const [composerOpen, setComposerOpen] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [positionSymbol, setPositionSymbol] = useState("");
  const [positionQty, setPositionQty] = useState("");
  const [positionAvgCost, setPositionAvgCost] = useState("");
  const [positionCurrency, setPositionCurrency] = useState("USD");
  const [cashId, setCashId] = useState<string | null>(null);
  const [cashCurrency, setCashCurrency] = useState("USD");
  const [cashBalance, setCashBalance] = useState("");
  const [groupName, setGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // ── Column configuration state (initialised from persisted config) ──
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const colPickerButtonRef = useRef<HTMLButtonElement>(null);
  const colPickerPanelRef = useRef<HTMLDivElement>(null);
  const [colPickerRect, setColPickerRect] = useState<DOMRect | null>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => (config.columnWidths as Record<string, number> | undefined) ?? {},
  );
  const [taColWidths, setTaColWidths] = useState<Record<string, number>>(
    () => (config.taColumnWidths as Record<string, number> | undefined) ?? {},
  );
  const [visibleCols, setVisibleCols] = useState<string[]>(
    () => (config.visibleColumns as string[] | undefined) ?? DEFAULT_VISIBLE,
  );
  const [taTimeframes, setTaTimeframes] = useState<string[]>(
    () => (config.taTimeframes as string[] | undefined) ?? ["1h"],
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => (config.columnOrder as string[] | undefined) ?? [],
  );
  const [headerTints, setHeaderTints] = useState<HeaderTintConfig>(
    () => (config.headerTints as HeaderTintConfig | undefined) ?? {},
  );
  const [rowHighlightTimeframe, setRowHighlightTimeframe] = useState<string>(
    () => readRowHighlightTimeframe(config),
  );
  const [techScoreColorMode, setTechScoreColorMode] = useState<TechScoreColorMode>(
    () => readTechScoreColorMode(config),
  );
  const [sortKey, setSortKey] = useState<string | null>(() => readSortKey(config));
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => readSortDirection(config));
  const [colDragState, setColDragState] = useState<{ colId: ColumnOrderId; mouseX: number; mouseY: number } | null>(null);
  const [colInsertBeforeId, setColInsertBeforeId] = useState<ColumnOrderId | null>(null);
  const [headerMenu, setHeaderMenu] = useState<HeaderMenuState | null>(null);
  const headerCellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const activeColumnIdsRef = useRef<ColumnOrderId[]>([]);
  const colDragColIdRef = useRef<ColumnOrderId | null>(null);
  const colInsertBeforeIdRef = useRef<ColumnOrderId | null>(null);
  const didColDragRef = useRef(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  // ── Close picker on outside click ──
  useEffect(() => {
    if (!colPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !colPickerButtonRef.current?.contains(target) &&
        !colPickerPanelRef.current?.contains(target)
      ) {
        setColPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colPickerOpen]);

  useEffect(() => {
    if (!headerMenu) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!headerMenuRef.current?.contains(event.target as Node)) {
        setHeaderMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHeaderMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [headerMenu]);

  function openColPicker() {
    if (!colPickerOpen && colPickerButtonRef.current) {
      setColPickerRect(colPickerButtonRef.current.getBoundingClientRect());
    }
    setColPickerOpen((v) => !v);
  }

  const persistConfig = useCallback(
    (patch: Record<string, unknown>) => onConfigChange({ ...config, ...patch }),
    [config, onConfigChange],
  );

  // ── Column resize handlers ──
  const handleColResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const col = COLUMNS.find((c) => c.key === key)!;
      const startW = colWidths[key] ?? col.defaultWidth;

      const onMove = (ev: MouseEvent) => {
        setColWidths((prev) => ({ ...prev, [key]: Math.max(col.minWidth, startW + (ev.clientX - startX)) }));
      };
      const onUp = () => {
        setColWidths((prev) => { persistConfig({ columnWidths: prev }); return prev; });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [colWidths, persistConfig],
  );

  const handleTaColResize = useCallback(
    (tf: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = taColWidths[tf] ?? TA_COL_W;

      const onMove = (ev: MouseEvent) => {
        setTaColWidths((prev) => ({ ...prev, [tf]: Math.max(36, startW + (ev.clientX - startX)) }));
      };
      const onUp = () => {
        setTaColWidths((prev) => { persistConfig({ taColumnWidths: prev }); return prev; });
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [taColWidths, persistConfig],
  );

  // ── Portfolio data ──
  const accountFilter = readFilter(config);
  const channelInfo = getChannelById(linkChannel);
  const portfolio = usePortfolioData();
  const {
    accounts, groups, positions, cashBalances, updatedAt, connected, loading, error,
    createManualAccount, updateManualAccount, deleteManualAccount,
    createManualPosition, updateManualPosition,
    deleteManualPosition: deleteManualPositionInner,
    createManualCashBalance, updateManualCashBalance,
    deleteManualCashBalance: deleteManualCashBalanceInner,
    createGroup, updateGroup, deleteGroup,
  } = portfolio;

  const manualAccounts = useMemo(() => accounts.filter((a) => a.source === "manual"), [accounts]);
  const selectedManualAccount = useMemo(
    () => manualAccounts.find((a) => a.id === selectedManualAccountId) ?? manualAccounts[0] ?? null,
    [manualAccounts, selectedManualAccountId],
  );
  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol).filter(Boolean))), [positions]);
  const { quotes } = useWatchlistData(symbols);
  const requestedTechTimeframes = useMemo(() => {
    const requested = new Set(taTimeframes);
    if (rowHighlightTimeframe !== "off") requested.add(rowHighlightTimeframe);
    return Array.from(requested);
  }, [rowHighlightTimeframe, taTimeframes]);
  const techScores = useTechScores(symbols, requestedTechTimeframes);

  useEffect(() => {
    if (!manualAccounts.length) { setSelectedManualAccountId(null); return; }
    if (!selectedManualAccountId || !manualAccounts.some((a) => a.id === selectedManualAccountId)) {
      setSelectedManualAccountId(manualAccounts[0].id);
    }
  }, [manualAccounts, selectedManualAccountId]);

  useEffect(() => {
    if (accountFilter.startsWith("account:")) {
      const id = accountFilter.slice(8);
      const account = accounts.find((a) => a.id === id);
      if (account?.source === "manual") setSelectedManualAccountId(id);
    }
  }, [accountFilter, accounts]);

  const activeAccountIds = useMemo(() => {
    if (accountFilter === "all") return new Set(accounts.map((a) => a.id));
    if (accountFilter.startsWith("account:")) return new Set([accountFilter.slice(8)]);
    const group = groups.find((g) => `group:${g.id}` === accountFilter);
    return new Set(group?.accountIds ?? []);
  }, [accountFilter, accounts, groups]);

  const showManualWorkspace = useMemo(() => {
    if (manualAccounts.length === 0) return false;
    if (!accountFilter.startsWith("account:")) return true;
    return accounts.find((a) => `account:${a.id}` === accountFilter)?.source === "manual";
  }, [accountFilter, accounts, manualAccounts.length]);

  const effectiveVisibleCols = useMemo(() => {
    if (showManualWorkspace && !visibleCols.includes("actions")) return [...visibleCols, "actions"];
    return visibleCols;
  }, [showManualWorkspace, visibleCols]);

  const activeColumnIds = useMemo(
    () => deriveOrderedColumnIds(columnOrder, effectiveVisibleCols, taTimeframes),
    [columnOrder, effectiveVisibleCols, taTimeframes],
  );

  activeColumnIdsRef.current = activeColumnIds;

  const orderedVisibleCols = useMemo(
    () => activeColumnIds.filter((id): id is `b:${string}` => id.startsWith("b:")).map((id) => id.slice(2)),
    [activeColumnIds],
  );

  const orderedTaTimeframes = useMemo(
    () => activeColumnIds.filter((id): id is `ta:${string}` => id.startsWith("ta:")).map((id) => id.slice(3)),
    [activeColumnIds],
  );

  // ── Dynamic grid template ──
  const gridTemplate = useMemo(() => {
    const tracks = activeColumnIds.map((id) => {
      if (id.startsWith("b:")) {
        const key = id.slice(2);
        const col = COLUMNS.find((c) => c.key === key);
        return `${colWidths[key] ?? col?.defaultWidth ?? 90}px`;
      }
      const tf = id.slice(3);
      return `${taColWidths[tf] ?? TA_COL_W}px`;
    });
    return tracks.join(" ");
  }, [activeColumnIds, colWidths, taColWidths]);

  const rows = useMemo(
    () =>
      positions
        .filter((p) => activeAccountIds.has(p.accountId))
        .map((p) => {
          const quote = quotes.get(p.symbol);
          const price = quote?.last ?? p.currentPrice ?? null;
          const prevClose = quote?.prevClose ?? null;
          const marketValue = price != null ? price * p.quantity : p.marketValue;
          const dayPnl = prevClose != null && price != null ? (price - prevClose) * p.quantity : null;
          return {
            ...p,
            currentPrice: price,
            displayName: getSymbolName(p.symbol) || p.name || p.symbol,
            marketValue,
            dayPnl,
            dayPnlPct: prevClose && price != null && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null,
          };
        }),
    [activeAccountIds, positions, quotes],
  );

  const filteredCash = useMemo(
    () => cashBalances.filter((c) => activeAccountIds.has(c.accountId)),
    [activeAccountIds, cashBalances],
  );

  useEffect(() => {
    if (!sortKey) return;
    const sortableKeys = new Set([...orderedVisibleCols.filter((key) => key !== "actions"), ...orderedTaTimeframes]);
    if (!sortableKeys.has(sortKey)) {
      setSortKey(null);
      persistConfig({ sortKey: null });
    }
  }, [orderedVisibleCols, orderedTaTimeframes, persistConfig, sortKey]);

  type RowType = typeof rows[0];
  type CashType = typeof filteredCash[0];

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;

    const compareText = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

    const compareNullableNumber = (a: number | null, b: number | null) => {
      const aMissing = a == null || !Number.isFinite(a);
      const bMissing = b == null || !Number.isFinite(b);
      const aValue = aMissing ? 0 : a;
      const bValue = bMissing ? 0 : b;
      if (aValue !== bValue) return aValue - bValue;
      if (aMissing && !bMissing && bValue === 0) return 1;
      if (bMissing && !aMissing && aValue === 0) return -1;
      if (aMissing && !bMissing) return -1;
      if (bMissing && !aMissing) return 1;
      return 0;
    };

    const portfolioValue = (row: RowType, key: string): number | string | null => {
      const unrealizedPnl = row.unrealizedPnl ?? ((row.marketValue ?? 0) - row.costBasis);
      switch (key) {
        case "unrealizedPnl": return unrealizedPnl;
        case "dayPnl": return row.dayPnl;
        case "symbol": return row.symbol;
        case "qty": return row.quantity;
        case "last": return row.currentPrice;
        case "marketValue": return row.marketValue;
        case "change": return row.dayPnlPct;
        case "name": return row.displayName;
        case "account": return `${row.account} ${sourceLabel(row.source)}`;
        case "avgCost": return row.avgCost;
        case "costBasis": return row.costBasis;
        case "currency": return row.currency;
        case "updated": return updatedAt;
        default: return techScores.get(row.symbol)?.get(key)?.score ?? null;
      }
    };

    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = portfolioValue(a.row, sortKey);
        const right = portfolioValue(b.row, sortKey);

        let result = 0;
        if (typeof left === "string" || typeof right === "string") {
          result = compareText(String(left ?? ""), String(right ?? ""));
        } else {
          result = compareNullableNumber(
            typeof left === "number" ? left : null,
            typeof right === "number" ? right : null,
          );
        }

        if (result === 0) return a.index - b.index;
        return sortDirection === "asc" ? result : -result;
      })
      .map(({ row }) => row);
  }, [rows, sortDirection, sortKey, techScores, updatedAt]);

  const summary = useMemo(() => {
    let marketValue = 0, dayPnl = 0, totalPnl = 0;
    for (const row of rows) {
      marketValue += row.marketValue ?? 0;
      dayPnl += row.dayPnl ?? 0;
      totalPnl += (row.marketValue ?? 0) - row.costBasis;
    }
    marketValue += filteredCash.reduce((sum, c) => sum + (c.currency === "USD" ? c.balance : 0), 0);
    const pnlBase = marketValue !== 0 ? marketValue : null;
    return {
      marketValue,
      dayPnl,
      totalPnl,
      dayPnlPct: pnlBase ? (dayPnl / pnlBase) * 100 : null,
      totalPnlPct: pnlBase ? (totalPnl / pnlBase) * 100 : null,
    };
  }, [filteredCash, rows]);

  void deleteManualPositionInner;
  void deleteManualCashBalanceInner;

  async function runMutation(action: () => Promise<void>): Promise<boolean> {
    setBusy(true); setManagerError(null);
    try { await action(); return true; }
    catch (err) { setManagerError(err instanceof Error ? err.message : "Portfolio update failed."); return false; }
    finally { setBusy(false); }
  }

  function resetAccountForm() { setEditingAccountId(null); setAccountName(""); }
  function resetGroupForm() { setEditingGroupId(null); setGroupName(""); }
  function resetPositionForm() { setPositionId(null); setPositionSymbol(""); setPositionQty(""); setPositionAvgCost(""); setPositionCurrency("USD"); }
  function resetCashForm() { setCashId(null); setCashCurrency("USD"); setCashBalance(""); }

  function startComposer(mode: ManualComposerMode, accountId?: string) {
    if (accountId) setSelectedManualAccountId(accountId);
    setComposerMode(mode);
    setManagerOpen(false);
    setManagerError(null);
    if (mode === "position") resetCashForm();
    if (mode === "cash") resetPositionForm();
    setComposerOpen(true);
  }

  async function submitAccount() {
    const name = accountName.trim();
    if (!name) return setManagerError("Account name is required.");
    await runMutation(() =>
      editingAccountId
        ? updateManualAccount(rawManualAccountId(editingAccountId), { name, groupIds: [] })
        : createManualAccount({ name, groupIds: [] }),
    );
    resetAccountForm();
  }

  async function submitGroup() {
    const name = groupName.trim();
    if (!name) return setManagerError("Group name is required.");
    await runMutation(() => editingGroupId ? updateGroup(editingGroupId, { name, accountIds: [] }) : createGroup({ name, accountIds: [] }));
    resetGroupForm();
  }

  async function submitPosition() {
    if (!selectedManualAccount) return setManagerError("Create or select a manual account first.");
    const symbol = positionSymbol.trim().toUpperCase();
    const quantity = Number(positionQty);
    const avgCost = Number(positionAvgCost);
    const currency = positionCurrency.trim().toUpperCase() || "USD";
    if (!symbol || !Number.isFinite(quantity) || !Number.isFinite(avgCost))
      return setManagerError("Position needs symbol, quantity, and average cost.");
    const ok = await runMutation(() =>
      positionId
        ? updateManualPosition(positionId, { symbol, quantity, avgCost, currency })
        : createManualPosition(rawManualAccountId(selectedManualAccount.id), { symbol, quantity, avgCost, currency }),
    );
    if (ok) { resetPositionForm(); setComposerOpen(false); }
  }

  async function submitCash() {
    if (!selectedManualAccount) return setManagerError("Create or select a manual account first.");
    const currency = cashCurrency.trim().toUpperCase() || "USD";
    const balance = Number(cashBalance);
    if (!Number.isFinite(balance)) return setManagerError("Cash balance must be a valid number.");
    const ok = await runMutation(() =>
      cashId
        ? updateManualCashBalance(cashId, { currency, balance })
        : createManualCashBalance(rawManualAccountId(selectedManualAccount.id), { currency, balance }),
    );
    if (ok) { resetCashForm(); setComposerOpen(false); }
  }

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (composerMode === "position" ? submitPosition() : submitCash());
  }

  // ── Column picker helpers ──
  function toggleColumn(key: string) {
    const next = visibleCols.includes(key) ? visibleCols.filter((k) => k !== key) : [...visibleCols, key];
    setVisibleCols(next);
    persistConfig({ visibleColumns: next, columnOrder });
  }

  function toggleTaTimeframe(tf: string) {
    const next = taTimeframes.includes(tf) ? taTimeframes.filter((t) => t !== tf) : [...taTimeframes, tf];
    setTaTimeframes(next);
    persistConfig({ taTimeframes: next, columnOrder });
  }

  function handleRowHighlightTimeframeChange(next: string) {
    setRowHighlightTimeframe(next);
    persistConfig({ rowHighlightTimeframe: next });
  }

  function handleTechScoreColorModeChange(next: TechScoreColorMode) {
    setTechScoreColorMode(next);
    persistConfig({ techScoreColorMode: next });
  }

  function persistColumnOrder(next: ColumnOrderId[]) {
    setColumnOrder(next);
    persistConfig({ columnOrder: next });
  }

  function persistHeaderTints(next: HeaderTintConfig) {
    setHeaderTints(next);
    persistConfig({ headerTints: next });
  }

  function setBuiltInHeaderTint(key: string, value: string | null) {
    const nextBuiltIn = { ...(headerTints.builtIn ?? {}) };
    if (value) nextBuiltIn[key] = value;
    else delete nextBuiltIn[key];
    persistHeaderTints({ ...headerTints, builtIn: nextBuiltIn });
  }

  function setTaHeaderTint(tf: string, value: string | null) {
    const nextTa = { ...(headerTints.ta ?? {}) };
    if (value) nextTa[tf] = value;
    else delete nextTa[tf];
    persistHeaderTints({ ...headerTints, ta: nextTa });
  }

  function cycleSort(nextKey: string) {
    if (nextKey === "actions") return;
    if (sortKey !== nextKey) {
      setSortKey(nextKey);
      setSortDirection("asc");
      persistConfig({ sortKey: nextKey, sortDirection: "asc" });
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      persistConfig({ sortKey: nextKey, sortDirection: "desc" });
      return;
    }
    setSortKey(null);
    setSortDirection("asc");
    persistConfig({ sortKey: null, sortDirection: "asc" });
  }

  function startColumnDrag(colId: ColumnOrderId, e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;
    colDragColIdRef.current = colId;
    colInsertBeforeIdRef.current = null;

    const getInsertId = (clientX: number): ColumnOrderId | null => {
      for (const id of activeColumnIdsRef.current) {
        const el = headerCellRefs.current[id];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) return id;
      }
      return null;
    };

    const onMove = (event: MouseEvent) => {
      if (!didDrag) {
        if (Math.abs(event.clientX - startX) > 4 || Math.abs(event.clientY - startY) > 4) {
          didDrag = true;
          setColDragState({ colId, mouseX: event.clientX, mouseY: event.clientY });
        }
        return;
      }
      setColDragState((prev) => (prev ? { ...prev, mouseX: event.clientX, mouseY: event.clientY } : null));
      const insertId = getInsertId(event.clientX);
      colInsertBeforeIdRef.current = insertId;
      setColInsertBeforeId(insertId);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const sourceId = colDragColIdRef.current;
      const targetId = colInsertBeforeIdRef.current;
      colDragColIdRef.current = null;
      colInsertBeforeIdRef.current = null;
      setColDragState(null);
      setColInsertBeforeId(null);
      if (!didDrag || !sourceId) return;
      didColDragRef.current = true;
      if (targetId === sourceId) return;
      const currentOrder = activeColumnIdsRef.current;
      const nextOrder = currentOrder.filter((id) => id !== sourceId);
      if (targetId == null) {
        nextOrder.push(sourceId);
      } else {
        const targetIndex = nextOrder.indexOf(targetId);
        nextOrder.splice(targetIndex === -1 ? nextOrder.length : targetIndex, 0, sourceId);
      }
      if (nextOrder.join(",") !== currentOrder.join(",")) {
        persistColumnOrder(nextOrder);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleHeaderClick(key: string) {
    if (didColDragRef.current) {
      didColDragRef.current = false;
      return;
    }
    cycleSort(key);
  }

  function columnDragLabel(colId: ColumnOrderId): string {
    if (colId.startsWith("b:")) {
      return COLUMNS.find((col) => col.key === colId.slice(2))?.label ?? colId.slice(2);
    }
    return colId.slice(3);
  }

  function sortIndicatorFor(key: string): string {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function openEditPosition(row: RowType) {
    if (!row.editable || !row.id) return;
    setSelectedManualAccountId(row.accountId);
    setComposerMode("position");
    setPositionId(row.id);
    setPositionSymbol(row.symbol);
    setPositionQty(String(row.quantity));
    setPositionAvgCost(String(row.avgCost));
    setPositionCurrency(row.currency || "USD");
    resetCashForm();
    setManagerError(null);
    setComposerOpen(true);
  }

  function openEditCash(cash: CashType) {
    if (!cash.editable || !cash.id) return;
    setSelectedManualAccountId(cash.accountId);
    setComposerMode("cash");
    setCashId(cash.id);
    setCashCurrency(cash.currency || "USD");
    setCashBalance(String(cash.balance));
    resetPositionForm();
    setManagerError(null);
    setComposerOpen(true);
  }

  function rowHighlightClass(score: number | null): string {
    if (rowHighlightTimeframe === "off" || score === null) return "hover:bg-white/[0.025]";
    if (score >= 60) return "bg-green/[0.08] hover:bg-green/[0.12]";
    if (score <= 40) return "bg-red/[0.08] hover:bg-red/[0.12]";
    return "hover:bg-white/[0.025]";
  }

  function techScoreCellClass(
    score: number | null,
    isLong: boolean,
    isShort: boolean,
  ): string {
    if (score === null) return "text-white/15";
    if (techScoreColorMode === "white") return "text-white/80";
    if (techScoreColorMode === "position") {
      const danger = (isLong && score < 50) || (isShort && score > 50);
      return danger ? "bg-red/[0.10] text-red font-medium" : "text-white/80";
    }
    if (score > 60) return "text-green font-medium";
    if (score < 40) return "text-red font-medium";
    return "text-white/40";
  }

  // ── Cell value renderers ──
  function cellValue(row: RowType, key: string): { value: string; tone?: string; strong?: boolean } {
    const unrealizedPnl = row.unrealizedPnl ?? ((row.marketValue ?? 0) - row.costBasis);
    switch (key) {
      case "unrealizedPnl": return { value: fmtMoney(unrealizedPnl), tone: pnlClass(unrealizedPnl) };
      case "dayPnl":        return { value: fmtMoney(row.dayPnl), tone: pnlClass(row.dayPnl) };
      case "symbol":        return { value: row.symbol, strong: true };
      case "qty":           return { value: fmtNumber(row.quantity, 4) };
      case "last":          return { value: fmtMoney(row.currentPrice) };
      case "marketValue":   return { value: fmtMoney(row.marketValue) };
      case "change":        return { value: fmtPct(row.dayPnlPct), tone: pnlClass(row.dayPnlPct) };
      case "actions":       return { value: "" };
      case "name":          return { value: row.displayName };
      case "account":       return { value: `${row.account} · ${sourceLabel(row.source)}` };
      case "avgCost":       return { value: fmtMoney(row.avgCost) };
      case "costBasis":     return { value: fmtMoney(row.costBasis) };
      case "currency":      return { value: row.currency };
      case "updated":       return { value: formatUpdatedAt(updatedAt), tone: "text-white/40" };
      default:              return { value: "--", tone: "text-white/20" };
    }
  }

  function cashCellValue(cash: CashType, key: string): { value: string; tone?: string; strong?: boolean } {
    switch (key) {
      case "symbol":      return { value: `${cash.currency} CASH`, strong: true };
      case "marketValue": return { value: fmtMoney(cash.balance) };
      case "actions":     return { value: "" };
      case "account":     return { value: `${cash.account} · ${sourceLabel(cash.source)}` };
      default:            return { value: "--", tone: "text-white/20" };
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden border border-white/[0.06] bg-panel">

      {/* ── Title bar ── */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.10] bg-base px-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-white/85">Portfolio</span>
          {channelInfo ? <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: channelInfo.color }} /> : null}
          <span className={`rounded-sm px-1.5 py-[1px] text-[9px] font-mono ${connected ? "bg-green/10 text-green" : "bg-white/[0.05] text-white/50"}`}>
            {connected ? "LIVE" : loading ? "LOADING" : "OFFLINE"}
          </span>
          {manualAccounts.length ? (
            <span className="rounded-sm border border-amber/20 bg-amber/[0.08] px-1.5 py-[1px] text-[9px] font-mono text-amber">
              MANUAL {manualAccounts.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {/* Column picker */}
          <div ref={colPickerRef}>
            <button
              ref={colPickerButtonRef}
              type="button"
              onClick={openColPicker}
              className={`flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-mono transition-colors ${colPickerOpen ? "bg-blue/[0.14] text-blue" : "text-white/50 hover:bg-white/[0.06] hover:text-white/80"}`}
            >
              <Columns3 className="h-2.5 w-2.5" strokeWidth={1.5} />
              Cols
            </button>
          </div>
          {colPickerOpen && colPickerRect ? createPortal(
            <div
              ref={colPickerPanelRef}
              className="fixed z-[9999] flex w-[230px] flex-col overflow-y-auto rounded-md border border-white/[0.10] bg-[#161B22] shadow-2xl shadow-black/60 scrollbar-dark"
              style={{
                top: colPickerRect.bottom + 4,
                right: window.innerWidth - colPickerRect.right,
                maxHeight: "min(440px, calc(100vh - 120px))",
              }}
            >
              <div className="p-2">
                <p className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-white/28">Visible Columns</p>
                <div className="space-y-0.5">
                  {COLUMNS.map((col) => (
                    <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-white/[0.04]">
                      <input
                        type="checkbox"
                        checked={visibleCols.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                        className="h-3 w-3 accent-blue"
                      />
                      <span className="text-[10px] text-white/65">{col.label}</span>
                      {!col.defaultVisible && <span className="ml-auto text-[8px] text-white/22">opt</span>}
                    </label>
                  ))}
                </div>
              </div>
              <div className="border-t border-white/[0.08] bg-[#131920] p-2">
                <p className="mb-1.5 text-[9px] uppercase tracking-[0.14em] text-blue/70">TA Score Columns</p>
                <div className="flex flex-wrap gap-1">
                  {TA_SCORE_TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => toggleTaTimeframe(tf)}
                      className={`rounded-sm px-2 py-0.5 text-[9px] font-mono transition-colors ${taTimeframes.includes(tf) ? "bg-blue/[0.22] text-blue" : "border border-white/[0.08] text-white/40 hover:border-white/[0.18] hover:text-white/72"}`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] text-white/28">
                  {taTimeframes.length > 0 ? "Red bg = direction conflicts with score" : "Click a timeframe to add a score column"}
                </p>
                <div className="mt-2 border-t border-white/[0.08] pt-2">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.14em] text-white/35">TA Score Color</p>
                  <select
                    value={techScoreColorMode}
                    onChange={(e) => handleTechScoreColorModeChange(e.target.value as TechScoreColorMode)}
                    className="h-7 w-full rounded-sm border border-white/[0.08] bg-[#0D1117] px-2 text-[10px] text-white/70 outline-none"
                  >
                    <option value="white">White</option>
                    <option value="heat">Heatmap</option>
                    <option value="position">Position Risk</option>
                  </select>
                  <p className="mt-1 text-[9px] text-white/28">White is the default. Heatmap colors by score strength, Position Risk marks scores that oppose the trade.</p>
                </div>
                <div className="mt-2 border-t border-white/[0.08] pt-2">
                  <p className="mb-1 text-[9px] uppercase tracking-[0.14em] text-white/35">Row Highlight</p>
                  <select
                    value={rowHighlightTimeframe}
                    onChange={(e) => handleRowHighlightTimeframeChange(e.target.value)}
                    className="h-7 w-full rounded-sm border border-white/[0.08] bg-[#0D1117] px-2 text-[10px] text-white/70 outline-none"
                  >
                    <option value="off">Off</option>
                    {TA_SCORE_TIMEFRAMES.map((tf) => (
                      <option key={`row-highlight-${tf}`} value={tf}>{tf}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[9px] text-white/28">Rows turn green at 60+ and red at 40- for the selected timeframe.</p>
                </div>
              </div>
            </div>
          , document.body) : null}

          <button
            type="button"
            onClick={() => setManagerOpen((v) => !v)}
            className={`rounded-sm px-1.5 py-0.5 text-[9px] font-mono transition-colors ${managerOpen ? "bg-blue/[0.14] text-blue" : "text-white/35 hover:bg-white/[0.06] hover:text-white/70"}`}
          >
            Manage
          </button>
          <ComponentLinkMenu linkChannel={linkChannel} onSetLinkChannel={onSetLinkChannel} />
          <button type="button" onClick={onClose} className="rounded-sm p-0.5 text-white/70 hover:bg-white/[0.06] hover:text-red">
            <X className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* ── Summary stat boxes + account filter ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#10151C] px-3 py-2">
        <StatBox
          label="Unrealized P&L"
          value={fmtMoney(summary.totalPnl)}
          change={fmtPct(summary.totalPnlPct)}
          tone={statTone(summary.totalPnl)}
        />
        <StatBox
          label="Daily P&L"
          value={fmtMoney(summary.dayPnl)}
          change={fmtPct(summary.dayPnlPct)}
          tone={statTone(summary.dayPnl)}
        />
        <StatBox label="Market Value" value={fmtMoney(summary.marketValue)} tone="text-white/75" />
        <div className="ml-auto">
          <select
            value={accountFilter}
            onChange={(e) => onConfigChange({ ...config, accountFilter: e.target.value })}
            className="h-[30px] min-w-[200px] rounded-sm border border-white/[0.10] bg-[#161B22] px-2.5 text-[10px] font-mono text-white/70 outline-none"
          >
            <option value="all">All Accounts</option>
            {groups.map((g) => (
              <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
            ))}
            {accounts.map((a) => (
              <option key={a.id} value={`account:${a.id}`}>{a.name} ({a.source === "manual" ? "manual" : "ibkr"})</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Manual workspace bar ── */}
      {showManualWorkspace ? (
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0E141B] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-amber/80">Manual Workspace</p>
          <div className="flex items-center gap-2">
            {managerError ? <span className="text-[10px] text-red/80">{managerError}</span> : null}
            <button type="button" onClick={() => startComposer("position")} className="h-7 rounded-sm bg-amber/[0.14] px-3 text-[10px] font-medium text-amber hover:bg-amber/[0.22]">
              Log Position
            </button>
            <button type="button" onClick={() => startComposer("cash")} className="h-7 rounded-sm border border-white/[0.08] px-3 text-[10px] text-white/65 hover:border-white/[0.18] hover:text-white/82">
              Log Cash
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Portfolio table ── */}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-dark">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[11px] text-white/30">Loading portfolio...</div>
        ) : rows.length === 0 && filteredCash.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-[12px] text-white/55">No portfolio data yet</p>
            <p className="max-w-[460px] text-[10px] leading-5 text-white/28">Connect IBKR for live accounts or create manual accounts from the workspace above.</p>
            {error ? <p className="font-mono text-[10px] text-red/60">{error}</p> : null}
          </div>
        ) : (
          <div className="min-w-max">
            {/* Header */}
            <div
              className="grid sticky top-0 z-10 border-b border-white/[0.06] bg-[#131925] text-[9px] uppercase tracking-[0.14em] text-white/28"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {activeColumnIds.map((colId, index) => {
                const isLast = index === activeColumnIds.length - 1;
                if (colId.startsWith("b:")) {
                  const key = colId.slice(2);
                  const col = COLUMNS.find((c) => c.key === key)!;
                  const isSortable = key !== "actions";
                  const tint = headerTints.builtIn?.[key];
                  return (
                    <div
                      key={colId}
                      ref={(el) => { headerCellRefs.current[colId] = el; }}
                      onMouseDown={(e) => startColumnDrag(colId, e)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setHeaderMenu({ x: e.clientX, y: e.clientY, type: "builtIn", key });
                      }}
                      onClick={() => handleHeaderClick(key)}
                      className={`relative flex select-none items-center justify-center truncate border-r border-white/[0.06] px-2 py-2 text-center ${colDragState?.colId === colId ? "cursor-grabbing opacity-40" : "cursor-grab"} ${isSortable ? "hover:text-white/55" : ""}`}
                      style={{
                        color: tint,
                        backgroundColor: tint ? `${tint}14` : undefined,
                      }}
                      title="Click to sort · Right-click for color · Drag to reorder"
                    >
                      {colInsertBeforeId === colId && colDragState ? (
                        <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                      ) : null}
                      {isLast && colInsertBeforeId === null && colDragState ? (
                        <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                      ) : null}
                      <span className="truncate pr-3">{`${col.label}${sortIndicatorFor(key)}`}</span>
                      <div
                        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                        onMouseDown={(e) => handleColResize(key, e)}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      />
                    </div>
                  );
                }
                const tf = colId.slice(3);
                const tint = headerTints.ta?.[tf];
                return (
                  <div
                    key={colId}
                    ref={(el) => { headerCellRefs.current[colId] = el; }}
                    onMouseDown={(e) => startColumnDrag(colId, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setHeaderMenu({ x: e.clientX, y: e.clientY, type: "ta", tf });
                    }}
                    onClick={() => handleHeaderClick(tf)}
                    className={`relative select-none truncate border-r border-white/[0.06] px-1 py-2 text-center text-blue/50 hover:text-blue ${colDragState?.colId === colId ? "cursor-grabbing opacity-40" : "cursor-grab"}`}
                    style={{
                      color: tint,
                      backgroundColor: tint ? `${tint}14` : undefined,
                    }}
                    title="Click to sort · Right-click for color · Drag to reorder"
                  >
                    {colInsertBeforeId === colId && colDragState ? (
                      <div className="pointer-events-none absolute left-0 top-0 z-20 h-full w-0.5 bg-blue" />
                    ) : null}
                    {isLast && colInsertBeforeId === null && colDragState ? (
                      <div className="pointer-events-none absolute right-0 top-0 z-20 h-full w-0.5 bg-blue" />
                    ) : null}
                    {`${tf}${sortIndicatorFor(tf)}`}
                    <div
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-blue/[0.15]"
                      onMouseDown={(e) => handleTaColResize(tf, e)}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Position rows */}
            {sortedRows.map((row) => {
              const highlightScore = rowHighlightTimeframe === "off"
                ? null
                : techScores.get(row.symbol)?.get(rowHighlightTimeframe)?.score ?? null;
              return (
              <div
                key={`${row.accountId}:${row.symbol}`}
                onClick={() => { if (linkChannel) linkBus.publish(linkChannel, row.symbol); }}
                className={`grid w-full cursor-pointer border-b border-white/[0.04] text-left transition-colors ${rowHighlightClass(highlightScore)}`}
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {activeColumnIds.map((colId) => {
                  if (colId.startsWith("ta:")) {
                    const tf = colId.slice(3);
                    const cell = techScores.get(row.symbol)?.get(tf) ?? null;
                    const score = cell?.score ?? null;
                    const isLong = row.quantity > 0;
                    const isShort = row.quantity < 0;
                    return (
                      <div
                        key={`${row.symbol}-${tf}`}
                        className={`flex min-w-0 items-center justify-center truncate border-r border-white/[0.04] px-1 py-2 text-center font-mono text-[11px] ${techScoreCellClass(score, isLong, isShort)}`}
                        title={`${describeTechScoreCell(tf, cell)} · ${isLong ? "Long" : isShort ? "Short" : "Flat"}`}
                      >
                        {score === null ? "—" : score}
                      </div>
                    );
                  }
                  const key = colId.slice(2);
                  if (key === "actions") {
                    return (
                      <div key={colId} className="flex min-w-0 items-center justify-center gap-1 border-r border-white/[0.04] px-2 py-1.5">
                        {row.editable && row.id ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openEditPosition(row); }}
                              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white"
                              title={`Edit ${row.symbol}`}
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`Delete manual position "${row.symbol}"?`)) {
                                  void runMutation(() => deleteManualPositionInner(row.id!));
                                }
                              }}
                              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-red"
                              title={`Delete ${row.symbol}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-white/16">--</span>
                        )}
                      </div>
                    );
                  }
                  const { value, tone = "text-white/60", strong } = cellValue(row, key);
                  return (
                    <div
                      key={colId}
                      className={`flex min-w-0 items-center justify-center truncate border-r border-white/[0.04] px-2 py-2 text-center font-mono text-[11px] ${tone} ${strong ? "font-semibold text-white/82" : ""}`}
                    >
                      <span className="truncate">{value}</span>
                    </div>
                  );
                })}
              </div>
            );
            })}

            {/* Cash rows */}
            {filteredCash.map((cash) => (
              <div
                key={`${cash.accountId}:${cash.currency}`}
                className="grid border-b border-white/[0.04]"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {activeColumnIds.map((colId) => {
                  if (colId.startsWith("ta:")) {
                    const tf = colId.slice(3);
                    return (
                      <div key={`cash-${tf}`} className="flex min-w-0 items-center justify-center border-r border-white/[0.04] px-1 py-2 text-center font-mono text-[11px] text-white/15">—</div>
                    );
                  }
                  const key = colId.slice(2);
                  if (key === "actions") {
                    return (
                      <div key={colId} className="flex min-w-0 items-center justify-center gap-1 border-r border-white/[0.04] px-2 py-1.5">
                        {cash.editable && cash.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditCash(cash)}
                              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white"
                              title={`Edit ${cash.currency} cash`}
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Delete manual cash balance "${cash.currency}"?`)) {
                                  void runMutation(() => deleteManualCashBalanceInner(cash.id!));
                                }
                              }}
                              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-red"
                              title={`Delete ${cash.currency} cash`}
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-white/16">--</span>
                        )}
                      </div>
                    );
                  }
                  const { value, tone = "text-white/60", strong } = cashCellValue(cash, key);
                  return (
                    <div
                      key={colId}
                      className={`flex min-w-0 items-center justify-center truncate border-r border-white/[0.04] px-2 py-2 text-center font-mono text-[11px] ${tone} ${strong ? "font-semibold text-white/82" : ""}`}
                    >
                      <span className="truncate">{value}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Composer modal ── */}
      {headerMenu ? createPortal(
        <div
          ref={headerMenuRef}
          className="fixed z-[100] min-w-[150px] rounded-md border border-white/[0.08] bg-[#1C2128] py-1 shadow-xl shadow-black/40"
          style={{ left: headerMenu.x, top: headerMenu.y }}
        >
          <div className="px-2 py-1">
            <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">Header Color</div>
            <div className="grid grid-cols-2 gap-1">
              {HEADER_TINT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[10px] text-white/60 transition-colors duration-75 hover:bg-white/[0.06] hover:text-white/85"
                  onClick={() => {
                    if (headerMenu.type === "builtIn") setBuiltInHeaderTint(headerMenu.key, preset.value);
                    else setTaHeaderTint(headerMenu.tf, preset.value);
                    setHeaderMenu(null);
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full border border-white/10"
                    style={{ backgroundColor: preset.value ?? "transparent" }}
                  />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {colDragState ? createPortal(
        <div
          className="pointer-events-none fixed z-[300] flex items-center rounded border border-blue/50 bg-base/90 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/60 shadow-lg backdrop-blur-sm"
          style={{ left: colDragState.mouseX + 10, top: colDragState.mouseY - 14 }}
        >
          {columnDragLabel(colDragState.colId)}
        </div>,
        document.body,
      ) : null}

      {composerOpen ? createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className="w-[440px] rounded-md border border-white/[0.10] bg-[#161B22] shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-amber/85">{composerMode === "position" ? "Log Position" : "Log Cash"}</p>
                <p className="mt-0.5 text-[11px] text-white/55">{positionId || cashId ? "Editing existing manual entry." : "Fast entry for the selected manual account."}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-sm border border-white/[0.08] bg-black/10 p-1">
                  <button type="button" onClick={() => setComposerMode("position")} className={`rounded-sm px-2 py-1 text-[9px] ${composerMode === "position" ? "bg-amber/[0.16] text-amber" : "text-white/40 hover:text-white/72"}`}>Position</button>
                  <button type="button" onClick={() => setComposerMode("cash")} className={`rounded-sm px-2 py-1 text-[9px] ${composerMode === "cash" ? "bg-amber/[0.16] text-amber" : "text-white/40 hover:text-white/72"}`}>Cash</button>
                </div>
                <button type="button" onClick={() => { setComposerOpen(false); resetPositionForm(); resetCashForm(); setManagerError(null); }} className="rounded-sm p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/70">
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="p-4">
              {managerError ? <div className="mb-3 rounded-sm border border-red/30 bg-red/[0.08] px-2 py-1.5 text-[10px] text-red/80">{managerError}</div> : null}
              <form onSubmit={submitComposer} className="space-y-3">
                <div>
                  <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-white/28">Manual Account</label>
                  <select value={selectedManualAccountId ?? ""} onChange={(e) => setSelectedManualAccountId(e.target.value || null)} className="h-9 w-full rounded-sm border border-white/[0.08] bg-[#0D1117] px-2 text-[11px] text-white/75 outline-none">
                    {manualAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                {composerMode === "position" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <InputField label="Symbol" value={positionSymbol} onChange={setPositionSymbol} placeholder="AAPL" />
                    <InputField label="Currency" value={positionCurrency} onChange={setPositionCurrency} placeholder="USD" />
                    <InputField label="Quantity" value={positionQty} onChange={setPositionQty} placeholder="100" />
                    <InputField label="Avg Cost" value={positionAvgCost} onChange={setPositionAvgCost} placeholder="182.50" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <InputField label="Currency" value={cashCurrency} onChange={setCashCurrency} placeholder="USD" />
                    <InputField label="Balance" value={cashBalance} onChange={setCashBalance} placeholder="25000" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => { if (composerMode === "position") resetPositionForm(); else resetCashForm(); }} className="h-8 rounded-sm border border-white/[0.08] px-3 text-[10px] text-white/55 hover:border-white/[0.18] hover:text-white/78">Clear</button>
                  <button type="submit" disabled={busy} className="h-8 rounded-sm bg-amber/[0.16] px-4 text-[10px] font-medium text-amber hover:bg-amber/[0.24] disabled:opacity-50">
                    {composerMode === "position" ? (positionId ? "Update Position" : "Add Position") : cashId ? "Update Cash" : "Add Cash"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      , document.body) : null}

      {/* ── Portfolio Manager drawer ── */}
      {managerOpen ? (
        <div className="absolute inset-y-10 right-2 z-[140] w-[390px] rounded-md border border-white/[0.08] bg-[#11161D] shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <div>
              <p className="text-[11px] font-medium text-white/78">Portfolio Manager</p>
              <p className="text-[9px] uppercase tracking-[0.14em] text-white/25">Accounts and Groups</p>
            </div>
            <button type="button" onClick={() => setManagerOpen(false)} className="rounded-sm p-1 text-white/30 hover:bg-white/[0.05] hover:text-white/70">
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <div className="max-h-[calc(100vh-180px)] space-y-4 overflow-y-auto p-3 scrollbar-dark">
            {managerError ? <div className="rounded-sm border border-red/30 bg-red/[0.08] px-2 py-1.5 text-[10px] text-red/80">{managerError}</div> : null}

            <ManagerSection title="Manual Accounts" actionLabel="New" onAction={resetAccountForm} disabled={busy}>
              {manualAccounts.map((account) => (
                <ManagerRow
                  key={account.id}
                  title={account.name}
                  subtitle={account.groupNames.length ? account.groupNames.join(", ") : "No groups"}
                  actions={
                    <>
                      <button type="button" onClick={() => { setSelectedManualAccountId(account.id); setManagerOpen(false); }} className={`rounded-sm px-1.5 py-1 text-[9px] ${selectedManualAccount?.id === account.id ? "bg-blue/[0.15] text-blue" : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"}`}>Open</button>
                      <button type="button" onClick={() => { setEditingAccountId(account.id); setAccountName(account.name); }} className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white"><Pencil className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                      <button type="button" onClick={() => { if (window.confirm(`Delete manual account "${account.name}"?`)) void runMutation(() => deleteManualAccount(rawManualAccountId(account.id))); }} className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-red"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                    </>
                  }
                />
              ))}
              {manualAccounts.length === 0 ? <p className="text-[10px] text-white/35">No manual accounts yet.</p> : null}
              <InlineFormCard title={editingAccountId ? "Edit Account" : "New Account"} onClear={editingAccountId || accountName ? resetAccountForm : undefined}>
                <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name" className="mb-2 h-8 w-full rounded-sm border border-white/[0.08] bg-black/20 px-2 text-[11px] text-white/75 outline-none placeholder:text-white/20" />
                <button type="button" onClick={() => void submitAccount()} disabled={busy} className="h-8 w-full rounded-sm bg-blue/[0.16] text-[10px] font-medium text-blue hover:bg-blue/[0.22] disabled:opacity-50">{editingAccountId ? "Update Account" : "Create Account"}</button>
              </InlineFormCard>
            </ManagerSection>

            <ManagerSection title="Groups" actionLabel="New" onAction={resetGroupForm} disabled={busy}>
              {groups.map((group) => (
                <ManagerRow
                  key={group.id}
                  title={group.name}
                  subtitle={group.accountNames.length ? group.accountNames.join(", ") : "No members"}
                  actions={
                    <>
                      <button type="button" onClick={() => { setEditingGroupId(group.id); setGroupName(group.name); }} className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white"><Pencil className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                      <button type="button" onClick={() => { if (window.confirm(`Delete group "${group.name}"?`)) void runMutation(() => deleteGroup(group.id)); }} className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-red"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                    </>
                  }
                />
              ))}
              {groups.length === 0 ? <p className="text-[10px] text-white/35">No groups yet.</p> : null}
              <InlineFormCard title={editingGroupId ? "Edit Group" : "New Group"} onClear={editingGroupId || groupName ? resetGroupForm : undefined}>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" className="mb-2 h-8 w-full rounded-sm border border-white/[0.08] bg-black/20 px-2 text-[11px] text-white/75 outline-none placeholder:text-white/20" />
                <button type="button" onClick={() => void submitGroup()} disabled={busy} className="h-8 w-full rounded-sm bg-blue/[0.16] text-[10px] font-medium text-blue hover:bg-blue/[0.22] disabled:opacity-50">{editingGroupId ? "Update Group" : "Create Group"}</button>
              </InlineFormCard>
            </ManagerSection>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatBox({ label, value, tone, change }: { label: string; value: string; tone: string | StatTone; change?: string }) {
  if (tone === "positive" || tone === "negative" || tone === "neutral") {
    const toneClass = tone === "positive"
      ? "border-green/45 bg-[#0F3A2B]"
      : tone === "negative"
        ? "border-red/45 bg-[#45181D]"
        : "border-white/[0.08] bg-white/[0.03]";
    return (
      <div className={`${STAT_BOX} ${toneClass}`}>
        <p className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-white/72">{label}</p>
        <div className="flex items-end justify-between gap-2">
          <p className="truncate font-mono text-[13px] font-semibold leading-none text-white">{value}</p>
          {change ? <p className="shrink-0 font-mono text-[11px] font-semibold leading-none text-white/90">{change}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={`${STAT_BOX} border-white/[0.06] bg-white/[0.02]`}>
      <p className="mb-0.5 text-[9px] uppercase tracking-[0.14em] text-white/25">{label}</p>
      <p className={`truncate font-mono text-[13px] font-semibold leading-none ${tone}`}>{value}</p>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (next: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-white/28">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-sm border border-white/[0.08] bg-black/20 px-2 text-[11px] text-white/75 outline-none placeholder:text-white/20" />
    </label>
  );
}

function ManagerSection({ title, actionLabel, onAction, disabled, children }: { title: string; actionLabel: string; onAction: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{title}</p>
        {actionLabel ? (
          <button type="button" onClick={onAction} disabled={disabled} className="flex items-center gap-1 rounded-sm border border-white/[0.08] px-2 py-1 text-[9px] text-white/55 transition-colors hover:border-white/[0.18] hover:text-white/78 disabled:opacity-50">
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ManagerRow({ title, subtitle, actions }: { title: string; subtitle: string; actions: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-white/[0.05] bg-black/10 px-2 py-2">
      <div>
        <p className="text-[11px] text-white/78">{title}</p>
        <p className="text-[9px] text-white/35">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

function InlineFormCard({ title, onClear, children }: { title: string; onClear?: () => void; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-white/[0.05] bg-black/10 p-2">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[9px] uppercase tracking-[0.14em] text-white/25">{title}</p>
        {onClear ? <button type="button" onClick={onClear} className="text-[9px] text-white/35 hover:text-white/70">Clear</button> : null}
      </div>
      {children}
    </div>
  );
}
