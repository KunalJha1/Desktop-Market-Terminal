import { useMemo } from "react";
import type { OptionsChain } from "./use-options-data";

export type AnalyticsHighlightType = "coveredCall" | "equivalentPut" | "resistance" | "support";

export interface AnalyticsDetail {
  type: AnalyticsHighlightType;
  label: string;
  explanation: string;
  metrics: {
    callOI?: number | null;
    callVolume?: number | null;
    putOI?: number | null;
    putVolume?: number | null;
    premium?: number | null;
    delta?: number | null;
    score?: number | null;
    comparePremium?: number | null;
    annualizedReturn?: number | null;  // decimal, e.g. 0.24 = 24% annualized
    dte?: number | null;
    assignmentCushion?: number | null; // (strike - costBasis) / costBasis, decimal
    spreadPct?: number | null;         // bid/ask spread as % of mid
    iv?: number | null;
  };
}

export interface OptionsAnalytics {
  bestCoveredCall: number | null;
  resistance: number | null;
  support: number | null;
  equivalentPut: number | null;
  details: Map<number, AnalyticsDetail[]>;
}

const NULL_RESULT: OptionsAnalytics = {
  bestCoveredCall: null,
  resistance: null,
  support: null,
  equivalentPut: null,
  details: new Map(),
};

// ── Covered call scoring helpers ───────────────────────────────────────────────

/**
 * Delta factor: reward the 0.20–0.35 "sweet spot" for covered calls.
 * Too low = barely any premium; too high = high assignment risk.
 */
function deltaFactor(absDelta: number): number {
  if (absDelta >= 0.20 && absDelta <= 0.35) return 1.0;
  if (absDelta >= 0.15 && absDelta < 0.20) return 0.80;
  if (absDelta > 0.35 && absDelta <= 0.45) return 0.75;
  if (absDelta > 0.45 && absDelta <= 0.55) return 0.45;
  if (absDelta > 0.55) return 0.15; // deep ITM — very high assignment risk
  // absDelta < 0.15: very far OTM, low premium
  return 0.55;
}

/**
 * DTE factor: theta decay accelerates in the 21–45 day window.
 * Penalise very short (gamma risk) and very long (low annualised return) expirations.
 */
function dteFactor(dte: number): number {
  if (dte >= 21 && dte <= 45) return 1.0;
  if (dte > 45 && dte <= 60) return 0.88;
  if (dte > 14 && dte < 21) return 0.82;
  if (dte > 60 && dte <= 90) return 0.72;
  if (dte > 7 && dte <= 14) return 0.60;
  if (dte > 0 && dte <= 7) return 0.30;
  if (dte > 90) return 0.55;
  return 0.50;
}

/**
 * Liquidity factor: penalise wide bid/ask spreads.
 * A spread > 20% of mid is quite illiquid; > 50% is essentially untradeable.
 */
function liquidityFactor(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0 || ask <= bid) return 0.50;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return 0.50;
  const spreadPct = (ask - bid) / mid;
  if (spreadPct <= 0.05) return 1.0;
  if (spreadPct <= 0.10) return 0.95;
  if (spreadPct <= 0.20) return 0.82;
  if (spreadPct <= 0.35) return 0.65;
  if (spreadPct <= 0.50) return 0.45;
  return 0.25;
}

/**
 * Assignment cushion factor: bonus for strikes comfortably above cost basis.
 * The more room above cost basis, the lower the chance of losing money on assignment.
 */
function cushionFactor(strike: number, costBasis: number): number {
  const cushion = (strike - costBasis) / costBasis; // % above cost
  if (cushion >= 0.05) return 1.0;   // ≥5% OTM from cost — safe
  if (cushion >= 0.02) return 0.92;
  if (cushion >= 0.00) return 0.80;  // right at cost — no gain on assignment
  return 0;                          // should not happen; filter ensures strike >= costBasis
}

/**
 * IV factor: higher IV = more premium per dollar of underlying. Reward selling in
 * elevated IV environments. If IV is unavailable, neutral score.
 */
function ivFactor(iv: number | null | undefined): number {
  if (iv == null) return 0.85;
  if (iv >= 0.50) return 1.0;   // very elevated IV — great time to sell
  if (iv >= 0.35) return 0.95;
  if (iv >= 0.25) return 0.88;
  if (iv >= 0.15) return 0.78;
  return 0.65;                  // low IV — less premium available
}

function deltaAssignmentLabel(absDelta: number): string {
  if (absDelta <= 0.15) return "Very low";
  if (absDelta <= 0.25) return "Low";
  if (absDelta <= 0.40) return "Moderate";
  if (absDelta <= 0.55) return "High";
  return "Very high";
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useOptionsAnalytics(
  chain: OptionsChain | null,
  costBasis: number | null,
  spotPrice: number | null,
): OptionsAnalytics {
  return useMemo(() => {
    const rows = chain?.rows;
    if (!rows || rows.length === 0) return NULL_RESULT;

    function addDetail(
      detailsMap: Map<number, AnalyticsDetail[]>,
      strike: number,
      detail: AnalyticsDetail,
    ) {
      const existing = detailsMap.get(strike) ?? [];
      detailsMap.set(strike, [...existing, detail]);
    }

    const details = new Map<number, AnalyticsDetail[]>();

    // ── 1. Best Covered Call ──────────────────────────────────────────────────
    let bestCoveredCall: number | null = null;

    if (costBasis != null && costBasis > 0) {
      interface ScoredRow {
        strike: number;
        compositeScore: number;
        annualizedReturn: number;
        bid: number;
        ask: number | null;
        delta: number | null;
        dte: number | null;
        iv: number | null;
        spreadPct: number | null;
      }

      const scored: ScoredRow[] = [];

      for (const r of rows) {
        const c = r.call;
        if (!c || c.bid == null || c.bid <= 0 || r.strike < costBasis) continue;

        const bid = c.bid;
        const ask = c.ask ?? null;
        const dte = c.daysToExpiration ?? null;
        const delta = c.delta ?? null;
        const iv = c.impliedVolatility ?? null;
        const absDelta = Math.abs(delta ?? 0.5);

        // Annualised return on cost basis from the call premium
        const annReturn =
          dte != null && dte > 0
            ? (bid / costBasis) * (365 / dte)
            : (bid / costBasis); // no DTE data → use flat return

        const df = deltaFactor(absDelta);
        const dtef = dte != null && dte > 0 ? dteFactor(dte) : 0.75;
        const lf = ask != null ? liquidityFactor(bid, ask) : 0.70;
        const cf = cushionFactor(r.strike, costBasis);
        const ivf = ivFactor(iv);

        const compositeScore = annReturn * df * dtef * lf * cf * ivf;

        const mid = ask != null ? (bid + ask) / 2 : bid;
        const spreadPct = ask != null && mid > 0 ? (ask - bid) / mid : null;

        scored.push({ strike: r.strike, compositeScore, annualizedReturn: annReturn, bid, ask, delta, dte, iv, spreadPct });
      }

      if (scored.length > 0) {
        scored.sort((a, b) => b.compositeScore - a.compositeScore);
        const best = scored[0];
        bestCoveredCall = best.strike;

        const absDelta = Math.abs(best.delta ?? 0);
        const assignRisk = deltaAssignmentLabel(absDelta);
        const cushionPct = ((best.strike - costBasis) / costBasis) * 100;
        const annPct = (best.annualizedReturn * 100).toFixed(1);

        const dtePart = best.dte != null ? ` ${best.dte}d to expiry.` : "";
        const deltaPart = best.delta != null ? ` Δ ${absDelta.toFixed(2)} (${assignRisk} assignment risk).` : "";
        const cushionPart = cushionPct > 0 ? ` ${cushionPct.toFixed(1)}% above cost basis.` : " At cost basis.";

        addDetail(details, bestCoveredCall, {
          type: "coveredCall",
          label: "Best Covered Call",
          explanation: `${annPct}% ann. return on cost basis ($${costBasis.toFixed(2)}).${cushionPart}${dtePart}${deltaPart} Scored by annualised yield × delta quality × DTE window × liquidity × IV.`,
          metrics: {
            premium: best.bid,
            delta: best.delta,
            annualizedReturn: best.annualizedReturn,
            dte: best.dte,
            assignmentCushion: (best.strike - costBasis) / costBasis,
            spreadPct: best.spreadPct,
            iv: best.iv,
          },
        });
      }
    }

    // ── 2. Resistance (above ATM, highest call OI×0.6 + volume×0.4) ──────────
    let resistance: number | null = null;

    if (spotPrice != null) {
      const aboveAtm = rows.filter((r) => r.strike > spotPrice && r.call != null);
      if (aboveAtm.length > 0) {
        let bestScore = -1;
        let bestRow = aboveAtm[0];
        for (const r of aboveAtm) {
          const score = (r.call!.openInterest ?? 0) * 0.6 + (r.call!.volume ?? 0) * 0.4;
          if (score > bestScore) {
            bestScore = score;
            bestRow = r;
          }
        }
        if (bestScore > 0) {
          resistance = bestRow.strike;
          addDetail(details, resistance, {
            type: "resistance",
            label: "Resistance Level",
            explanation: "Highest call open interest + volume concentration above current price. Large call walls often act as a price ceiling.",
            metrics: {
              callOI: bestRow.call!.openInterest,
              callVolume: bestRow.call!.volume,
              score: bestScore,
            },
          });
        }
      }
    }

    // ── 3. Support (below ATM, highest put OI×0.6 + volume×0.4) ─────────────
    let support: number | null = null;

    if (spotPrice != null) {
      const belowAtm = rows.filter((r) => r.strike < spotPrice && r.put != null);
      if (belowAtm.length > 0) {
        let bestScore = -1;
        let bestRow = belowAtm[0];
        for (const r of belowAtm) {
          const score = (r.put!.openInterest ?? 0) * 0.6 + (r.put!.volume ?? 0) * 0.4;
          if (score > bestScore) {
            bestScore = score;
            bestRow = r;
          }
        }
        if (bestScore > 0) {
          support = bestRow.strike;
          addDetail(details, support, {
            type: "support",
            label: "Support Level",
            explanation: "Highest put open interest + volume concentration below current price. Large put walls often act as a price floor.",
            metrics: {
              putOI: bestRow.put!.openInterest,
              putVolume: bestRow.put!.volume,
              score: bestScore,
            },
          });
        }
      }
    }

    // ── 4. Equivalent Naked Put (same strike as covered call) ─────────────────
    const equivalentPut = bestCoveredCall;

    if (equivalentPut != null) {
      const matchRow = rows.find((r) => r.strike === equivalentPut);
      const p = matchRow?.put;
      const putBid = p?.bid ?? null;
      const callBid = matchRow?.call?.bid ?? null;
      const putDelta = p?.delta ?? null;
      const putDte = p?.daysToExpiration ?? null;
      const putIv = p?.impliedVolatility ?? null;

      const putAsk = p?.ask ?? null;
      const putMid = putAsk != null && putBid != null ? (putBid + putAsk) / 2 : putBid;
      const putSpreadPct =
        putBid != null && putAsk != null && putMid != null && putMid > 0
          ? (putAsk - putBid) / putMid
          : null;

      let comparison = "";
      if (putBid != null && callBid != null) {
        const diff = putBid - callBid;
        if (diff > 0.01) comparison = `Put captures $${diff.toFixed(2)} more premium.`;
        else if (diff < -0.01) comparison = `Call captures $${Math.abs(diff).toFixed(2)} more premium.`;
        else comparison = "Put and call bid roughly equal.";
      }

      const annReturn =
        costBasis != null &&
        costBasis > 0 &&
        putBid != null &&
        putDte != null &&
        putDte > 0
          ? (putBid / costBasis) * (365 / putDte)
          : null;

      addDetail(details, equivalentPut, {
        type: "equivalentPut",
        label: "Equivalent Naked Put",
        explanation: `Sell this put at the same strike as the covered call to capture similar premium without owning shares. ${comparison}`,
        metrics: {
          premium: putBid,
          delta: putDelta,
          comparePremium: callBid,
          annualizedReturn: annReturn,
          dte: putDte,
          spreadPct: putSpreadPct,
          iv: putIv,
        },
      });
    }

    return {
      bestCoveredCall,
      resistance,
      support,
      equivalentPut,
      details,
    };
  }, [chain, costBasis, spotPrice]);
}
