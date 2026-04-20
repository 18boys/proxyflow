import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface JsonViewerProps {
  data: unknown;
  maxHeight?: string;
}

function collectPaths(value: unknown, path: string, result: string[]) {
  if (value !== null && typeof value === 'object') {
    result.push(path);
    if (Array.isArray(value)) {
      value.forEach((item, i) => collectPaths(item, `${path}.${i}`, result));
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) =>
        collectPaths(v, path ? `${path}.${k}` : k, result)
      );
    }
  }
}

interface NodeProps {
  value: unknown;
  path: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}

function JsonNode({ value, path, depth, collapsed, onToggle }: NodeProps) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'string') {
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return <span className="json-string">"{escaped}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>;
    const isCollapsed = collapsed.has(path);
    return (
      <>
        <button
          onClick={() => onToggle(path)}
          className="text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer select-none"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed
            ? <>[<span className="text-slate-500 px-0.5">{value.length}</span>]</>
            : '['}
        </button>
        {!isCollapsed && (
          <>
            {value.map((item, i) => (
              <div key={i} style={{ paddingLeft: 16 }}>
                <JsonNode
                  value={item}
                  path={`${path}.${i}`}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                />
                {i < value.length - 1 && <span className="text-slate-600">,</span>}
              </div>
            ))}
            <span className="text-slate-400">]</span>
          </>
        )}
      </>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-slate-400">{'{}'}</span>;
    const isCollapsed = collapsed.has(path);
    return (
      <>
        <button
          onClick={() => onToggle(path)}
          className="text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer select-none"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed
            ? <>{'{'}  <span className="text-slate-500 px-0.5">{entries.length}</span>{'}'}</>
            : '{'}
        </button>
        {!isCollapsed && (
          <>
            {entries.map(([key, val], i) => (
              <div key={key} style={{ paddingLeft: 16 }}>
                <span className="json-key">"{key}"</span>
                <span className="text-slate-500">: </span>
                <JsonNode
                  value={val}
                  path={path ? `${path}.${key}` : key}
                  depth={depth + 1}
                  collapsed={collapsed}
                  onToggle={onToggle}
                />
                {i < entries.length - 1 && <span className="text-slate-600">,</span>}
              </div>
            ))}
            <span className="text-slate-400">{'}'}</span>
          </>
        )}
      </>
    );
  }

  return <span className="text-slate-400">{String(value)}</span>;
}

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'json-key' : 'json-string';
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

export default function JsonViewer({ data, maxHeight = '400px' }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const parsedData = typeof data === 'string'
    ? (() => { try { return JSON.parse(data); } catch { return data; } })()
    : data;

  const isJsonObject = parsedData !== null && typeof parsedData === 'object';

  const jsonStr = typeof data === 'string'
    ? (() => { try { return JSON.stringify(JSON.parse(data), null, 2); } catch { return data as string; } })()
    : JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    const success = await copyToClipboard(jsonStr);
    if (success) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const handleCollapseAll = useCallback(() => {
    const paths: string[] = [];
    collectPaths(parsedData, '', paths);
    setCollapsed(new Set(paths));
  }, [parsedData]);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleToggle = useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (data === null || data === undefined) {
    return <span className="text-slate-500 text-sm font-mono italic">— empty —</span>;
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1.5">
        {isJsonObject && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleCollapseAll}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Collapse All
            </button>
            <button
              onClick={handleExpandAll}
              className="px-2 py-0.5 text-[10px] rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            >
              Expand All
            </button>
          </div>
        )}
        <button
          onClick={handleCopy}
          className="ml-auto p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          title="Copy"
        >
          {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
        </button>
      </div>
      <div
        style={{ maxHeight, overflowY: 'auto' }}
        className="bg-slate-900/50 rounded-lg p-3 text-xs leading-5"
      >
        <style>{`
          .json-key { color: #93c5fd; }
          .json-string { color: #86efac; }
          .json-number { color: #fcd34d; }
          .json-bool { color: #f9a8d4; }
          .json-null { color: #94a3b8; }
        `}</style>
        {isJsonObject ? (
          <pre className="font-mono whitespace-pre-wrap break-words">
            <JsonNode
              value={parsedData}
              path=""
              depth={0}
              collapsed={collapsed}
              onToggle={handleToggle}
            />
          </pre>
        ) : (
          <pre
            className="whitespace-pre-wrap break-words font-mono"
            dangerouslySetInnerHTML={{ __html: syntaxHighlight(jsonStr) }}
          />
        )}
      </div>
    </div>
  );
}

interface HeadersTableProps {
  headers: Record<string, string>;
}

export function HeadersTable({ headers }: HeadersTableProps) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <span className="text-slate-500 text-sm italic">No headers</span>;
  }

  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-slate-800/50 last:border-0">
            <td className="py-1.5 pr-4 text-blue-300 whitespace-nowrap align-top w-2/5 break-all">{key}</td>
            <td className="py-1.5 text-slate-300 break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
