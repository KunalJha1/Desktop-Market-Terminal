import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScriptResult, ScriptError } from '../types';
import { X, Play, Square, Plus, ChevronDown, ChevronUp, AlertTriangle, Circle } from 'lucide-react';

interface ScriptEditorProps {
  open: boolean;
  onClose: () => void;
  onRunScript: (id: string, source: string) => ScriptResult;
  onStopScript: (id: string) => void;
  onScriptsChange: (activeScripts: { id: string; source: string }[]) => void;
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

export default function ScriptEditor({
  open,
  onClose,
  onRunScript,
  onStopScript,
  onScriptsChange,
}: ScriptEditorProps) {
  const [scripts, setScripts] = useState<ScriptEntry[]>(() => [
    createScript('RSI Example', DEFAULT_SCRIPT),
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(scripts[0].id);
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const currentScript = scripts.find((s) => s.id === activeTabId) ?? scripts[0];

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
      updateScript(currentScript.id, { source: value });
    },
    [currentScript.id, updateScript],
  );

  const handleRun = useCallback(() => {
    const result = onRunScript(currentScript.id, currentScript.source);
    updateScript(currentScript.id, { active: true, errors: result.errors });
  }, [currentScript, onRunScript, updateScript]);

  const handleStop = useCallback(() => {
    onStopScript(currentScript.id);
    updateScript(currentScript.id, { active: false, errors: [] });
  }, [currentScript.id, onStopScript, updateScript]);

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
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
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
    [handleRun, currentScript.source, handleSourceChange],
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

  const lineCount = currentScript.source.split('\n').length;
  const hasErrors = currentScript.errors.length > 0;

  return (
    <div
      ref={panelRef}
      className="flex flex-col border-l"
      style={{
        width: 320,
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
          Scripts
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

      {/* Script tabs */}
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
        {currentScript.active ? (
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
        ) : (
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
        )}
        {currentScript.active && (
          <span
            className="flex items-center"
            style={{ gap: 4, fontSize: 9, color: '#00C853', marginLeft: 4 }}
          >
            <Circle size={6} fill="#00C853" stroke="none" />
            Active
          </span>
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
                color: currentScript.errors.some((e) => e.line === i + 1)
                  ? '#FF3D71'
                  : '#484F58',
              }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={currentScript.source}
          onChange={(e) => handleSourceChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          style={{
            flex: 1,
            backgroundColor: '#0D1117',
            color: '#E6EDF3',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: '20px',
            padding: '8px 8px 8px 0',
            outline: 'none',
            resize: 'none',
            border: 'none',
            tabSize: 2,
            overflowY: 'auto',
          }}
        />
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
              {currentScript.errors.length} error{currentScript.errors.length !== 1 ? 's' : ''}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex' }}>
              {errorsExpanded ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
            </span>
          </button>
          {errorsExpanded && (
            <div
              style={{
                maxHeight: 96,
                overflowY: 'auto',
                padding: '0 8px 8px',
              }}
            >
              {currentScript.errors.map((err, i) => (
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
