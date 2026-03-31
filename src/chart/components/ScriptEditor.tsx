import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ScriptResult, ScriptError } from '../types';
import type { PersistedChartScript } from '../../lib/chart-state';
import { X, Play, Square, Plus, ChevronDown, ChevronUp, AlertTriangle, Circle } from 'lucide-react';

interface ScriptEditorProps {
  open: boolean;
  onClose: () => void;
  onRunScript: (id: string, source: string) => ScriptResult;
  onStopScript: (id: string) => void;
  onScriptsChange: (activeScripts: { id: string; source: string }[]) => void;
  builtInViewer?: { name: string; source: string } | null;
  onBuiltInViewerChange?: (viewer: { name: string; source: string } | null) => void;
  width?: number;
  /** When set, loads this script into the editor (creates a tab if not already open) */
  scriptToLoad?: PersistedChartScript | null;
  /** Called when user clicks "Save to Library" on the current script */
  onSaveToLibrary?: (id: string, name: string, source: string) => void;
}

interface ScriptEntry {
  id: string;
  name: string;
  source: string;
  active: boolean;
  errors: ScriptError[];
}

const DEFAULT_SCRIPT = `// DailyIQ Script - Custom Indicator
input length = 14
input smooth = 3

delta = close - close[1]
gain = max(delta, 0)
loss = max(-delta, 0)
avg_gain = sma(gain, length)
avg_loss = sma(loss, length)
rs = avg_gain / avg_loss
my_rsi = 100 - (100 / (1 + rs))
result = sma(my_rsi, smooth)

plot(result, "Smoothed RSI", color=#1A56DB)
hline(70, color=#FF3D71, style=dashed)
hline(30, color=#00C853, style=dashed)`;

let nextId = 1;
function generateId(): string {
  return `script_${Date.now()}_${nextId++}`;
}

function createScript(name: string, source: string): ScriptEntry {
  return {
    id: generateId(),
    name,
    source,
    active: false,
    errors: [],
  };
}

const SCRIPT_KEYWORDS = new Set([
  'indicator', 'strategy', 'plot', 'plotshape', 'hline', 'fill',
  'input', 'if', 'else', 'for', 'while', 'return',
  'and', 'or', 'not', 'true', 'false', 'na',
  'color', 'style', 'overlay', 'title', 'format', 'precision', 'timeframe', 'timeframe_gaps',
]);

const SCRIPT_CONSTANTS = new Set([
  'open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4',
]);

const SCRIPT_FUNCTIONS = new Set([
  'sma', 'ema', 'rma', 'stdev', 'sum', 'highest', 'lowest', 'atr', 'rsi', 'mfi',
  'cci', 'obv', 'vwap', 'supertrend', 'crossover', 'crossunder',
  'round', 'floor', 'ceil', 'abs', 'sqrt', 'log', 'pow', 'max', 'min',
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightScriptLine(line: string): string {
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
          : lower.includes('.') || SCRIPT_FUNCTIONS.has(lower)
            ? '#D2A8FF'
            : '#E6EDF3';
      html += `<span style="color:${color}">${escapeHtml(token)}</span>`;
    } else {
      html += escapeHtml(token);
    }

    lastIndex = match.index + token.length;
  }

  html += escapeHtml(codePart.slice(lastIndex));
  if (commentPart) {
    html += `<span style="color:#6E7681">${escapeHtml(commentPart)}</span>`;
  }
  return html || '&nbsp;';
}

function highlightScriptSource(source: string): string {
  return source
    .split('\n')
    .map((line) => `<div>${highlightScriptLine(line)}</div>`)
    .join('');
}

export default function ScriptEditor({
  open,
  onClose,
  onRunScript,
  onStopScript,
  onScriptsChange,
  builtInViewer = null,
  onBuiltInViewerChange,
  width = 320,
  scriptToLoad = null,
  onSaveToLibrary,
}: ScriptEditorProps) {
  const [scripts, setScripts] = useState<ScriptEntry[]>(() => [
    createScript('RSI Example', DEFAULT_SCRIPT),
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(scripts[0].id);
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [savedFlash, setSavedFlash] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentScript = scripts.find((s) => s.id === activeTabId) ?? scripts[0];
  const isBuiltInView = builtInViewer !== null;
  const displayedName = builtInViewer?.name ?? currentScript.name;
  const displayedSource = builtInViewer?.source ?? currentScript.source;
  const displayedErrors = builtInViewer ? [] : currentScript.errors;
  const highlightedSource = useMemo(() => highlightScriptSource(displayedSource), [displayedSource]);

  // Notify parent when active scripts change
  const notifyScriptsChange = useCallback(
    (updatedScripts: ScriptEntry[]) => {
      const active = updatedScripts
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, source: s.source }));
      onScriptsChange(active);
    },
    [onScriptsChange],
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuId) return;
    const handler = () => setContextMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenuId]);

  // Load an external script into a tab when scriptToLoad changes
  useEffect(() => {
    if (!scriptToLoad) return;
    const tabName = scriptToLoad.name ?? 'Script';
    setScripts((prev) => {
      const existing = prev.find((s) => s.id === scriptToLoad.id);
      if (existing) {
        return prev.map((s) =>
          s.id === scriptToLoad.id
            ? { ...s, name: scriptToLoad.name ?? s.name, source: scriptToLoad.source }
            : s,
        );
      }
      return [...prev, createScript(tabName, scriptToLoad.source)].map(
        (s, _, arr) => (s === arr[arr.length - 1] ? { ...s, id: scriptToLoad.id } : s),
      );
    });
    setActiveTabId(scriptToLoad.id);
  }, [scriptToLoad]);

  const updateScript = useCallback(
    (id: string, patch: Partial<ScriptEntry>) => {
      setScripts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
        if ('active' in patch) notifyScriptsChange(next);
        return next;
      });
    },
    [notifyScriptsChange],
  );

  const handleSourceChange = useCallback(
    (value: string) => {
      if (isBuiltInView) return;
      updateScript(currentScript.id, { source: value });
    },
    [currentScript.id, isBuiltInView, updateScript],
  );

  const handleRun = useCallback(() => {
    if (isBuiltInView) return;
    const result = onRunScript(currentScript.id, currentScript.source);
    updateScript(currentScript.id, { active: true, errors: result.errors });
  }, [currentScript, isBuiltInView, onRunScript, updateScript]);

  const handleStop = useCallback(() => {
    if (isBuiltInView) return;
    onStopScript(currentScript.id);
    updateScript(currentScript.id, { active: false, errors: [] });
  }, [currentScript.id, isBuiltInView, onStopScript, updateScript]);

  const handleAddScript = useCallback(() => {
    const newScript = createScript(`Script ${scripts.length + 1}`, '// New script\n');
    setScripts((prev) => {
      const next = [...prev, newScript];
      return next;
    });
    setActiveTabId(newScript.id);
  }, [scripts.length]);

  const handleDeleteScript = useCallback(
    (id: string) => {
      setScripts((prev) => {
        if (prev.length <= 1) return prev; // keep at least one
        const target = prev.find((s) => s.id === id);
        if (target?.active) onStopScript(id);
        const next = prev.filter((s) => s.id !== id);
        if (activeTabId === id) {
          setActiveTabId(next[0].id);
        }
        notifyScriptsChange(next);
        return next;
      });
      setContextMenuId(null);
    },
    [activeTabId, notifyScriptsChange, onStopScript],
  );

  const handleTabContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenuId(id);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

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
        handleRun();
      }
      if (isBuiltInView) {
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newSource =
          currentScript.source.substring(0, start) + '  ' + currentScript.source.substring(end);
        handleSourceChange(newSource);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [handleRun, isBuiltInView, currentScript.source, handleSourceChange],
  );

  // Rename on double-click
  const handleTabDoubleClick = useCallback(
    (id: string) => {
      const name = window.prompt(
        'Rename script:',
        scripts.find((s) => s.id === id)?.name ?? '',
      );
      if (name !== null && name.trim() !== '') {
        updateScript(id, { name: name.trim() });
      }
    },
    [scripts, updateScript],
  );

  if (!open) return null;

  const lineCount = displayedSource.split('\n').length;
  const hasErrors = displayedErrors.length > 0;

  return (
    <div
      ref={panelRef}
      className="flex flex-col border-l"
      style={{
        width,
        height: '100%',
        backgroundColor: '#161B22',
        borderColor: '#21262D',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3"
        style={{
          height: 36,
          borderBottom: '1px solid #21262D',
          backgroundColor: '#161B22',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            color: '#8B5CF6',
          }}
        >
          {isBuiltInView ? `Built-in Script: ${displayedName}` : 'Scripts'}
        </span>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span style={{ fontSize: 9, color: '#484F58' }}>
            {isBuiltInView ? 'Read only' : 'Ctrl+Enter to run'}
          </span>
          <button
            onClick={() => {
              onBuiltInViewerChange?.(null);
              onClose();
            }}
            style={{ color: '#484F58', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#E6EDF3')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#484F58')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Script tabs */}
      {!isBuiltInView ? (
      <div
        className="flex items-center"
        style={{
          height: 32,
          borderBottom: '1px solid #21262D',
          backgroundColor: '#0D1117',
          overflowX: 'auto',
          overflowY: 'hidden',
          flexShrink: 0,
        }}
      >
        {scripts.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveTabId(s.id)}
            onContextMenu={(e) => handleTabContextMenu(e, s.id)}
            onDoubleClick={() => handleTabDoubleClick(s.id)}
            className="flex items-center"
            style={{
              height: 32,
              padding: '0 8px',
              gap: 6,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: s.id === activeTabId ? '#E6EDF3' : '#484F58',
              backgroundColor: s.id === activeTabId ? '#161B22' : 'transparent',
              borderBottom: s.id === activeTabId ? '2px solid #8B5CF6' : '2px solid transparent',
              border: 'none',
              borderBottomWidth: 2,
              borderBottomStyle: 'solid',
              borderBottomColor: s.id === activeTabId ? '#8B5CF6' : 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'color 120ms ease-out',
            }}
          >
            {s.active && (
              <Circle
                size={6}
                fill="#00C853"
                stroke="none"
              />
            )}
            <span>{s.name}</span>
            {scripts.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteScript(s.id);
                }}
                style={{
                  marginLeft: 2,
                  color: '#484F58',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#FF3D71')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#484F58')}
              >
                <X size={10} />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={handleAddScript}
          style={{
            height: 32,
            width: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#484F58',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'color 120ms ease-out',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#8B5CF6')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#484F58')}
        >
          <Plus size={12} />
        </button>
      </div>
      ) : (
        <div
          style={{
            height: 32,
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            borderBottom: '1px solid #21262D',
            backgroundColor: '#0D1117',
            fontSize: 10,
            fontFamily: "'JetBrains Mono', monospace",
            color: '#E6EDF3',
            flexShrink: 0,
          }}
        >
          {displayedName}
        </div>
      )}

      {/* Action bar */}
      <div
        className="flex items-center"
        style={{
          height: 32,
          padding: '0 8px',
          gap: 4,
          borderBottom: '1px solid #21262D',
          backgroundColor: '#161B22',
          flexShrink: 0,
        }}
      >
        {!isBuiltInView && currentScript.active ? (
          <button
            onClick={handleStop}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 10px',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#E6EDF3',
              backgroundColor: '#FF3D71',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'opacity 120ms ease-out',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <Square size={9} />
            Stop
          </button>
        ) : !isBuiltInView ? (
          <button
            onClick={handleRun}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 10px',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#E6EDF3',
              backgroundColor: '#8B5CF6',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'opacity 120ms ease-out',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <Play size={9} />
            Run
          </button>
        ) : (
          <span
            className="flex items-center"
            style={{ gap: 4, fontSize: 9, color: '#79C0FF', marginLeft: 4 }}
          >
            <Circle size={6} fill="#79C0FF" stroke="none" />
            Built-in source
          </span>
        )}
        {!isBuiltInView && currentScript.active && (
          <span
            className="flex items-center"
            style={{ gap: 4, fontSize: 9, color: '#00C853', marginLeft: 4 }}
          >
            <Circle size={6} fill="#00C853" stroke="none" />
            Active
          </span>
        )}
        {!isBuiltInView && onSaveToLibrary && (
          <button
            onClick={() => {
              onSaveToLibrary(currentScript.id, currentScript.name, currentScript.source);
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 1800);
            }}
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: savedFlash ? '#00C853' : '#8B949E',
              backgroundColor: savedFlash ? 'rgba(0,200,83,0.1)' : 'transparent',
              border: `1px solid ${savedFlash ? '#00C853' : '#30363D'}`,
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 120ms ease-out',
            }}
            title="Save this script to the Saved Scripts library"
          >
            {savedFlash ? '✓ Saved' : 'Save to Library'}
          </button>
        )}
      </div>

      {/* Editor area */}
      <div
        className="flex"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          backgroundColor: '#0D1117',
        }}
      >
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          style={{
            width: 36,
            paddingTop: 8,
            paddingBottom: 8,
            paddingRight: 8,
            textAlign: 'right',
            overflowY: 'hidden',
            userSelect: 'none',
            flexShrink: 0,
            backgroundColor: '#0D1117',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                lineHeight: '20px',
                color: displayedErrors.some((e) => e.line === i + 1)
                  ? '#FF3D71'
                  : '#484F58',
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <pre
            ref={highlightRef}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              backgroundColor: '#0D1117',
              color: '#E6EDF3',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: '20px',
              padding: '8px 8px 8px 0',
              overflow: 'hidden',
              whiteSpace: 'pre',
              pointerEvents: 'none',
            }}
            dangerouslySetInnerHTML={{ __html: highlightedSource }}
          />
          <textarea
            ref={textareaRef}
            value={displayedSource}
            onChange={(e) => handleSourceChange(e.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            readOnly={isBuiltInView}
            className="scrollbar-dark"
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              width: '100%',
              height: '100%',
              backgroundColor: 'transparent',
              color: 'transparent',
              caretColor: '#E6EDF3',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: '20px',
              padding: '8px 8px 8px 0',
              outline: 'none',
              resize: 'none',
              border: 'none',
              tabSize: 2,
              overflowY: 'auto',
              overflowX: 'auto',
            }}
          />
        </div>
      </div>

      {/* Error panel */}
      {hasErrors && (
        <div
          style={{
            borderTop: '1px solid #21262D',
            backgroundColor: '#0D1117',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setErrorsExpanded((p) => !p)}
            className="flex items-center"
            style={{
              width: '100%',
              padding: '4px 8px',
              gap: 4,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#FF3D71',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <AlertTriangle size={10} />
            <span>
              {displayedErrors.length} error{displayedErrors.length !== 1 ? 's' : ''}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex' }}>
              {errorsExpanded ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
            </span>
          </button>
          {errorsExpanded && (
            <div
              className="scrollbar-dark"
              style={{
                maxHeight: 96,
                overflowY: 'auto',
                padding: '0 8px 8px',
              }}
            >
              {displayedErrors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-center"
                  style={{
                    gap: 8,
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    padding: '2px 0',
                  }}
                >
                  <span style={{ color: '#484F58' }}>Ln {err.line}</span>
                  <span style={{ color: '#FF3D71' }}>{err.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Context menu for right-click delete */}
      {contextMenuId && (
        <div
          style={{
            position: 'fixed',
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            zIndex: 100,
            backgroundColor: '#161B22',
            border: '1px solid #21262D',
            borderRadius: 4,
            padding: 4,
          }}
        >
          <button
            onClick={() => handleDeleteScript(contextMenuId)}
            style={{
              display: 'block',
              width: '100%',
              padding: '4px 12px',
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: '#FF3D71',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              borderRadius: 2,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1C2128')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            Delete Script
          </button>
        </div>
      )}
    </div>
  );
}
