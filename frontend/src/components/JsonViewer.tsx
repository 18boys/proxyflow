import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface JsonViewerProps {
  data: unknown;
  maxHeight?: string;
}

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
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

  const jsonStr = typeof data === 'string'
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(data), null, 2);
        } catch {
          return data;
        }
      })()
    : JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    const success = await copyToClipboard(jsonStr);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (data === null || data === undefined) {
    return <span className="text-slate-500 text-sm font-mono italic">— empty —</span>;
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200"
        title="Copy"
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
      <div
        style={{ maxHeight, overflowY: 'auto' }}
        className="json-viewer-container bg-slate-900/50 rounded-lg p-3 text-xs leading-5"
      >
        <style>{`
          .json-key { color: #93c5fd; }
          .json-string { color: #86efac; }
          .json-number { color: #fcd34d; }
          .json-bool { color: #f9a8d4; }
          .json-null { color: #94a3b8; }
        `}</style>
        <pre
          className="whitespace-pre-wrap break-words font-mono"
          dangerouslySetInnerHTML={{ __html: syntaxHighlight(jsonStr) }}
        />
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
