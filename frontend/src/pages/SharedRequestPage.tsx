import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bookmark, Check, LogIn, Copy, ChevronRight } from 'lucide-react';
import { requestsApi, mocksApi } from '../api/client';
import { useStore } from '../store/useStore';
import type { SharedRequest } from '../types';
import { getStatusColor, getMethodColor, parseJson } from '../types';
import JsonViewer, { HeadersTable } from '../components/JsonViewer';
import { copyToClipboard } from '../utils/clipboard';

export default function SharedRequestPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const user = useStore((s) => s.user);

  const [log, setLog] = useState<SharedRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Save as mock state
  const [showSaveMock, setShowSaveMock] = useState(false);
  const [mockName, setMockName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    requestsApi.getShared(token)
      .then(setLog)
      .catch(() => setError('Shared request not found or link has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSaveMock = async () => {
    if (!token || !mockName.trim()) return;
    setSaving(true);
    try {
      await mocksApi.fromShared(token, mockName.trim());
      setSaveSuccess(true);
      setShowSaveMock(false);
      setMockName('');
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-400">
        <p className="text-2xl mb-2">404</p>
        <p className="text-sm">{error || 'Not found'}</p>
      </div>
    );
  }

  const statusColor = getStatusColor(log.response_status);
  const methodColor = getMethodColor(log.method);
  const requestHeaders = parseJson(log.request_headers) as Record<string, string> || {};
  const responseHeaders = parseJson(log.response_headers) as Record<string, string> || {};
  let queryParams: Array<[string, string]> = [];
  try {
    queryParams = Array.from(new URL(log.url).searchParams.entries());
  } catch {
    // The URL is already shown above; invalid URLs simply have no parsed parameters.
  }

  const handleCopyCurl = async () => {
    if (await copyToClipboard(log.curl)) {
      setCurlCopied(true);
      setTimeout(() => setCurlCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <span className="text-xl font-bold text-cyan-400">ProxyFlow</span>
          <span className="text-slate-600">·</span>
          <span className="text-sm text-slate-400">Shared Request</span>
        </div>
        <p className="text-xs text-slate-600 mb-6">{new Date(log.created_at).toLocaleString()}</p>

        {/* Request summary + action bar */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${methodColor}`}>
              {log.method}
            </span>
            {log.response_status && (
              <span className={`text-sm font-bold font-mono status-${statusColor}`}>
                {log.response_status}
              </span>
            )}
            {log.duration_ms !== null && (
              <span className="text-xs text-slate-400">{log.duration_ms}ms</span>
            )}
            {log.is_mocked === 1 && (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-400">
                MOCKED
              </span>
            )}
            <div className="flex-1" />
            {saveSuccess && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <Check size={12} /> Saved to Mocks!
              </span>
            )}
            {user ? (
              <button
                onClick={() => setShowSaveMock(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-medium transition-colors"
              >
                <Bookmark size={12} />
                转换为 Mock
              </button>
            ) : (
              <button
                onClick={() => navigate('/login', { state: { from: window.location.pathname } })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-medium transition-colors"
              >
                <LogIn size={12} />
                登录后转换为 Mock
              </button>
            )}
          </div>
          <p className="text-sm font-mono text-slate-300 break-all">{log.url}</p>
        </div>

        {/* Save mock inline form */}
        {showSaveMock && (
          <div className="mb-4 p-3 bg-slate-800 border border-slate-700 rounded-xl">
            <p className="text-xs font-medium text-slate-200 mb-2">保存为 Mock 规则</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="规则名称，例如：Get User API"
                value={mockName}
                onChange={(e) => setMockName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveMock()}
                className="flex-1 bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-600"
                autoFocus
              />
              <button
                onClick={handleSaveMock}
                disabled={saving || !mockName.trim()}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => { setShowSaveMock(false); setMockName(''); }}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {queryParams.length > 0 && (
            <Section title={`Request Parameters (${queryParams.length})`}>
              <div className="overflow-hidden rounded-lg border border-slate-700/70">
                {queryParams.map(([key, value], index) => (
                  <div
                    key={`${key}-${index}`}
                    className="grid grid-cols-[minmax(120px,1fr)_2fr] border-b border-slate-700/70 last:border-b-0 text-xs font-mono"
                  >
                    <span className="px-3 py-2 text-cyan-400 bg-slate-900/40 break-all">{key}</span>
                    <span className="px-3 py-2 text-slate-300 break-all">{value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section title="Replay with cURL">
            <div className="relative rounded-lg border border-slate-700 bg-slate-950/70 p-3 pr-24">
              <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">{log.curl}</pre>
              <button
                onClick={handleCopyCurl}
                className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-600"
              >
                {curlCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {curlCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </Section>
          <Section title="Response Headers" defaultCollapsed>
            <HeadersTable headers={responseHeaders} />
          </Section>
          <Section title="Response Body">
            <JsonViewer data={parseJson(log.response_body) ?? log.response_body} maxHeight="500px" />
          </Section>
          <Section title="Request Headers" defaultCollapsed>
            <HeadersTable headers={requestHeaders} />
          </Section>
          {log.request_body && (
            <Section title="Request Body">
              <JsonViewer data={parseJson(log.request_body) ?? log.request_body} maxHeight="300px" />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, defaultCollapsed = false }: {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className={`flex w-full items-center gap-1 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-200 ${collapsed ? '' : 'mb-3'}`}
        aria-expanded={!collapsed}
      >
        <ChevronRight size={12} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        {title}
      </button>
      {!collapsed && children}
    </div>
  );
}
