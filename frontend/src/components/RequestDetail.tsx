import { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Bookmark, Clock, Pencil, X, ChevronRight, Share2, Trash2, RotateCw, Send, Plus, AlertCircle, WrapText } from 'lucide-react';
import type { MockFolder, RequestLog, MockRule, MockVersion } from '../types';
import { getStatusColor, getMethodColor, parseJson } from '../types';
import JsonViewer, { HeadersTable } from './JsonViewer';
import { requestsApi, mocksApi } from '../api/client';
import MockEditor from './MockEditor';
import { copyToClipboard } from '../utils/clipboard';

interface RequestDetailProps {
  requestId: number | null;
  onClose?: () => void;
}

type Tab = 'request' | 'response' | 'timing' | 'mock';

export default function RequestDetail({ requestId, onClose }: RequestDetailProps) {
  const [log, setLog] = useState<RequestLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('response');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [showSaveMock, setShowSaveMock] = useState(false);
  const [mockName, setMockName] = useState('');
  const [mockFolderId, setMockFolderId] = useState<number | null>(null);
  const [mockFolders, setMockFolders] = useState<MockFolder[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!requestId) {
      setLog(null);
      return;
    }
    setLoading(true);
    requestsApi.get(requestId)
      .then(setLog)
      .catch(() => setLog(null))
      .finally(() => setLoading(false));
  }, [requestId]);

  useEffect(() => {
    mocksApi.listFolders().then(setMockFolders).catch(() => setMockFolders([]));
  }, []);

  const handleShare = async () => {
    if (!requestId) return;
    try {
      const { share_token } = await requestsApi.share(requestId);
      const url = `${window.location.origin}/share/${share_token}`;
      const success = await copyToClipboard(url);
      if (success) {
        setShared(true);
        setTimeout(() => setShared(false), 2500);
      }
    } catch {
      // ignore
    }
  };

  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  const [showEditSend, setShowEditSend] = useState(false);

  const handleReplay = async () => {
    if (!log) return;
    setReplaying(true);
    setReplayMsg(null);
    try {
      const res = await requestsApi.replay(log.id);
      setReplayMsg(`Replayed: ${res.statusCode} (${res.durationMs}ms)`);
      setTimeout(() => setReplayMsg(null), 3000);
    } catch (err) {
      setReplayMsg(`Replay failed: ${err instanceof Error ? err.message : 'Error'}`);
      setTimeout(() => setReplayMsg(null), 4000);
    } finally {
      setReplaying(false);
    }
  };

  const handleCopyCurl = async () => {
    if (!requestId) return;
    try {
      const { curl } = await requestsApi.getCurl(requestId);
      const success = await copyToClipboard(curl);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  const handleSaveMock = async () => {
    if (!log || !mockName.trim()) return;
    setSaving(true);
    try {
      await mocksApi.fromRequest(log.id, mockName, '200 OK', mockFolderId);
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

  if (!requestId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
        <div className="text-4xl mb-3">👆</div>
        <p className="text-sm">Select a request to view details</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
        <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!log) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
        Request not found
      </div>
    );
  }

  const statusColor = getStatusColor(log.response_status);
  const methodColor = getMethodColor(log.method);
  const requestHeaders = parseJson(log.request_headers) as Record<string, string> || {};
  const responseHeaders = parseJson(log.response_headers) as Record<string, string> || {};

  const dateKey = Object.keys(responseHeaders).find(k => k.toLowerCase() === 'date');
  if (dateKey && responseHeaders[dateKey]) {
    try {
      const d = new Date(responseHeaders[dateKey]);
      if (!isNaN(d.getTime())) {
        responseHeaders[dateKey] = d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + ' (GMT+0800)';
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex flex-wrap items-center gap-2 mb-2">
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
          {replayMsg && (
            <span className="text-xs text-cyan-400 font-mono animate-fade-in">
              {replayMsg}
            </span>
          )}
          {saveSuccess && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <Check size={12} /> Saved!
            </span>
          )}
          <button
            onClick={handleReplay}
            disabled={replaying}
            title="Re-execute this exact request"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {replaying ? (
              <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
            ) : <RotateCw size={12} />}
            Replay
          </button>
          <button
            onClick={() => setShowEditSend(true)}
            title="Edit request parameters and send"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-medium transition-colors"
          >
            <Send size={12} />
            Edit & Send
          </button>
          <button
            onClick={() => setShowSaveMock(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs transition-colors"
          >
            <Bookmark size={12} />
            Save as Mock
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
          >
            {shared ? <Check size={12} className="text-green-400" /> : <Share2 size={12} />}
            {shared ? 'Link Copied!' : 'Share'}
          </button>
          <button
            onClick={handleCopyCurl}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'cURL'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors ml-1"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <p className="text-xs font-mono text-slate-300 break-all">{log.url}</p>
      </div>

      {/* Save Mock Dialog */}
      {showSaveMock && (
        <div className="mx-4 mt-3 p-3 bg-slate-800 border border-slate-700 rounded-lg">
          <p className="text-xs font-medium text-slate-200 mb-2">Save as Mock</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Rule name (e.g. Get User API)"
              value={mockName}
              onChange={(e) => setMockName(e.target.value)}
              className="min-w-56 flex-1 bg-slate-900 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-600"
              autoFocus
            />
            <select
              value={mockFolderId ?? ''}
              onChange={(event) => setMockFolderId(event.target.value ? Number(event.target.value) : null)}
              aria-label="Mock folder"
              className="bg-slate-900 border border-slate-600 text-slate-300 text-xs rounded px-2 py-1.5"
            >
              <option value="">Unfiled</option>
              {mockFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <button
              onClick={handleSaveMock}
              disabled={saving || !mockName.trim()}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveMock(false)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-800 px-4 pt-2">
        {(['response', 'request', 'timing'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-medium capitalize transition-colors border-b-2 mr-1
              ${activeTab === tab
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
          >
            {tab}
          </button>
        ))}
        <button
          onClick={() => setActiveTab('mock')}
          className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 mr-1 flex items-center gap-1.5
            ${activeTab === 'mock'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          Mock
          {log.is_mocked === 1 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'response' && (
          <>
            <Section title="Response Headers" defaultCollapsed>
              <HeadersTable headers={responseHeaders} />
            </Section>
            <Section title="Response Body">
              <JsonViewer data={parseJson(log.response_body) ?? log.response_body} />
            </Section>
          </>
        )}

        {activeTab === 'request' && (
          <>
            <Section title="Request Headers" defaultCollapsed>
              <HeadersTable headers={requestHeaders} />
            </Section>
            {log.request_body && (
              <Section title="Request Body">
                <JsonViewer data={parseJson(log.request_body) ?? log.request_body} />
              </Section>
            )}
          </>
        )}

        {activeTab === 'timing' && (
          <TimingPanel log={log} />
        )}

        {activeTab === 'mock' && (
          <MockTab log={log} />
        )}
      </div>

      {/* Edit & Send modal */}
      {showEditSend && log && (
        <EditSendModal
          initialLog={log}
          onClose={() => setShowEditSend(false)}
        />
      )}
    </div>
  );
}

// ── URL matching helper ────────────────────────────────────────────────────
function matchesRule(rule: MockRule, log: RequestLog): boolean {
  if (rule.method && log.method && rule.method !== log.method) return false;
  let path: string;
  try {
    path = new URL(log.url).pathname;
  } catch {
    path = log.url.split('?')[0];
  }
  let patternPath: string;
  try {
    patternPath = new URL(rule.url_pattern).pathname;
  } catch {
    patternPath = rule.url_pattern.split('?')[0];
  }
  if (rule.match_type === 'exact') {
    return path === patternPath;
  }
  if (rule.match_type === 'wildcard') {
    const regexStr = patternPath.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp(`^${regexStr}$`).test(path); } catch { return false; }
  }
  if (rule.match_type === 'regex') {
    try { return new RegExp(rule.url_pattern).test(path); } catch { return false; }
  }
  return false;
}

// ── MockTab ────────────────────────────────────────────────────────────────
function MockTab({ log }: { log: RequestLog }) {
  const [rules, setRules] = useState<MockRule[]>([]);
  const [versions, setVersions] = useState<Record<number, MockVersion[]>>({});
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState<number | null>(null); // versionId being operated
  // local state per rule: { activeVersionId, isActive }
  const [localState, setLocalState] = useState<Record<number, { vid: number | null; active: boolean }>>({});
  const [editingMock, setEditingMock] = useState<{
    rule: MockRule;
    versionId: number;
  } | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<number | null>(null);

  const loadMockData = useCallback(async () => {
    setLoading(true);
    setRules([]);
    setVersions({});
    setLocalState({});
    try {
      const allRules = await mocksApi.list();
      const matched = allRules.filter((rule) => matchesRule(rule, log));
      setRules(matched);
      const init: Record<number, { vid: number | null; active: boolean }> = {};
      matched.forEach((r) => { init[r.id] = { vid: r.active_version_id, active: !!r.is_active }; });
      setLocalState(init);
      const versionMap: Record<number, MockVersion[]> = {};
      await Promise.all(matched.map(async (rule) => {
        versionMap[rule.id] = await mocksApi.listVersions(rule.id);
      }));
      setVersions(versionMap);
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    void loadMockData();
  }, [loadMockData]);

  // Apply a version: enable this rule + disable all other matched rules
  const handleApply = async (ruleId: number, versionId: number) => {
    setOperating(versionId);
    try {
      // Disable all other active rules first
      const otherActiveRules = rules.filter((r) => r.id !== ruleId && localState[r.id]?.active);
      await Promise.all(otherActiveRules.map((r) =>
        mocksApi.update(r.id, { is_active: 0 } as Partial<MockRule>)
      ));
      // Enable this rule with the selected version
      await mocksApi.update(ruleId, { active_version_id: versionId, is_active: 1 } as Partial<MockRule>);
      // Update local state
      setLocalState((prev) => {
        const next = { ...prev };
        otherActiveRules.forEach((r) => { next[r.id] = { ...next[r.id], active: false }; });
        next[ruleId] = { vid: versionId, active: true };
        return next;
      });
    } finally {
      setOperating(null);
    }
  };

  const handleDeleteVersion = async (ruleId: number, versionId: number) => {
    const versionName = versions[ruleId]?.find((version) => version.id === versionId)?.name || 'this version';
    if (!confirm(`Delete mock data “${versionName}”? This cannot be undone.`)) return;
    setDeletingVersionId(versionId);
    try {
      const result = await mocksApi.deleteVersion(ruleId, versionId);
      setVersions((prev) => ({
        ...prev,
        [ruleId]: (prev[ruleId] || []).filter((v) => v.id !== versionId),
      }));
      setRules((prev) => prev.map((rule) => rule.id === ruleId
        ? { ...rule, ...result.rule, active_version: null }
        : rule
      ));
      setLocalState((prev) => {
        const rs = prev[ruleId];
        if (rs?.vid === versionId) {
          return { ...prev, [ruleId]: { vid: null, active: false } };
        }
        return prev;
      });
    } finally {
      setDeletingVersionId(null);
    }
  };

  // Deactivate a rule (toggle off)
  const handleDeactivate = async (ruleId: number) => {
    setOperating(localState[ruleId]?.vid ?? -1);
    try {
      await mocksApi.update(ruleId, { is_active: 0 } as Partial<MockRule>);
      setLocalState((prev) => ({ ...prev, [ruleId]: { ...prev[ruleId], active: false } }));
    } finally {
      setOperating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500">
        <div className="text-3xl mb-2">🎯</div>
        <p className="text-sm">No mock rules match this URL</p>
        <p className="text-xs mt-1 font-mono text-slate-600">
          {(() => { try { return new URL(log.url).pathname; } catch { return log.url; } })()}
        </p>
      </div>
    );
  }

  // Only one rule can be active at a time — the first active one is "in effect"
  const activeRuleId = rules.find((r) => localState[r.id]?.active)?.id ?? null;

  return (
    <div className="space-y-3">
      {log.is_mocked === 1 && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-400">
          <Check size={13} /> This request is currently being mocked
        </div>
      )}

      {rules.map((rule) => {
        const rs = localState[rule.id] ?? { vid: null, active: false };
        const isRuleActive = rs.active;
        const isEffective = rule.id === activeRuleId; // visually mark which rule is in effect

        return (
          <div key={rule.id} className={`border rounded-lg overflow-hidden transition-colors ${
            isEffective ? 'border-emerald-500/40' : 'border-slate-700'
          }`}>
            {/* Rule header */}
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${
              isEffective ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-800/60 border-slate-700'
            }`}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${isEffective ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              <span className="text-xs font-medium text-slate-200 flex-1 truncate">{rule.name}</span>
              {isEffective && (
                <span className="text-[10px] text-emerald-400 shrink-0">In Effect</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                rule.match_type === 'exact' ? 'bg-slate-700 text-slate-400' :
                rule.match_type === 'wildcard' ? 'bg-blue-500/20 text-blue-400' :
                'bg-purple-500/20 text-purple-400'
              }`}>{rule.match_type}</span>
              <span className="text-[10px] font-mono text-slate-500 shrink-0 max-w-32 truncate">{rule.url_pattern}</span>
            </div>

            {/* Versions */}
            <div className="p-2 space-y-1">
              {(versions[rule.id] || []).length === 0 ? (
                <p className="text-xs text-slate-600 px-2 py-1 italic">No versions configured</p>
              ) : (versions[rule.id] || []).map((v) => {
                const isVersionActive = isRuleActive && rs.vid === v.id;
                const isOperating = operating === v.id || (operating === -1 && rs.vid === v.id);
                return (
                  <div key={v.id} className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
                    isVersionActive
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'border-transparent hover:border-slate-700 hover:bg-slate-800/40'
                  }`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isVersionActive ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <span className="text-xs text-slate-300 flex-1 truncate">{v.name}</span>
                    <span className={`text-[10px] font-mono shrink-0 ${
                      v.response_status >= 200 && v.response_status < 300 ? 'text-emerald-400' :
                      v.response_status >= 400 ? 'text-red-400' : 'text-slate-400'
                    }`}>{v.response_status}</span>
                    <button
                      onClick={() => setEditingMock({
                        rule,
                        versionId: v.id,
                      })}
                      title="Edit mock data"
                      aria-label={`Edit ${v.name}`}
                      className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 transition-colors shrink-0 text-[10px]"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                    <button
                      onClick={() => handleDeleteVersion(rule.id, v.id)}
                      disabled={deletingVersionId === v.id}
                      title="Delete version"
                      aria-label={`Delete ${v.name}`}
                      className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors shrink-0 disabled:opacity-50 text-[10px]"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                    <button
                      onClick={() => isVersionActive ? handleDeactivate(rule.id) : handleApply(rule.id, v.id)}
                      disabled={isOperating}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors shrink-0 ${
                        isVersionActive
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400'
                          : 'bg-slate-700 hover:bg-cyan-600 text-slate-300 hover:text-white disabled:opacity-50'
                      }`}
                    >
                      {isOperating ? '...' : isVersionActive ? 'Active' : 'Apply'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Same full editor used by /mocks */}
      {editingMock && (
        <MockEditor
          rule={editingMock.rule}
          initialVersionId={editingMock.versionId}
          onSaved={async () => {
            await loadMockData();
            setEditingMock(null);
          }}
          onClose={() => setEditingMock(null)}
        />
      )}
    </div>
  );
}

interface EditSendModalProps {
  initialLog: RequestLog;
  onClose: () => void;
}

function EditSendModal({ initialLog, onClose }: EditSendModalProps) {
  const [method, setMethod] = useState(initialLog.method || 'GET');
  const [url, setUrl] = useState(initialLog.url || '');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>(() => {
    try {
      const parsed = typeof initialLog.request_headers === 'string'
        ? JSON.parse(initialLog.request_headers || '{}')
        : initialLog.request_headers || {};
      return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
    } catch {
      return [];
    }
  });
  const [body, setBody] = useState(initialLog.request_body || '');
  const [sending, setSending] = useState(false);
  const [responseResult, setResponseResult] = useState<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    durationMs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const headerObj: Record<string, string> = {};
      headers.forEach(({ key, value }) => {
        if (key.trim()) headerObj[key.trim()] = value;
      });

      const res = await requestsApi.sendCustom({
        url: url.trim(),
        method,
        headers: headerObj,
        body: body || null,
      });

      setResponseResult({
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body,
        durationMs: res.durationMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSending(false);
    }
  };

  const handleFormatJson = () => {
    try {
      setBody(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <Send size={16} className="text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">Edit & Send Request (编辑并发送请求)</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* URL & Method */}
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="input-field text-xs font-bold font-mono w-28 shrink-0"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/endpoint"
              className="input-field flex-1 text-xs font-mono"
            />
            <button
              onClick={handleSend}
              disabled={sending}
              className="btn-primary text-xs flex items-center gap-1.5 px-4 shrink-0"
            >
              {sending ? (
                <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              ) : <Send size={13} />}
              Send
            </button>
          </div>

          {/* Headers */}
          <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Request Headers</span>
              <button
                type="button"
                onClick={() => setHeaders([...headers, { key: '', value: '' }])}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <Plus size={11} /> Add Header
              </button>
            </div>
            {headers.map((h, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <input
                  value={h.key}
                  onChange={(e) => {
                    const next = [...headers];
                    next[idx].key = e.target.value;
                    setHeaders(next);
                  }}
                  placeholder="Header key"
                  className="input-field flex-1 text-xs font-mono py-1"
                />
                <span className="text-slate-600">:</span>
                <input
                  value={h.value}
                  onChange={(e) => {
                    const next = [...headers];
                    next[idx].value = e.target.value;
                    setHeaders(next);
                  }}
                  placeholder="Header value"
                  className="input-field flex-[2] text-xs font-mono py-1"
                />
                <button
                  type="button"
                  onClick={() => setHeaders(headers.filter((_, i) => i !== idx))}
                  className="p-1 text-slate-500 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          {/* Request Body */}
          {method !== 'GET' && method !== 'HEAD' && (
            <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Request Body</span>
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1"
                >
                  <WrapText size={11} /> Format JSON
                </button>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Request payload (JSON, text, etc.)..."
                className="input-field w-full text-xs font-mono resize-y"
              />
            </div>
          )}

          {/* Live Response Panel */}
          {responseResult && (
            <div className="border border-cyan-500/30 rounded-xl p-4 bg-slate-950/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">Response Result</span>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                    responseResult.statusCode >= 200 && responseResult.statusCode < 300 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                    responseResult.statusCode >= 400 ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-slate-300 bg-slate-700/50'
                  }`}>
                    {responseResult.statusCode}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {responseResult.durationMs}ms
                  </span>
                </div>
              </div>

              {/* Response body */}
              <div className="max-h-60 overflow-y-auto border border-slate-800 rounded-lg p-2 bg-slate-900">
                <JsonViewer data={responseResult.body} maxHeight="200px" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, defaultCollapsed = false }: { title: string; children: React.ReactNode; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-1 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 hover:text-slate-200 transition-colors w-full text-left"
      >
        <ChevronRight size={12} className={`transition-transform shrink-0 ${collapsed ? '' : 'rotate-90'}`} />
        {title}
      </button>
      {!collapsed && children}
    </div>
  );
}

function TimingPanel({ log }: { log: RequestLog }) {
  const total = log.duration_ms || 0;
  const ttfb = log.ttfb_ms || 0;
  const connect = log.connect_ms || 0;
  const dns = log.dns_ms || 0;
  const transfer = Math.max(0, total - ttfb);

  const bars = [
    { label: 'DNS Lookup', value: dns, color: 'bg-purple-500' },
    { label: 'TCP Connect', value: connect - dns, color: 'bg-blue-500' },
    { label: 'TTFB', value: ttfb - connect, color: 'bg-cyan-500' },
    { label: 'Transfer', value: transfer, color: 'bg-emerald-500' },
  ].filter((b) => b.value > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock size={14} className="text-cyan-400" />
        <span className="text-sm font-semibold text-slate-200">Total: {total}ms</span>
      </div>

      {total > 0 ? (
        <div>
          {/* Visual timeline */}
          <div className="w-full h-5 rounded overflow-hidden flex mb-3">
            {bars.map((bar) => (
              <div
                key={bar.label}
                className={`${bar.color} h-full`}
                style={{ width: `${(bar.value / total) * 100}%` }}
                title={`${bar.label}: ${bar.value}ms`}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="space-y-2">
            {bars.map((bar) => (
              <div key={bar.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-sm ${bar.color}`} />
                  <span className="text-slate-400">{bar.label}</span>
                </div>
                <span className="font-mono text-slate-300">{bar.value}ms</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 italic">No timing data available</p>
      )}

      <div className="pt-2 border-t border-slate-800 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">Time</span>
          <span className="font-mono text-slate-300">{new Date(log.created_at).toLocaleString()}</span>
        </div>
        {log.session_id && (
          <div className="flex justify-between">
            <span className="text-slate-500">Session</span>
            <span className="font-mono text-slate-300 text-[10px]">{log.session_id.slice(0, 8)}...</span>
          </div>
        )}
      </div>
    </div>
  );
}
