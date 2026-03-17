/**
 * DailyIQ Script — Interpreter
 *
 * Pipeline: source → Lexer → Parser → evaluate AST → ScriptResult
 */

import type {
  OHLCVBar,
  ScriptPlot,
  ScriptHLine,
  ScriptFill,
  ScriptResult,
  ScriptError,
} from '../types';

import { Lexer } from './lexer';
import { Parser } from './parser';
import { stdlib } from './stdlib';
import type { ASTNode } from './types';

// ─── Value type used internally ───────────────────────────────────────────

type Value = number[]; // one number per bar; scalars are length-1 arrays

// ─── Interpreter Environment ──────────────────────────────────────────────

class Environment {
  private vars = new Map<string, Value>();
  private barCount: number;

  // Collected outputs
  plots: ScriptPlot[] = [];
  hlines: ScriptHLine[] = [];
  fills: ScriptFill[] = [];
  inputs: Record<string, number> = {};
  errors: ScriptError[] = [];

  // Map from plot label → values (for fill references)
  private plotMap = new Map<string, number[]>();

  constructor(bars: OHLCVBar[]) {
    this.barCount = bars.length;
    // Built-in series
    this.vars.set('open', bars.map((b) => b.open));
    this.vars.set('high', bars.map((b) => b.high));
    this.vars.set('low', bars.map((b) => b.low));
    this.vars.set('close', bars.map((b) => b.close));
    this.vars.set('volume', bars.map((b) => b.volume));
  }

  get(name: string): Value | undefined {
    return this.vars.get(name);
  }

  set(name: string, v: Value): void {
    this.vars.set(name, v);
  }

  getBarCount(): number {
    return this.barCount;
  }

  addPlot(label: string, values: number[], color: string, lineWidth: number): void {
    this.plots.push({ values, label, color, lineWidth });
    this.plotMap.set(label, values);
  }

  getPlotValues(label: string): number[] | undefined {
    return this.plotMap.get(label);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function broadcast(v: Value, len: number): number[] {
  if (v.length === len) return v;
  if (v.length === 1) return new Array(len).fill(v[0]);
  return v; // length mismatch — just return as-is
}

function toScalar(v: Value): number {
  return v[0] ?? NaN;
}

// ─── Core evaluate ────────────────────────────────────────────────────────

function evaluate(node: ASTNode, env: Environment): Value {
  switch (node.kind) {
    case 'NumberLiteral':
      return [node.value];

    case 'StringLiteral':
      // Strings aren't numeric — return NaN scalar.
      // Strings are only meaningful in plot labels / named args.
      return [NaN];

    case 'HexColorLiteral':
      return [NaN]; // color only used as named arg

    case 'Identifier': {
      const v = env.get(node.name);
      if (v !== undefined) return v;
      // Unknown identifier → treat as 0 with error
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
      const out = new Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = cb[i] ? tb[i] : fb[i];
      }
      return out;
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
      const fn = stdlib[node.name];
      if (!fn) {
        env.errors.push({ line: node.line, message: `Unknown function: ${node.name}` });
        return new Array(env.getBarCount()).fill(NaN);
      }
      const args = node.args.map((a) => {
        const v = evaluate(a, env);
        return broadcast(v, env.getBarCount());
      });
      return fn(args, env.getBarCount());
    }

    case 'Assignment': {
      const val = evaluate(node.value, env);
      const expanded = broadcast(val, env.getBarCount());
      env.set(node.name, expanded);
      return expanded;
    }

    case 'InputDecl': {
      const defVal = evaluate(node.defaultValue, env);
      const scalar = toScalar(defVal);
      env.inputs[node.name] = scalar;
      // Store as scalar so other expressions can reference it
      env.set(node.name, [scalar]);
      return [scalar];
    }

    case 'PlotCall': {
      const values = broadcast(evaluate(node.expr, env), env.getBarCount());
      let label = 'plot';
      if (node.label) {
        if (node.label.kind === 'StringLiteral') {
          label = node.label.value;
        } else {
          label = `plot_${env.plots.length}`;
        }
      }

      let color = '#1A56DB';
      let lineWidth = 1;
      for (const na of node.namedArgs) {
        if (na.name === 'color') {
          color = resolveColor(na.value);
        } else if (na.name === 'lineWidth') {
          lineWidth = toScalar(evaluate(na.value, env));
        }
      }

      env.addPlot(label, values, color, lineWidth);
      return values;
    }

    case 'HLineCall': {
      const val = toScalar(evaluate(node.value, env));
      let color = '#888888';
      let style: 'solid' | 'dashed' = 'solid';
      for (const na of node.namedArgs) {
        if (na.name === 'color') {
          color = resolveColor(na.value);
        } else if (na.name === 'style') {
          if (na.value.kind === 'Identifier') {
            style = na.value.name as 'solid' | 'dashed';
          }
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
        if (na.name === 'color') {
          color = resolveColor(na.value);
        }
      }
      env.fills.push({ plotA: plotALabel, plotB: plotBLabel, color });
      return [0];
    }

    default:
      return [NaN];
  }
}

// ─── Binary / Unary Ops ──────────────────────────────────────────────────

function binaryOp(op: string, left: Value, right: Value, barCount: number): Value {
  const lb = broadcast(left, barCount);
  const rb = broadcast(right, barCount);
  // If both are scalars, return scalar
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
      case '&&': out[i] = a && b ? 1 : 0; break;
      case '||': out[i] = a || b ? 1 : 0; break;
      default: out[i] = NaN;
    }
    // Propagate NaN for arithmetic (not comparisons)
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

// ─── Resolve color from AST node ──────────────────────────────────────────

function resolveColor(node: ASTNode): string {
  if (node.kind === 'HexColorLiteral') return node.value;
  if (node.kind === 'StringLiteral') return node.value;
  if (node.kind === 'Identifier') return node.name; // e.g. "red"
  return '#888888';
}

// ─── Public API ───────────────────────────────────────────────────────────

export function interpretScript(source: string, bars: OHLCVBar[]): ScriptResult {
  if (bars.length === 0) {
    return { plots: [], hlines: [], fills: [], inputs: {}, errors: [] };
  }

  const allErrors: ScriptError[] = [];

  // 1. Lex
  let tokens;
  try {
    const lexer = new Lexer(source);
    tokens = lexer.tokenize();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    allErrors.push({ line: 1, message: `Lexer error: ${msg}` });
    return { plots: [], hlines: [], fills: [], inputs: {}, errors: allErrors };
  }

  // 2. Parse
  const parser = new Parser(tokens);
  const { statements, errors: parseErrors } = parser.parse();
  allErrors.push(...parseErrors);

  // 3. Evaluate
  const env = new Environment(bars);
  for (const stmt of statements) {
    try {
      evaluate(stmt, env);
    } catch (e: unknown) {
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
    inputs: env.inputs,
    errors: allErrors,
  };
}
