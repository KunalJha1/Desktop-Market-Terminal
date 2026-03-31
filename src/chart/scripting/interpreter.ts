/**
 * DailyIQ Script — Interpreter
 *
 * Pipeline: source → Lexer → [IndentationPass] → Parser → evaluate AST → ScriptResult
 *
 * Execution model: series mode — every value is a number[] with one entry per bar.
 * Scalars are length-1 arrays, broadcast to full length when needed.
 *
 * if/else blocks use a condition-stack: assignments and plotshape calls
 * inside a block are filtered to bars where the current condition is truthy.
 */

import { computeTechnicalScore } from '../indicators/oscillators/technicalScore';
import { computeMarketSentiment } from '../indicators/oscillators/marketSentiment';
import { computeTrendAngle } from '../indicators/oscillators/trendAngle';
import { computeBullBearPower } from '../indicators/oscillators/bullBearPower';
import { computeLinearRegressionSentiment } from '../indicators/oscillators/linearRegression';
import { computeMarketStructureSentiment } from '../indicators/oscillators/marketStructure';
import type {
  OHLCVBar,
  ScriptPlot,
  ScriptHLine,
  ScriptFill,
  ScriptShape,
  ScriptResult,
  ScriptError,
} from '../types';

import { Lexer } from './lexer';
import { applyIndentation } from './indentation';
import { Parser } from './parser';
import { stdlib, namespacedLib } from './stdlib';
import type { ASTNode } from './types';

// ─── Internal value type ──────────────────────────────────────────────────

type Value = number[]; // one number per bar; scalars are length-1 arrays

// ─── Return-value exception (for user-defined functions) ──────────────────

class ReturnSignal {
  constructor(public readonly value: Value) {}
}

// ─── Stored user-defined function ─────────────────────────────────────────

interface UserFunction {
  params: string[];
  body: ASTNode[];
}

// ─── Environment ──────────────────────────────────────────────────────────

class Environment {
  private vars = new Map<string, Value>();
  private functions = new Map<string, UserFunction>();
  private bars: OHLCVBar[];

  /** Condition stack for if/else branches */
  private conditionStack: number[][] = [];

  // Collected outputs
  plots: ScriptPlot[] = [];
  hlines: ScriptHLine[] = [];
  fills: ScriptFill[] = [];
  shapes: ScriptShape[] = [];
  inputs: Record<string, number> = {};
  indicatorMeta?: { name: string; overlay: boolean; isStrategy: boolean };
  errors: ScriptError[] = [];

  private plotMap = new Map<string, number[]>();

  constructor(bars: OHLCVBar[]) {
    this.bars = bars;
    // Built-in series
    this.vars.set('open',   bars.map(b => b.open));
    this.vars.set('high',   bars.map(b => b.high));
    this.vars.set('low',    bars.map(b => b.low));
    this.vars.set('close',  bars.map(b => b.close));
    this.vars.set('volume', bars.map(b => b.volume));
    // Derived series (Pine Script hl2, hlc3, ohlc4)
    this.vars.set('hl2',   bars.map(b => (b.high + b.low) / 2));
    this.vars.set('hlc3',  bars.map(b => (b.high + b.low + b.close) / 3));
    this.vars.set('ohlc4', bars.map(b => (b.open + b.high + b.low + b.close) / 4));
    this.vars.set('bar_index', bars.map((_, i) => i));
    // Sentinel for na
    this.vars.set('na', [NaN]);
    // DailyIQ proprietary series (lazy — only computed when bars exist)
    if (bars.length > 0) {
      try {
        const scoreResult = computeTechnicalScore(bars, {});
        this.vars.set('diq_score', scoreResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_score', new Array(bars.length).fill(NaN)); }
      try {
        const sentResult = computeMarketSentiment(bars, {});
        this.vars.set('diq_sentiment', sentResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_sentiment', new Array(bars.length).fill(NaN)); }
      try {
        const taResult = computeTrendAngle(bars, {});
        this.vars.set('diq_trend_angle', taResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_trend_angle', new Array(bars.length).fill(NaN)); }
      try {
        const bbpResult = computeBullBearPower(bars, {});
        this.vars.set('diq_bull_bear', bbpResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_bull_bear', new Array(bars.length).fill(NaN)); }
      try {
        const lrResult = computeLinearRegressionSentiment(bars, {});
        this.vars.set('diq_lin_reg', lrResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_lin_reg', new Array(bars.length).fill(NaN)); }
      try {
        const msResult = computeMarketStructureSentiment(bars, {});
        this.vars.set('diq_structure', msResult[0] ?? new Array(bars.length).fill(NaN));
      } catch { this.vars.set('diq_structure', new Array(bars.length).fill(NaN)); }
    }
  }

  get(name: string): Value | undefined {
    return this.vars.get(name);
  }

  set(name: string, v: Value): void {
    this.vars.set(name, v);
  }

  getFunction(name: string): UserFunction | undefined {
    return this.functions.get(name);
  }

  setFunction(name: string, params: string[], body: ASTNode[]): void {
    this.functions.set(name, { params, body });
  }

  getBarCount(): number {
    return this.bars.length;
  }

  getBars(): OHLCVBar[] {
    return this.bars;
  }

  // ── Condition stack ──────────────────────────────────────────────────────

  pushCondition(cond: number[]): void {
    this.conditionStack.push(cond);
  }

  popCondition(): void {
    this.conditionStack.pop();
  }

  /** Returns the top-of-stack condition, or null if not inside a branch. */
  getCurrentCondition(): number[] | null {
    return this.conditionStack.length > 0
      ? this.conditionStack[this.conditionStack.length - 1]
      : null;
  }

  // ── Outputs ──────────────────────────────────────────────────────────────

  addPlot(label: string, values: number[], color: string, lineWidth: number, style?: string): void {
    this.plots.push({ values, label, color, lineWidth, style });
    this.plotMap.set(label, values);
  }

  getPlotValues(label: string): number[] | undefined {
    return this.plotMap.get(label);
  }

  addShape(values: number[], style: string, location: string, color: string, text: string): void {
    this.shapes.push({ values, style, location, color, text });
  }

  /**
   * Create a child environment for user function calls.
   * Inherits bar data but has its own variable scope.
   */
  createChild(): Environment {
    const child = new Environment(this.bars);
    // Inherit user functions
    for (const [name, fn] of this.functions) {
      child.functions.set(name, fn);
    }
    return child;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function broadcast(v: Value, len: number): number[] {
  if (v.length === len) return v;
  if (v.length === 1) return new Array(len).fill(v[0]);
  return v;
}

function toScalar(v: Value): number {
  return v[0] ?? NaN;
}

function isTruthy(v: Value): boolean {
  if (v.length === 1) return !!v[0] && !isNaN(v[0]);
  // For series, consider truthy if last value is truthy
  const last = v[v.length - 1];
  return !!last && !isNaN(last);
}

// ─── Core evaluate ────────────────────────────────────────────────────────

function evaluate(node: ASTNode, env: Environment): Value {
  switch (node.kind) {

    case 'NumberLiteral':
      return [node.value];

    case 'StringLiteral':
      return [NaN]; // strings are only used in named args

    case 'HexColorLiteral':
      return [NaN]; // color only used as named arg

    case 'BooleanLiteral':
      return [node.value ? 1 : 0];

    case 'Identifier': {
      const v = env.get(node.name);
      if (v !== undefined) return v;
      env.errors.push({ line: node.line, message: `Unknown variable: ${node.name}` });
      return [0];
    }

    case 'BinaryExpr': {
      const left = evaluate(node.left, env);
      const right = evaluate(node.right, env);
      return binaryOp(node.op, left, right, env.getBarCount());
    }

    case 'UnaryExpr': {
      const operand = evaluate(node.operand, env);
      return unaryOp(node.op, operand, env.getBarCount());
    }

    case 'Ternary': {
      const cond = evaluate(node.condition, env);
      const t = evaluate(node.trueExpr, env);
      const f = evaluate(node.falseExpr, env);
      const len = env.getBarCount();
      const cb = broadcast(cond, len);
      const tb = broadcast(t, len);
      const fb = broadcast(f, len);
      return cb.map((c, i) => c ? tb[i] : fb[i]);
    }

    case 'IndexExpr': {
      // History shift: series[N]
      const series = evaluate(node.object, env);
      const offsetVal = evaluate(node.index, env);
      const offset = Math.round(toScalar(offsetVal));
      const len = env.getBarCount();
      const src = broadcast(series, len);
      const out = new Array(len);
      for (let i = 0; i < len; i++) {
        const srcIdx = i - offset;
        out[i] = srcIdx >= 0 && srcIdx < len ? src[srcIdx] : NaN;
      }
      return out;
    }

    case 'FunctionCall': {
      const { name, args, namedArgs } = node;

      // ── indicator() / strategy() declarations ──────────────────────────
      if (name === 'indicator' || name === 'strategy') {
        const title = args[0]?.kind === 'StringLiteral' ? args[0].value : 'Custom Script';
        let overlay = name === 'indicator'; // default overlay=true for indicator, false for strategy
        for (const na of namedArgs) {
          if (na.name === 'overlay') {
            const v = evaluate(na.value, env);
            overlay = toScalar(v) !== 0;
          }
        }
        env.indicatorMeta = { name: title, overlay, isStrategy: name === 'strategy' };
        return [0];
      }

      // ── User-defined function ──────────────────────────────────────────
      const userFn = env.getFunction(name);
      if (userFn) {
        return callUserFunction(userFn, args, env);
      }

      // ── Standard library ───────────────────────────────────────────────
      const fn = stdlib[name];
      if (!fn) {
        env.errors.push({ line: node.line, message: `Unknown function: ${name}` });
        return new Array(env.getBarCount()).fill(NaN);
      }
      const evaledArgs = args.map(a => broadcast(evaluate(a, env), env.getBarCount()));
      return fn(evaledArgs, env.getBarCount(), env.getBars());
    }

    case 'NamespacedCall': {
      const { namespace, fn, args } = node;
      const key = `${namespace}.${fn}`;

      // ── input.* (input.bool, input.float, input.int, input.string) ───────
      if (namespace === 'input') {
        // input.bool("Label", default) | input.float("Label", default) | etc.
        // Args may be (title, defVal) or (defVal, title) depending on usage.
        // We accept both orderings: if first arg is a string, it's the title.
        let defVal = 0;
        let title = fn;
        if (args.length >= 1) {
          if (args[0].kind === 'StringLiteral') {
            title = args[0].value;
            defVal = args[1] ? toScalar(evaluate(args[1], env)) : 0;
          } else {
            defVal = toScalar(evaluate(args[0], env));
            if (args[1]?.kind === 'StringLiteral') title = args[1].value;
          }
        }
        if (fn === 'bool') defVal = isNaN(defVal) ? 0 : defVal ? 1 : 0;
        if (isNaN(defVal)) defVal = 0;
        env.inputs[title] = defVal;
        return [defVal];
      }

      const libFn = namespacedLib[key];
      if (!libFn) {
        env.errors.push({ line: node.line, message: `Unknown function: ${key}` });
        return new Array(env.getBarCount()).fill(NaN);
      }
      const evaledArgs = args.map(a => broadcast(evaluate(a, env), env.getBarCount()));
      return libFn(evaledArgs, env.getBarCount(), env.getBars());
    }

    case 'Assignment': {
      const val = broadcast(evaluate(node.value, env), env.getBarCount());
      const cond = env.getCurrentCondition();
      if (cond) {
        const existing = env.get(node.name) ?? new Array(env.getBarCount()).fill(NaN);
        const result = existing.map((e: number, i: number) => cond[i] ? val[i] : e);
        env.set(node.name, result);
        return result;
      }
      env.set(node.name, val);
      return val;
    }

    case 'Reassignment': {
      // Same semantics as Assignment in series mode
      const val = broadcast(evaluate(node.value, env), env.getBarCount());
      const cond = env.getCurrentCondition();
      if (cond) {
        const existing = env.get(node.name) ?? new Array(env.getBarCount()).fill(NaN);
        const result = existing.map((e: number, i: number) => cond[i] ? val[i] : e);
        env.set(node.name, result);
        return result;
      }
      env.set(node.name, val);
      return val;
    }

    case 'VarDecl': {
      // Same as Assignment in series mode; 'var' signals intent to reassign later
      const val = broadcast(evaluate(node.value, env), env.getBarCount());
      env.set(node.name, val);
      return val;
    }

    case 'InputDecl': {
      const defVal = toScalar(evaluate(node.defaultValue, env));
      env.inputs[node.name] = defVal;
      env.set(node.name, [defVal]);
      return [defVal];
    }

    case 'PlotCall': {
      const values = broadcast(evaluate(node.expr, env), env.getBarCount());
      let label = `plot_${env.plots.length}`;
      if (node.label?.kind === 'StringLiteral') label = node.label.value;

      let color = '#1A56DB';
      let lineWidth = 1;
      let style: string | undefined;
      for (const na of node.namedArgs) {
        if (na.name === 'color') color = resolveColor(na.value);
        else if (na.name === 'lineWidth' || na.name === 'linewidth') {
          lineWidth = toScalar(evaluate(na.value, env));
        } else if (na.name === 'style') {
          if (na.value.kind === 'Identifier') style = na.value.name;
          else if (na.value.kind === 'StringLiteral') style = na.value.value;
        }
      }

      env.addPlot(label, values, color, lineWidth, style);
      return values;
    }

    case 'HLineCall': {
      const val = toScalar(evaluate(node.value, env));
      let color = '#888888';
      let style: 'solid' | 'dashed' = 'solid';
      for (const na of node.namedArgs) {
        if (na.name === 'color') color = resolveColor(na.value);
        else if (na.name === 'style') {
          if (na.value.kind === 'Identifier') style = na.value.name as 'solid' | 'dashed';
        }
      }
      env.hlines.push({ value: val, color, style });
      return [val];
    }

    case 'FillCall': {
      let plotALabel = '';
      let plotBLabel = '';
      if (node.plotA.kind === 'StringLiteral') plotALabel = node.plotA.value;
      else if (node.plotA.kind === 'Identifier') plotALabel = node.plotA.name;
      if (node.plotB.kind === 'StringLiteral') plotBLabel = node.plotB.value;
      else if (node.plotB.kind === 'Identifier') plotBLabel = node.plotB.name;

      let color = 'rgba(26,86,219,0.15)';
      for (const na of node.namedArgs) {
        if (na.name === 'color') color = resolveColor(na.value);
      }
      env.fills.push({ plotA: plotALabel, plotB: plotBLabel, color });
      return [0];
    }

    case 'PlotShapeCall': {
      const seriesVals = broadcast(evaluate(node.series, env), env.getBarCount());
      let style = 'triangleup';
      let location = 'abovebar';
      let color = '#888888';
      let text = '';
      for (const na of node.namedArgs) {
        if (na.name === 'style') {
          if (na.value.kind === 'Identifier') style = na.value.name;
          else if (na.value.kind === 'StringLiteral') style = na.value.value;
        } else if (na.name === 'location') {
          if (na.value.kind === 'Identifier') location = na.value.name;
        } else if (na.name === 'color') {
          color = resolveColor(na.value);
        } else if (na.name === 'text') {
          if (na.value.kind === 'StringLiteral') text = na.value.value;
        }
      }

      const cond = env.getCurrentCondition();
      const markers = new Array(env.getBarCount()).fill(NaN);
      for (let i = 0; i < env.getBarCount(); i++) {
        if (!cond || cond[i]) markers[i] = seriesVals[i];
      }
      env.addShape(markers, style, location, color, text);
      return [0];
    }

    case 'BgColorCall': {
      // Future: implement background color highlighting
      return [0];
    }

    // ── Control flow ───────────────────────────────────────────────────────

    case 'IfStatement': {
      let cond = broadcast(evaluate(node.condition, env), env.getBarCount());

      // AND with any outer condition from enclosing if/else
      const outerCond = env.getCurrentCondition();
      if (outerCond) {
        cond = cond.map((v, i) => (v && outerCond[i]) ? 1 : 0);
      }

      // Execute then-body
      env.pushCondition(cond);
      for (const stmt of node.thenBody) {
        evaluate(stmt, env);
      }
      env.popCondition();

      // Execute else-body (if any)
      if (node.elseBody && node.elseBody.length > 0) {
        const invertedCond = cond.map(v => v ? 0 : 1);
        const elseCond = outerCond
          ? invertedCond.map((v, i) => (v && outerCond[i]) ? 1 : 0)
          : invertedCond;

        env.pushCondition(elseCond);
        for (const stmt of node.elseBody) {
          evaluate(stmt, env);
        }
        env.popCondition();
      }

      return [0];
    }

    case 'ForStatement': {
      const fromVal = Math.round(toScalar(evaluate(node.from, env)));
      const toVal = Math.round(toScalar(evaluate(node.to, env)));
      const stepVal = node.step ? Math.round(toScalar(evaluate(node.step, env))) : 1;

      const maxIter = 10_000;
      let iter = 0;
      for (let i = fromVal; i <= toVal && iter < maxIter; i += stepVal, iter++) {
        env.set(node.varName, [i]);
        for (const stmt of node.body) {
          try {
            evaluate(stmt, env);
          } catch (e) {
            if (e instanceof ReturnSignal) throw e; // propagate returns
            throw e;
          }
        }
      }
      return [0];
    }

    case 'WhileStatement': {
      const maxIter = 10_000;
      let iter = 0;
      while (iter < maxIter) {
        const cond = evaluate(node.condition, env);
        if (!isTruthy(cond)) break;
        for (const stmt of node.body) {
          evaluate(stmt, env);
        }
        iter++;
      }
      return [0];
    }

    case 'FunctionDef': {
      env.setFunction(node.name, node.params, node.body);
      return [0];
    }

    case 'ReturnStatement': {
      const val = broadcast(evaluate(node.value, env), env.getBarCount());
      throw new ReturnSignal(val);
    }

    default:
      return [NaN];
  }
}

// ─── User Function Call ───────────────────────────────────────────────────

function callUserFunction(fn: { params: string[]; body: ASTNode[] }, args: ASTNode[], env: Environment): Value {
  const child = env.createChild();
  for (let i = 0; i < fn.params.length; i++) {
    const argVal = args[i] ? broadcast(evaluate(args[i], env), env.getBarCount()) : [NaN];
    child.set(fn.params[i], argVal);
  }
  let result: Value = [NaN];
  for (const stmt of fn.body) {
    try {
      result = evaluate(stmt, child);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        result = e.value;
        break;
      }
      throw e;
    }
  }
  return result;
}

// ─── Binary / Unary Ops ──────────────────────────────────────────────────

function binaryOp(op: string, left: Value, right: Value, barCount: number): Value {
  const lb = broadcast(left, barCount);
  const rb = broadcast(right, barCount);
  const len = (left.length > 1 || right.length > 1) ? barCount : 1;
  const out = new Array(len);

  for (let i = 0; i < len; i++) {
    const a = lb[i] ?? lb[0];
    const b = rb[i] ?? rb[0];
    switch (op) {
      case '+': out[i] = a + b; break;
      case '-': out[i] = a - b; break;
      case '*': out[i] = a * b; break;
      case '/': out[i] = b === 0 ? NaN : a / b; break;
      case '%': out[i] = b === 0 ? NaN : a % b; break;
      case '>': out[i] = a > b ? 1 : 0; break;
      case '<': out[i] = a < b ? 1 : 0; break;
      case '>=': out[i] = a >= b ? 1 : 0; break;
      case '<=': out[i] = a <= b ? 1 : 0; break;
      case '==': out[i] = a === b ? 1 : 0; break;
      case '!=': out[i] = a !== b ? 1 : 0; break;
      case '&&': out[i] = (a && b) ? 1 : 0; break;
      case '||': out[i] = (a || b) ? 1 : 0; break;
      default: out[i] = NaN;
    }
    if ((op === '+' || op === '-' || op === '*' || op === '/' || op === '%') &&
        (isNaN(a) || isNaN(b))) {
      out[i] = NaN;
    }
  }
  return out;
}

function unaryOp(op: string, operand: Value, barCount: number): Value {
  const src = broadcast(operand, barCount);
  const len = operand.length > 1 ? barCount : 1;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const v = src[i] ?? src[0];
    switch (op) {
      case '-': out[i] = -v; break;
      case '!': out[i] = v ? 0 : 1; break;
      default: out[i] = NaN;
    }
  }
  return out;
}

// ─── Color Resolution ─────────────────────────────────────────────────────

function resolveColor(node: ASTNode): string {
  if (node.kind === 'HexColorLiteral') return node.value;
  if (node.kind === 'StringLiteral') return node.value;
  if (node.kind === 'Identifier') return node.name;
  return '#888888';
}

// ─── Public API ───────────────────────────────────────────────────────────

export function interpretScript(source: string, bars: OHLCVBar[]): ScriptResult {
  if (bars.length === 0) {
    return { plots: [], hlines: [], fills: [], shapes: [], inputs: {}, errors: [] };
  }

  const allErrors: ScriptError[] = [];

  // 1. Lex
  let rawTokens;
  try {
    rawTokens = new Lexer(source).tokenize();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    allErrors.push({ line: 1, message: `Lexer error: ${msg}` });
    return { plots: [], hlines: [], fills: [], shapes: [], inputs: {}, errors: allErrors };
  }

  // 2. Indentation pass (LineIndent → Indent/Dedent)
  const tokens = applyIndentation(rawTokens);

  // 3. Parse
  const { statements, errors: parseErrors } = new Parser(tokens).parse();
  allErrors.push(...parseErrors);

  // 4. Evaluate
  const env = new Environment(bars);
  // Pre-initialize all top-level assigned variables to NaN so forward references work
  for (const stmt of statements) {
    if (
      (stmt.kind === 'Assignment' || stmt.kind === 'VarDecl') &&
      env.get((stmt as { name: string }).name) === undefined
    ) {
      env.set((stmt as { name: string }).name, new Array(bars.length).fill(NaN));
    }
  }
  for (const stmt of statements) {
    try {
      evaluate(stmt, env);
    } catch (e: unknown) {
      if (e instanceof ReturnSignal) break; // top-level return, stop evaluation
      const msg = e instanceof Error ? e.message : String(e);
      const line = (stmt as unknown as { line?: number }).line ?? 0;
      allErrors.push({ line, message: `Runtime error: ${msg}` });
    }
  }

  allErrors.push(...env.errors);

  return {
    plots: env.plots,
    hlines: env.hlines,
    fills: env.fills,
    shapes: env.shapes,
    inputs: env.inputs,
    indicatorMeta: env.indicatorMeta,
    errors: allErrors,
  };
}
