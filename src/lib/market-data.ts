import etfsJson from "../../data/etfs.json";

/** Demo quote data — will be replaced by live TWS feed */
export interface QuoteData {
  symbol: string;
  name: string;
  last: number;
  change: number;
  changePct: number;
  bid: number | null;
  mid: number | null;
  ask: number | null;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  spread: number | null;
  week52High: number | null;
  week52Low: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  source?: string | null;
}

export const DEMO_QUOTES: Record<string, QuoteData> = {
  AAPL: {
    symbol: "AAPL", name: "Apple Inc.",
    last: 593.42, change: 4.82, changePct: 0.82,
    bid: 593.40, mid: 593.42, ask: 593.43,
    open: 589.20, high: 594.15, low: 588.90,
    prevClose: 588.60, volume: 42_300_000, spread: 0.03,
    week52High: 612.50, week52Low: 410.20,
    trailingPE: 33.2, forwardPE: 30.1, marketCap: 3.6e12,
    source: "tws",
  },
  MSFT: {
    symbol: "MSFT", name: "Microsoft Corp.",
    last: 441.58, change: -2.31, changePct: -0.52,
    bid: 441.55, mid: 441.58, ask: 441.60,
    open: 443.89, high: 444.72, low: 440.10,
    prevClose: 443.89, volume: 18_700_000, spread: 0.05,
    week52High: 468.35, week52Low: 362.90,
    trailingPE: 36.8, forwardPE: 32.5, marketCap: 3.3e12,
    source: "tws",
  },
  NVDA: {
    symbol: "NVDA", name: "NVIDIA Corp.",
    last: 138.72, change: 3.14, changePct: 2.32,
    bid: 138.70, mid: 138.72, ask: 138.74,
    open: 135.58, high: 139.45, low: 134.80,
    prevClose: 135.58, volume: 67_400_000, spread: 0.04,
    week52High: 152.89, week52Low: 75.61,
    trailingPE: 65.4, forwardPE: 40.2, marketCap: 3.4e12,
    source: "tws",
  },
  SPY: {
    symbol: "SPY", name: "SPDR S&P 500 ETF",
    last: 575.23, change: 1.47, changePct: 0.26,
    bid: 575.21, mid: 575.23, ask: 575.25,
    open: 573.76, high: 576.10, low: 572.88,
    prevClose: 573.76, volume: 55_200_000, spread: 0.04,
    week52High: 589.63, week52Low: 482.10,
    trailingPE: null, forwardPE: null, marketCap: null,
    source: "tws",
  },
  TSLA: {
    symbol: "TSLA", name: "Tesla Inc.",
    last: 272.15, change: -5.68, changePct: -2.04,
    bid: 272.10, mid: 272.15, ask: 272.20,
    open: 277.83, high: 278.90, low: 270.44,
    prevClose: 277.83, volume: 38_900_000, spread: 0.10,
    week52High: 414.50, week52Low: 138.80,
    trailingPE: 95.2, forwardPE: 78.4, marketCap: 870e9,
    source: "tws",
  },
  AMZN: {
    symbol: "AMZN", name: "Amazon.com Inc.",
    last: 207.30, change: -2.23, changePct: -1.06,
    bid: 207.28, mid: 207.30, ask: 207.32,
    open: 209.53, high: 210.10, low: 206.80,
    prevClose: 209.53, volume: 31_500_000, spread: 0.04,
    week52High: 215.90, week52Low: 151.61,
    trailingPE: 58.3, forwardPE: 38.7, marketCap: 2.2e12,
    source: "tws",
  },
  GOOGL: {
    symbol: "GOOGL", name: "Alphabet Inc. CL A",
    last: 178.45, change: 1.22, changePct: 0.69,
    bid: 178.43, mid: 178.45, ask: 178.47,
    open: 177.23, high: 179.10, low: 176.80,
    prevClose: 177.23, volume: 22_800_000, spread: 0.04,
    week52High: 191.75, week52Low: 131.10,
    trailingPE: 24.1, forwardPE: 21.8, marketCap: 2.2e12,
    source: "tws",
  },
  META: {
    symbol: "META", name: "Meta Platforms Inc.",
    last: 612.30, change: 8.45, changePct: 1.40,
    bid: 612.27, mid: 612.30, ask: 612.33,
    open: 603.85, high: 614.20, low: 602.50,
    prevClose: 603.85, volume: 15_600_000, spread: 0.06,
    week52High: 638.40, week52Low: 414.50,
    trailingPE: 28.5, forwardPE: 24.3, marketCap: 1.55e12,
    source: "tws",
  },
  AMD: {
    symbol: "AMD", name: "Advanced Micro Devices",
    last: 192.88, change: -4.86, changePct: -2.46,
    bid: 192.85, mid: 192.88, ask: 192.91,
    open: 197.74, high: 198.30, low: 191.50,
    prevClose: 197.74, volume: 28_400_000, spread: 0.06,
    week52High: 227.30, week52Low: 120.58,
    trailingPE: 48.2, forwardPE: 28.6, marketCap: 312e9,
    source: "tws",
  },
  QQQ: {
    symbol: "QQQ", name: "Invesco QQQ Trust",
    last: 493.44, change: -3.82, changePct: -0.77,
    bid: 493.42, mid: 493.44, ask: 493.46,
    open: 497.26, high: 498.10, low: 492.30,
    prevClose: 497.26, volume: 42_100_000, spread: 0.04,
    week52High: 510.67, week52Low: 402.38,
    trailingPE: null, forwardPE: null, marketCap: null,
    source: "tws",
  },
  JPM: {
    symbol: "JPM", name: "JPMorgan Chase & Co.",
    last: 248.60, change: 1.85, changePct: 0.75,
    bid: 248.58, mid: 248.60, ask: 248.62,
    open: 246.75, high: 249.30, low: 246.10,
    prevClose: 246.75, volume: 8_900_000, spread: 0.04,
    week52High: 256.80, week52Low: 182.15,
    trailingPE: 12.8, forwardPE: 11.5, marketCap: 710e9,
    source: "tws",
  },
  NFLX: {
    symbol: "NFLX", name: "Netflix Inc.",
    last: 1025.40, change: 12.30, changePct: 1.21,
    bid: 1025.35, mid: 1025.40, ask: 1025.45,
    open: 1013.10, high: 1028.50, low: 1010.20,
    prevClose: 1013.10, volume: 5_200_000, spread: 0.10,
    week52High: 1064.50, week52Low: 560.30,
    trailingPE: 52.1, forwardPE: 38.6, marketCap: 440e9,
    source: "tws",
  },
};

import tickersJson from "../../data/tickers.json";

/** Common US symbols for search / autocomplete */
export interface SymbolEntry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  /** S&P 500 index weight from tickers.json — cap-weight proxy for ranking */
  indexWeight?: number;
}

export interface SymbolSearchOptions {
  limit?: number;
  /** When true, sector/industry substring matches rank after symbol and name */
  includeSectorIndustry?: boolean;
  excludeSymbol?: string;
}

function symbolSearchMatchTier(entry: SymbolEntry, q: string, includeSectorIndustry: boolean): number | null {
  const sym = entry.symbol.toLowerCase();
  const nm = entry.name.toLowerCase();
  if (sym === q) return 0;
  if (sym.startsWith(q)) return 1;
  if (sym.includes(q)) return 2;
  if (nm.startsWith(q)) return 3;
  if (nm.includes(q)) return 4;
  if (includeSectorIndustry) {
    const sec = entry.sector.toLowerCase();
    const ind = entry.industry.toLowerCase();
    if (sec.includes(q) || ind.includes(q)) return 5;
  }
  return null;
}

/**
 * Filter symbol entries by query.
 * Ranking order:
 * 1. exact symbol
 * 2. symbol prefix
 * 3. symbol substring
 * 4. name prefix
 * 5. name substring
 * 6. optional sector/industry matches
 *
 * Within a tier, larger index weight ranks first as a market-cap proxy.
 */
export function filterRankSymbolSearch(
  entries: readonly SymbolEntry[],
  rawQuery: string,
  options: SymbolSearchOptions = {},
): SymbolEntry[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const limit = options.limit ?? 12;
  const includeSectorIndustry = options.includeSectorIndustry ?? false;
  const exclude = options.excludeSymbol;

  const weight = (s: SymbolEntry) => s.indexWeight ?? 0;

  const matched: SymbolEntry[] = [];
  for (const s of entries) {
    if (exclude && s.symbol === exclude) continue;
    const tier = symbolSearchMatchTier(s, q, includeSectorIndustry);
    if (tier === null) continue;
    matched.push(s);
  }

  matched.sort((a, b) => {
    const ta = symbolSearchMatchTier(a, q, includeSectorIndustry)!;
    const tb = symbolSearchMatchTier(b, q, includeSectorIndustry)!;
    if (ta !== tb) return ta - tb;
    const wa = weight(a);
    const wb = weight(b);
    if (wb !== wa) return wb - wa;
    return a.symbol.localeCompare(b.symbol);
  });

  return matched.slice(0, limit);
}

export const ALL_SYMBOLS: SymbolEntry[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology", industry: "Software" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology", industry: "Semiconductors" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer Cyclical", industry: "Internet Retail" },
  { symbol: "GOOGL", name: "Alphabet Inc. CL A", sector: "Communication Services", industry: "Internet Content" },
  { symbol: "GOOG", name: "Alphabet Inc. CL C", sector: "Communication Services", industry: "Internet Content" },
  { symbol: "META", name: "Meta Platforms Inc.", sector: "Communication Services", industry: "Internet Content" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Consumer Cyclical", industry: "Auto Manufacturers" },
  { symbol: "BRK B", name: "Berkshire Hathaway B", sector: "Financial Services", industry: "Insurance" },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare", industry: "Healthcare Plans" },
  { symbol: "LLY", name: "Eli Lilly & Co.", sector: "Healthcare", industry: "Drug Manufacturers" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financial Services", industry: "Banks" },
  { symbol: "V", name: "Visa Inc.", sector: "Financial Services", industry: "Credit Services" },
  { symbol: "XOM", name: "Exxon Mobil Corp.", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Technology", industry: "Semiconductors" },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financial Services", industry: "Credit Services" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", industry: "Drug Manufacturers" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Defensive", industry: "Household Products" },
  { symbol: "HD", name: "Home Depot Inc.", sector: "Consumer Cyclical", industry: "Home Improvement" },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer Defensive", industry: "Discount Stores" },
  { symbol: "MRK", name: "Merck & Co.", sector: "Healthcare", industry: "Drug Manufacturers" },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Healthcare", industry: "Drug Manufacturers" },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Communication Services", industry: "Entertainment" },
  { symbol: "CRM", name: "Salesforce Inc.", sector: "Technology", industry: "Software" },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology", industry: "Semiconductors" },
  { symbol: "BAC", name: "Bank of America", sector: "Financial Services", industry: "Banks" },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy", industry: "Oil & Gas" },
  { symbol: "KO", name: "Coca-Cola Co.", sector: "Consumer Defensive", industry: "Beverages" },
  { symbol: "PEP", name: "PepsiCo Inc.", sector: "Consumer Defensive", industry: "Beverages" },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Technology", industry: "Software" },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Defensive", industry: "Discount Stores" },
  { symbol: "MCD", name: "McDonald's Corp.", sector: "Consumer Cyclical", industry: "Restaurants" },
  { symbol: "CSCO", name: "Cisco Systems", sector: "Technology", industry: "Communication Equipment" },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Technology", industry: "Software" },
  { symbol: "ACN", name: "Accenture PLC", sector: "Technology", industry: "IT Services" },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Communication Services", industry: "Entertainment" },
  { symbol: "TMO", name: "Thermo Fisher Scientific", sector: "Healthcare", industry: "Diagnostics & Research" },
  { symbol: "ABT", name: "Abbott Laboratories", sector: "Healthcare", industry: "Medical Devices" },
  { symbol: "INTC", name: "Intel Corp.", sector: "Technology", industry: "Semiconductors" },
  { symbol: "QCOM", name: "Qualcomm Inc.", sector: "Technology", industry: "Semiconductors" },
  { symbol: "TXN", name: "Texas Instruments", sector: "Technology", industry: "Semiconductors" },
  { symbol: "INTU", name: "Intuit Inc.", sector: "Technology", industry: "Software" },
  { symbol: "CMCSA", name: "Comcast Corp.", sector: "Communication Services", industry: "Telecom" },
  { symbol: "VZ", name: "Verizon Communications", sector: "Communication Services", industry: "Telecom" },
  { symbol: "PM", name: "Philip Morris Intl.", sector: "Consumer Defensive", industry: "Tobacco" },
  { symbol: "DHR", name: "Danaher Corp.", sector: "Healthcare", industry: "Diagnostics & Research" },
  { symbol: "NKE", name: "Nike Inc.", sector: "Consumer Cyclical", industry: "Footwear & Accessories" },
  { symbol: "UNP", name: "Union Pacific Corp.", sector: "Industrials", industry: "Railroads" },
  { symbol: "RTX", name: "RTX Corp.", sector: "Industrials", industry: "Aerospace & Defense" },
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities", industry: "Utilities" },
  { symbol: "HON", name: "Honeywell Intl.", sector: "Industrials", industry: "Conglomerates" },
  { symbol: "IBM", name: "IBM Corp.", sector: "Technology", industry: "IT Services" },
  { symbol: "LOW", name: "Lowe's Companies", sector: "Consumer Cyclical", industry: "Home Improvement" },
  { symbol: "AMGN", name: "Amgen Inc.", sector: "Healthcare", industry: "Biotechnology" },
  { symbol: "GE", name: "General Electric", sector: "Industrials", industry: "Aerospace & Defense" },
  { symbol: "GS", name: "Goldman Sachs", sector: "Financial Services", industry: "Capital Markets" },
  { symbol: "MS", name: "Morgan Stanley", sector: "Financial Services", industry: "Capital Markets" },
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials", industry: "Farm & Heavy Machinery" },
  { symbol: "BA", name: "Boeing Co.", sector: "Industrials", industry: "Aerospace & Defense" },
  { symbol: "SBUX", name: "Starbucks Corp.", sector: "Consumer Cyclical", industry: "Restaurants" },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "Healthcare", industry: "Medical Instruments" },
  { symbol: "BLK", name: "BlackRock Inc.", sector: "Financial Services", industry: "Asset Management" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF", industry: "" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", sector: "ETF", industry: "" },
  { symbol: "IWM", name: "iShares Russell 2000", sector: "ETF", industry: "" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF", sector: "ETF", industry: "" },
  { symbol: "VTI", name: "Vanguard Total Stock", sector: "ETF", industry: "" },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", sector: "ETF", industry: "" },
  { symbol: "ARKK", name: "ARK Innovation ETF", sector: "ETF", industry: "" },
  { symbol: "XLF", name: "Financial Select SPDR", sector: "ETF", industry: "Financial Services" },
  { symbol: "XLE", name: "Energy Select SPDR", sector: "ETF", industry: "Energy" },
  { symbol: "XLK", name: "Technology Select SPDR", sector: "ETF", industry: "Technology" },
  { symbol: "XLV", name: "Health Care Select SPDR", sector: "ETF", industry: "Healthcare" },
  { symbol: "XLI", name: "Industrial Select SPDR", sector: "ETF", industry: "Industrials" },
  { symbol: "GLD", name: "SPDR Gold Shares", sector: "ETF", industry: "Commodities" },
  { symbol: "SLV", name: "iShares Silver Trust", sector: "ETF", industry: "Commodities" },
  { symbol: "TLT", name: "iShares 20+ Yr Treasury", sector: "ETF", industry: "Fixed Income" },
  { symbol: "HYG", name: "iShares High Yield Corp", sector: "ETF", industry: "Fixed Income" },
  { symbol: "SOXX", name: "iShares Semiconductor", sector: "ETF", industry: "Semiconductors" },
];

/**
 * Full searchable symbol list — ALL_SYMBOLS (curated) merged with tickers.json.
 * ALL_SYMBOLS entries take priority for duplicates.
 */
export const SEARCHABLE_SYMBOLS: SymbolEntry[] = (() => {
  const weightBySymbol = new Map(
    tickersJson.companies.map((c) => [c.symbol, typeof c.sp500_weight === "number" ? c.sp500_weight : 0]),
  );
  const withWeight = (e: SymbolEntry): SymbolEntry => ({
    ...e,
    indexWeight: weightBySymbol.get(e.symbol) ?? e.indexWeight ?? 0,
  });
  const seen = new Set(ALL_SYMBOLS.map((s) => s.symbol));
  const fromTickers: SymbolEntry[] = tickersJson.companies
    .filter((c) => !seen.has(c.symbol))
    .map((c) => ({
      symbol: c.symbol,
      name: c.name,
      sector: c.sector || "",
      industry: c.industry || "",
      indexWeight: typeof c.sp500_weight === "number" ? c.sp500_weight : 0,
    }));
  return [...ALL_SYMBOLS.map(withWeight), ...fromTickers];
})();

/** Fast lookup by symbol */
const symbolNameMap = new Map(SEARCHABLE_SYMBOLS.map((s) => [s.symbol, s.name]));

export function getQuote(symbol: string): QuoteData | null {
  return DEMO_QUOTES[symbol] ?? null;
}

export function getSymbolName(symbol: string): string {
  return symbolNameMap.get(symbol) ?? symbol;
}

export function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + "B";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toString();
}

export function formatPrice(p: number | null): string {
  if (p == null) return "—";
  return "$" + p.toFixed(2);
}

export function formatMarketCap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M";
  return "$" + v.toFixed(0);
}

/** Alias used by components that import `Quote` */
export type Quote = QuoteData;

export interface EtfHolding {
  symbol: string;
  name: string;
  weight_pct: number;
}

export interface EtfInfo {
  symbol: string;
  name: string;
  top_holdings: EtfHolding[];
}

const ETF_DATA: Record<string, EtfInfo> = Object.fromEntries(
  etfsJson.etfs.map((e) => [e.symbol, e as EtfInfo]),
);

export function getEtfInfo(symbol: string): EtfInfo | null {
  return ETF_DATA[symbol] ?? null;
}
