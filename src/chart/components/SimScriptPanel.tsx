import { useState, useRef, useCallback, useMemo } from 'react';
import { X, Play, Copy, Check, BookOpen, Code2, Sparkles } from 'lucide-react';
import type { ScriptError } from '../types';

interface SimScriptPanelProps {
  open: boolean;
  onClose: () => void;
  width?: number;
  source: string;
  onSourceChange: (s: string) => void;
  /** Called when user clicks Run — should trigger the simulation */
  onRun: (source: string) => void;
  errors?: ScriptError[];
}

// ─── Syntax highlighting (mirrors ScriptEditor) ──────────────────────────────

const SCRIPT_KEYWORDS = new Set([
  'indicator', 'strategy', 'plot', 'plotshape', 'hline', 'fill',
  'input', 'if', 'else', 'for', 'while', 'return',
  'and', 'or', 'not', 'true', 'false', 'na',
  'color', 'style', 'overlay', 'title', 'shape', 'location',
]);

const SCRIPT_CONSTANTS = new Set([
  'open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4',
]);

const SCRIPT_FUNCTIONS = new Set([
  'sma', 'ema', 'rma', 'wma', 'vwma', 'stdev', 'sum', 'highest', 'lowest',
  'atr', 'rsi', 'mfi', 'cci', 'obv', 'vwap', 'supertrend',
  'crossover', 'crossunder', 'macd',
  'round', 'floor', 'ceil', 'abs', 'sqrt', 'log', 'pow', 'max', 'min', 'nz',
  'ta',
]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLine(line: string): string {
  const commentStart = line.indexOf('//');
  const codePart = commentStart >= 0 ? line.slice(0, commentStart) : line;
  const commentPart = commentStart >= 0 ? line.slice(commentStart) : '';

  const tokenRegex = /(#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\b/g;
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(codePart)) !== null) {
    html += escapeHtml(codePart.slice(lastIndex, match.index));
    const [token, hexColor, doubleQuoted, singleQuoted, numberLiteral, identifier] = match;

    if (hexColor) {
      html += `<span style="color:#79C0FF">${escapeHtml(token)}</span>`;
    } else if (doubleQuoted || singleQuoted) {
      html += `<span style="color:#A5D6A7">${escapeHtml(token)}</span>`;
    } else if (numberLiteral) {
      html += `<span style="color:#FFB86C">${escapeHtml(token)}</span>`;
    } else if (identifier) {
      const lower = identifier.toLowerCase();
      const color = SCRIPT_KEYWORDS.has(lower)
        ? '#FF7B72'
        : SCRIPT_CONSTANTS.has(lower)
          ? '#79C0FF'
          : lower.startsWith('ta.') || SCRIPT_FUNCTIONS.has(lower)
            ? '#D2A8FF'
            : '#E6EDF3';
      html += `<span style="color:${color}">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }
    lastIndex = match.index + token.length;
  }

  html += escapeHtml(codePart.slice(lastIndex));
  if (commentPart) html += `<span style="color:#6E7681">${escapeHtml(commentPart)}</span>`;
  return html || '&nbsp;';
}

function highlightSource(source: string): string {
  return source.split('\n').map((l) => `<div>${highlightLine(l)}</div>`).join('');
}

// ─── Docs data ────────────────────────────────────────────────────────────────

interface DocEntry {
  name: string;
  sig: string;
  desc: string;
}

const DOCS_SECTIONS: Array<{ title: string; items: DocEntry[] }> = [
  {
    title: 'Built-in Series',
    items: [
      { name: 'open', sig: 'open', desc: 'Current bar open price' },
      { name: 'high', sig: 'high', desc: 'Current bar high price' },
      { name: 'low', sig: 'low', desc: 'Current bar low price' },
      { name: 'close', sig: 'close', desc: 'Current bar close price' },
      { name: 'volume', sig: 'volume', desc: 'Current bar volume' },
      { name: 'hl2', sig: 'hl2', desc: '(high + low) / 2' },
      { name: 'hlc3', sig: 'hlc3', desc: '(high + low + close) / 3' },
      { name: 'ohlc4', sig: 'ohlc4', desc: '(open + high + low + close) / 4' },
      { name: 'bar_index', sig: 'bar_index', desc: 'Current bar index (0-based)' },
    ],
  },
  {
    title: 'History Reference',
    items: [
      { name: 'series[n]', sig: 'close[1]', desc: 'Value of series n bars ago. e.g. close[1] = previous close' },
    ],
  },
  {
    title: 'Moving Averages',
    items: [
      { name: 'sma()', sig: 'sma(source, length)', desc: 'Simple moving average' },
      { name: 'ema()', sig: 'ema(source, length)', desc: 'Exponential moving average' },
      { name: 'rma()', sig: 'rma(source, length)', desc: 'Wilder (RMA/SMMA) moving average' },
      { name: 'wma()', sig: 'wma(source, length)', desc: 'Weighted moving average' },
      { name: 'vwma()', sig: 'vwma(source, length)', desc: 'Volume-weighted moving average' },
      { name: 'vwap()', sig: 'vwap(source)', desc: 'Volume-weighted average price' },
    ],
  },
  {
    title: 'Indicators',
    items: [
      { name: 'rsi()', sig: 'rsi(source, length)', desc: 'Relative Strength Index (0–100)' },
      { name: 'atr()', sig: 'atr(length)', desc: 'Average True Range' },
      { name: 'macd()', sig: 'macd(source, fast, slow, signal)', desc: 'Returns [macdLine, signalLine, histogram]' },
      { name: 'stdev()', sig: 'stdev(source, length)', desc: 'Standard deviation' },
      { name: 'cci()', sig: 'cci(source, length)', desc: 'Commodity Channel Index' },
      { name: 'mfi()', sig: 'mfi(source, length)', desc: 'Money Flow Index (0–100)' },
      { name: 'obv()', sig: 'obv()', desc: 'On-Balance Volume' },
      { name: 'supertrend()', sig: 'supertrend(factor, atrLen)', desc: 'Supertrend — returns [line, direction]' },
    ],
  },
  {
    title: 'Math & Utility',
    items: [
      { name: 'sum()', sig: 'sum(source, length)', desc: 'Rolling sum over length bars' },
      { name: 'highest()', sig: 'highest(source, length)', desc: 'Highest value over length bars' },
      { name: 'lowest()', sig: 'lowest(source, length)', desc: 'Lowest value over length bars' },
      { name: 'abs()', sig: 'abs(x)', desc: 'Absolute value' },
      { name: 'max()', sig: 'max(a, b)', desc: 'Larger of two values' },
      { name: 'min()', sig: 'min(a, b)', desc: 'Smaller of two values' },
      { name: 'round()', sig: 'round(x)', desc: 'Round to nearest integer' },
      { name: 'floor()', sig: 'floor(x)', desc: 'Floor' },
      { name: 'ceil()', sig: 'ceil(x)', desc: 'Ceiling' },
      { name: 'sqrt()', sig: 'sqrt(x)', desc: 'Square root' },
      { name: 'pow()', sig: 'pow(base, exp)', desc: 'Exponentiation' },
      { name: 'log()', sig: 'log(x)', desc: 'Natural logarithm' },
      { name: 'nz()', sig: 'nz(x, replacement?)', desc: 'Replace NaN/null with 0 or replacement value' },
    ],
  },
  {
    title: 'Crossover / Crossunder',
    items: [
      { name: 'crossover()', sig: 'crossover(a, b)', desc: 'True when a crosses above b this bar' },
      { name: 'crossunder()', sig: 'crossunder(a, b)', desc: 'True when a crosses below b this bar' },
    ],
  },
  {
    title: 'Outputs',
    items: [
      { name: 'plot()', sig: 'plot(series, title?, color?, linewidth?)', desc: 'Plots a line on the chart' },
      { name: 'plotshape()', sig: 'plotshape(series, style?, location?, color?, text?, title?)', desc: 'Plots shapes at signal points. style=shape.triangleup → BUY, shape.triangledown → SELL' },
      { name: 'hline()', sig: 'hline(price, title?, color?, style?, linewidth?)', desc: 'Draws a horizontal line at a fixed price level' },
    ],
  },
  {
    title: 'Inputs',
    items: [
      { name: 'input()', sig: 'input(defval, title?)', desc: 'Declares a numeric input parameter' },
      { name: 'input.int()', sig: 'input.int(defval, title?, minval?, maxval?)', desc: 'Integer input' },
      { name: 'input.float()', sig: 'input.float(defval, title?, minval?, maxval?)', desc: 'Float input' },
    ],
  },
  {
    title: 'Shape & Location Constants',
    items: [
      { name: 'shape.triangleup', sig: 'shape.triangleup', desc: 'Triangle pointing up — used for BUY signals' },
      { name: 'shape.triangledown', sig: 'shape.triangledown', desc: 'Triangle pointing down — used for SELL signals' },
      { name: 'shape.circle', sig: 'shape.circle', desc: 'Circle marker' },
      { name: 'shape.cross', sig: 'shape.cross', desc: 'Cross / X marker' },
      { name: 'location.belowbar', sig: 'location.belowbar', desc: 'Below the bar (default for buy markers)' },
      { name: 'location.abovebar', sig: 'location.abovebar', desc: 'Above the bar (default for sell markers)' },
      { name: 'location.high', sig: 'location.high', desc: 'At the high of the bar' },
      { name: 'location.low', sig: 'location.low', desc: 'At the low of the bar' },
    ],
  },
  {
    title: 'Control Flow',
    items: [
      { name: 'if / else', sig: 'if condition\n    expr\nelse\n    expr', desc: 'Indentation-sensitive conditional. Two spaces per level.' },
      { name: 'for', sig: 'for i = 0 to n\n    expr', desc: 'Loop from start to end (inclusive)' },
    ],
  },
];

// ─── LLM Prompt generator ─────────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are an expert in the DailyIQ scripting DSL — a Pine Script-inspired language for writing trading strategies. Your job is to write scripts that the user can paste directly into the DailyIQ Simulations script editor and run immediately.

## Key rules
- Indentation is SIGNIFICANT (use 4 spaces per level — NOT tabs)
- Signals are emitted via plotshape():
  - BUY:  plotshape(condition, style=shape.triangleup,   location=location.belowbar, color=#00C853, text="BUY")
  - SELL: plotshape(condition, style=shape.triangledown, location=location.abovebar,  color=#FF3D71, text="SELL")
- The simulation engine reads triangleup shapes as BUY and triangledown shapes as SELL — NO other mechanism triggers trades
- Declare inputs with: input length = 14
- Use comments with //
- bar_index is available as a 0-based integer
- History access: close[1] = previous close, close[n] = n bars ago
- na / NaN values are OK — the engine handles them gracefully

## Available functions
sma(src, len), ema(src, len), rma(src, len), wma(src, len), vwma(src, len), vwap(src)
rsi(src, len), atr(len), macd(src, fast, slow, signal), stdev(src, len)
cci(src, len), mfi(src, len), obv(), supertrend(factor, atrLen)
sum(src, len), highest(src, len), lowest(src, len)
crossover(a, b), crossunder(a, b)
abs(x), max(a,b), min(a,b), round(x), floor(x), ceil(x), sqrt(x), pow(a,b), log(x), nz(x)
plot(series, title?, color?, linewidth?)
hline(price, title?, color?)

## Example — EMA crossover strategy
\`\`\`
input fast_len = 9
input slow_len = 21

fast = ema(close, fast_len)
slow = ema(close, slow_len)

plot(fast, title="Fast EMA", color=#1A56DB)
plot(slow, title="Slow EMA", color=#F59E0B)

if crossover(fast, slow)
    plotshape(close, style=shape.triangleup, location=location.belowbar, color=#00C853, text="BUY")
if crossunder(fast, slow)
    plotshape(close, style=shape.triangledown, location=location.abovebar, color=#FF3D71, text="SELL")
\`\`\`

Now write a strategy for the user's request below. Return only the script — no markdown fences, no explanation unless asked.`;

// ─── Component ────────────────────────────────────────────────────────────────

type PanelTab = 'script' | 'docs' | 'prompt';

export default function SimScriptPanel({
  open,
  onClose,
  width = 340,
  source,
  onSourceChange,
  onRun,
  errors = [],
}: SimScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<PanelTab>('script');
  const [copied, setCopied] = useState(false);
  const [docsSearch, setDocsSearch] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const highlighted = useMemo(() => highlightSource(source), [source]);
  const lineCount = source.split('\n').length;

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onRun(source);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = source.substring(0, start) + '    ' + source.substring(end);
        onSourceChange(next);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
      }
    },
    [source, onRun, onSourceChange],
  );

  const handleCopyPrompt = useCallback(() => {
    navigator.clipboard.writeText(LLM_SYSTEM_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // Filter docs by search
  const filteredDocs = useMemo(() => {
    if (!docsSearch.trim()) return DOCS_SECTIONS;
    const q = docsSearch.toLowerCase();
    return DOCS_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.sig.toLowerCase().includes(q) ||
          item.desc.toLowerCase().includes(q),
      ),
    })).filter((s) => s.items.length > 0);
  }, [docsSearch]);

  if (!open) return null;

  const TAB_STYLE = (t: PanelTab) => ({
    height: 32,
    padding: '0 12px',
    fontSize: 10,
    fontFamily: "'JetBrains Mono', monospace",
    color: activeTab === t ? '#E6EDF3' : '#484F58',
    backgroundColor: activeTab === t ? '#161B22' : 'transparent',
    borderBottom: `2px solid ${activeTab === t ? '#8B5CF6' : 'transparent'}`,
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid' as const,
    borderBottomColor: activeTab === t ? '#8B5CF6' : 'transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    transition: 'color 120ms ease-out',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  });

  return (
    <div
      className="flex flex-col border-l"
      style={{ width, height: '100%', backgroundColor: '#161B22', borderColor: '#21262D', flexShrink: 0 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3"
        style={{ height: 36, borderBottom: '1px solid #21262D', backgroundColor: '#161B22', flexShrink: 0 }}
      >
        <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#8B5CF6' }}>
          Script
        </span>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span style={{ fontSize: 9, color: '#484F58' }}>Ctrl+Enter to run</span>
          <button
            onClick={onClose}
            style={{ color: '#484F58', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#E6EDF3')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#484F58')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center"
        style={{ height: 32, borderBottom: '1px solid #21262D', backgroundColor: '#0D1117', flexShrink: 0 }}
      >
        <button style={TAB_STYLE('script')} onClick={() => setActiveTab('script')}>
          <Code2 size={10} />
          Script
        </button>
        <button style={TAB_STYLE('docs')} onClick={() => setActiveTab('docs')}>
          <BookOpen size={10} />
          Docs
        </button>
        <button style={TAB_STYLE('prompt')} onClick={() => setActiveTab('prompt')}>
          <Sparkles size={10} />
          AI Prompt
        </button>
      </div>

      {/* ── Script tab ── */}
      {activeTab === 'script' && (
        <>
          {/* Action bar */}
          <div
            className="flex items-center"
            style={{ height: 32, padding: '0 8px', gap: 4, borderBottom: '1px solid #21262D', backgroundColor: '#161B22', flexShrink: 0 }}
          >
            <button
              onClick={() => onRun(source)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 10px', fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#E6EDF3', backgroundColor: '#8B5CF6',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                transition: 'opacity 120ms ease-out',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <Play size={9} />
              Run Sim
            </button>
            {source.trim() === '' && (
              <span style={{ fontSize: 9, color: '#484F58', marginLeft: 4 }}>
                Paste a script, then Run Sim
              </span>
            )}
          </div>

          {/* Editor */}
          <div className="flex" style={{ flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: '#0D1117' }}>
            {/* Line numbers */}
            <div
              ref={lineNumbersRef}
              style={{
                width: 36, paddingTop: 8, paddingBottom: 8, paddingRight: 8,
                textAlign: 'right', overflowY: 'hidden', userSelect: 'none',
                flexShrink: 0, backgroundColor: '#0D1117',
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    lineHeight: '20px',
                    color: errors.some((e) => e.line === i + 1) ? '#FF3D71' : '#484F58',
                  }}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Textarea + highlight overlay */}
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <pre
                ref={highlightRef}
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0, margin: 0,
                  backgroundColor: '#0D1117', color: '#E6EDF3',
                  fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: '20px', padding: '8px 8px 8px 0',
                  overflow: 'hidden', whiteSpace: 'pre', pointerEvents: 'none',
                }}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
              <textarea
                ref={textareaRef}
                value={source}
                onChange={(e) => onSourceChange(e.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                placeholder={"// Paste or write your strategy here\n// BUY:  plotshape(cond, style=shape.triangleup,   ...)\n// SELL: plotshape(cond, style=shape.triangledown, ...)"}
                className="scrollbar-dark"
                style={{
                  position: 'relative', zIndex: 1, flex: 1,
                  width: '100%', height: '100%',
                  backgroundColor: 'transparent',
                  color: source.trim() === '' ? '#484F58' : 'transparent',
                  caretColor: '#E6EDF3',
                  fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: '20px', padding: '8px 8px 8px 0',
                  outline: 'none', resize: 'none', border: 'none',
                  tabSize: 4, overflowY: 'auto', overflowX: 'auto',
                }}
              />
            </div>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div
              style={{ borderTop: '1px solid #21262D', backgroundColor: '#0D1117', flexShrink: 0, maxHeight: 88, overflowY: 'auto' }}
              className="scrollbar-dark"
            >
              {errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-center"
                  style={{ gap: 8, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", padding: '3px 8px' }}
                >
                  <span style={{ color: '#484F58' }}>Ln {err.line}</span>
                  <span style={{ color: '#FF3D71' }}>{err.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Docs tab ── */}
      {activeTab === 'docs' && (
        <div className="flex flex-col" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Search */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #21262D', flexShrink: 0, backgroundColor: '#161B22' }}>
            <input
              type="text"
              placeholder="Search functions…"
              value={docsSearch}
              onChange={(e) => setDocsSearch(e.target.value)}
              style={{
                width: '100%', height: 24,
                padding: '0 8px', fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                backgroundColor: '#0D1117', border: '1px solid #21262D',
                borderRadius: 4, color: '#E6EDF3', outline: 'none',
              }}
            />
          </div>

          {/* Sections */}
          <div className="scrollbar-dark" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}>
            {filteredDocs.map((section) => (
              <div key={section.title}>
                <div
                  style={{
                    padding: '6px 10px 3px',
                    fontSize: 9, fontFamily: "'JetBrains Mono', monospace",
                    color: '#484F58', letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}
                >
                  {section.title}
                </div>
                {section.items.map((item) => (
                  <div
                    key={item.name}
                    style={{ padding: '4px 10px 6px', borderBottom: '1px solid #21262D10' }}
                  >
                    <div
                      style={{
                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                        color: '#D2A8FF', marginBottom: 2,
                      }}
                    >
                      {item.sig}
                    </div>
                    <div
                      style={{
                        fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                        color: '#6E7681', lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {item.desc}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── AI Prompt tab ── */}
      {activeTab === 'prompt' && (
        <div className="flex flex-col" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Info */}
          <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #21262D', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#E6EDF3', marginBottom: 4 }}>
              LLM System Prompt
            </div>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#6E7681', lineHeight: 1.5 }}>
              Copy this into any LLM (ChatGPT, Claude, Gemini) as a system or first message, then describe the strategy you want. Paste the output back into the Script tab.
            </div>
          </div>

          {/* Copy button */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #21262D', flexShrink: 0, backgroundColor: '#161B22' }}>
            <button
              onClick={handleCopyPrompt}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                color: copied ? '#00C853' : '#E6EDF3',
                backgroundColor: copied ? 'rgba(0,200,83,0.08)' : '#1C2128',
                border: `1px solid ${copied ? '#00C853' : '#30363D'}`,
                borderRadius: 6, cursor: 'pointer',
                transition: 'all 120ms ease-out',
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy Prompt'}
            </button>
          </div>

          {/* Prompt preview */}
          <div
            className="scrollbar-dark"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}
          >
            <pre
              style={{
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                color: '#6E7681', lineHeight: 1.6, margin: 0,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {LLM_SYSTEM_PROMPT}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
