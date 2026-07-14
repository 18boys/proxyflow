import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Bot, AlertCircle, WrapText, Copy, ChevronRight } from 'lucide-react';
import type { MockRule, MockVersion } from '../types';
import { mocksApi, streamAiRequest } from '../api/client';
import JsonViewer from './JsonViewer';

interface MockEditorProps {
  rule?: MockRule | null;
  onClose: () => void;
  onSaved: () => void;
}

interface MockVersionDraft {
  name: string;
  response_status: number;
  response_headers: string;
  response_body: string;
}

function createVersionDraft(version: MockVersion): MockVersionDraft {
  return {
    name: version.name,
    response_status: version.response_status,
    response_headers: version.response_headers || '{}',
    response_body: version.response_body,
  };
}

function getBodyError(body: string): string | null {
  if (!body.trim()) return null;
  try {
    JSON.parse(body);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export default function MockEditor({ rule, onClose, onSaved }: MockEditorProps) {
  const [name, setName] = useState(rule?.name || '');
  const [urlPattern, setUrlPattern] = useState(rule?.url_pattern || '');
  const [matchType, setMatchType] = useState<'exact' | 'wildcard' | 'regex'>(rule?.match_type || 'exact');
  const [method, setMethod] = useState(rule?.method || '');
  const [delayMs, setDelayMs] = useState(rule?.delay_ms ?? 0);
  const [condType, setCondType] = useState(rule?.condition_field_type || '');
  const [condKey, setCondKey] = useState(rule?.condition_field_key || '');
  const [condValue, setCondValue] = useState(rule?.condition_field_value || '');

  // Versions
  const [versions, setVersions] = useState<MockVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(rule?.active_version_id || null);
  const [editingVersion, setEditingVersion] = useState<MockVersion | null>(null);
  const [versionDraft, setVersionDraft] = useState<MockVersionDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule?.id) {
      mocksApi.listVersions(rule.id).then((loadedVersions) => {
        setVersions(loadedVersions);
        const initialVersion = loadedVersions.find((version) => version.id === rule.active_version_id)
          ?? loadedVersions[0]
          ?? null;
        setEditingVersion(initialVersion);
        setVersionDraft(initialVersion ? createVersionDraft(initialVersion) : null);
      }).catch(console.error);
    }
  }, [rule?.active_version_id, rule?.id]);

  const editVersion = (version: MockVersion) => {
    setEditingVersion(version);
    setVersionDraft(createVersionDraft(version));
  };

  const handleSaveRule = async () => {
    if (!name.trim() || !urlPattern.trim()) {
      setError('Name and URL pattern are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (rule) {
        const tasks: Promise<unknown>[] = [mocksApi.update(rule.id, {
          name, url_pattern: urlPattern, match_type: matchType,
          method: method || undefined, delay_ms: delayMs,
          condition_field_type: condType || undefined,
          condition_field_key: condKey || undefined,
          condition_field_value: condValue || undefined,
        } as Partial<MockRule>)];
        if (selectedVersionId !== rule.active_version_id) {
          tasks.push(mocksApi.update(rule.id, { active_version_id: selectedVersionId } as Partial<MockRule>));
        }
        if (editingVersion && versionDraft) {
          const bodyError = getBodyError(versionDraft.response_body);
          if (bodyError) {
            setError(`Response Body JSON is invalid: ${bodyError}`);
            setSaving(false);
            return;
          }
          tasks.push(mocksApi.updateVersion(rule.id, editingVersion.id, versionDraft));
        }
        await Promise.all(tasks);
      } else {
        await mocksApi.create({
          name, url_pattern: urlPattern, match_type: matchType,
          method: method || undefined, delay_ms: delayMs,
          condition_field_type: condType || undefined,
          condition_field_key: condKey || undefined,
          condition_field_value: condValue || undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-[1440px] h-[calc(100vh-2rem)] max-h-[1000px] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-100">
            {rule ? 'Edit Mock Rule' : 'New Mock Rule'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="overflow-y-auto px-6 py-4 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-800">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* Rule config */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">Rule Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field w-full text-sm"
                placeholder="e.g. Get User Profile"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">URL Pattern</label>
              <input
                value={urlPattern}
                onChange={(e) => setUrlPattern(e.target.value)}
                className="input-field w-full text-sm font-mono"
                placeholder="/api/users/*"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Match Type</label>
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as 'exact' | 'wildcard' | 'regex')}
                className="input-field w-full text-sm"
              >
                <option value="exact">Exact</option>
                <option value="wildcard">Wildcard (*)</option>
                <option value="regex">Regex</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Method (optional)</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="">Any Method</option>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            {!rule?.id && <div className="col-span-2">
              <div className="flex items-center justify-between gap-3 mb-1">
                <label htmlFor="mock-delay" className="block text-xs font-medium text-slate-400">
                  Delay Response
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="mock-delay"
                    type="number"
                    min={0}
                    max={60000}
                    step={100}
                    value={delayMs}
                    onChange={(e) => setDelayMs(Math.min(60000, Math.max(0, Number(e.target.value) || 0)))}
                    className="input-field w-24 py-1 text-xs text-right font-mono"
                  />
                  <span className="text-xs text-slate-500">ms</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={60000}
                step={1}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                <span>立即返回</span><span>60 秒</span>
              </div>
            </div>}
          </div>

          {/* Condition mock */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">Condition Mock (optional)</p>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={condType}
                onChange={(e) => setCondType(e.target.value)}
                className="input-field text-sm"
              >
                <option value="">No Condition</option>
                <option value="header">Header Field</option>
                <option value="body">Body Field</option>
              </select>
              <input
                value={condKey}
                onChange={(e) => setCondKey(e.target.value)}
                placeholder="Field key"
                className="input-field text-sm"
                disabled={!condType}
              />
              <input
                value={condValue}
                onChange={(e) => setCondValue(e.target.value)}
                placeholder="Expected value"
                className="input-field text-sm"
                disabled={!condType}
              />
            </div>
          </div>

          {/* Versions (only for existing rules) */}
          {rule?.id && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Mock Versions</p>
              <div className="space-y-2">
                {versions.map((v) => (
                  <VersionRow
                    key={v.id}
                    version={v}
                    isActive={selectedVersionId === v.id}
                    onSelect={() => setSelectedVersionId(v.id)}
                    onEdit={() => editVersion(v)}
                    onCopy={async () => {
                      const copied = await mocksApi.createVersion(rule.id, {
                        name: `${v.name} Copy`,
                        response_status: v.response_status,
                        response_headers: v.response_headers,
                        response_body: v.response_body,
                      });
                      setVersions((prev) => [...prev, copied]);
                      editVersion(copied);
                    }}
                    onDelete={async () => {
                      if (!confirm(`Delete mock data “${v.name}”?`)) return;
                      await mocksApi.deleteVersion(rule.id, v.id);
                      setVersions((prev) => prev.filter((x) => x.id !== v.id));
                      if (selectedVersionId === v.id) setSelectedVersionId(null);
                      if (editingVersion?.id === v.id) {
                        const remaining = versions.filter((version) => version.id !== v.id);
                        const nextVersion = remaining[0] ?? null;
                        setEditingVersion(nextVersion);
                        setVersionDraft(nextVersion ? createVersionDraft(nextVersion) : null);
                      }
                    }}
                  />
                ))}
                <AddVersionRow
                  ruleId={rule.id}
                  onAdded={(v) => {
                    setVersions((currentVersions) => [...currentVersions, v]);
                    setSelectedVersionId(v.id);
                    editVersion(v);
                  }}
                />
              </div>
            </div>
          )}
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-4 bg-slate-950/30">
            {editingVersion && versionDraft ? (
              <MockVersionFields
                key={editingVersion.id}
                draft={versionDraft}
                onChange={setVersionDraft}
                delayMs={delayMs}
                onDelayChange={setDelayMs}
              />
            ) : (
              <div className="h-full min-h-64 flex items-center justify-center text-center text-slate-500">
                <div>
                  <div className="text-3xl mb-3">📄</div>
                  <p className="text-sm text-slate-400">No mock version selected</p>
                  <p className="text-xs mt-1">Add a version to edit Response Headers and Response Body here.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSaveRule}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {saving && <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />}
            {rule ? 'Save Mock' : 'Create Rule'}
          </button>
        </div>
      </div>

    </div>
  ), document.body);
}

function VersionRow({
  version, isActive, onSelect, onEdit, onCopy, onDelete
}: {
  version: MockVersion;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
      isActive ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-slate-700 bg-slate-800/50'
    }`}>
      <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
          ${isActive ? 'border-cyan-500 bg-cyan-500' : 'border-slate-600'}`}>
          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
        <span className="text-sm text-slate-200 truncate">{version.name}</span>
        <span className={`text-xs font-mono shrink-0 ${
          version.response_status >= 200 && version.response_status < 300 ? 'text-emerald-400' :
          version.response_status >= 400 ? 'text-red-400' : 'text-slate-400'
        }`}>{version.response_status}</span>
      </button>
      <button onClick={onEdit} className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-200 text-xs">Edit</button>
      <button onClick={onCopy} title="Duplicate version" className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-cyan-400">
        <Copy size={12} />
      </button>
      <button
        onClick={onDelete}
        aria-label={`Delete ${version.name}`}
        className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function AddVersionRow({ ruleId, onAdded }: { ruleId: number; onAdded: (v: MockVersion) => void }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      const v = await mocksApi.createVersion(ruleId, { name });
      onAdded(v);
      setName('');
      setShow(false);
    } finally {
      setAdding(false);
    }
  };

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition-colors"
      >
        <Plus size={13} /> Add Version
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Version name"
        className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
      />
      <button onClick={handleAdd} disabled={adding || !name.trim()} className="px-3 py-1.5 bg-cyan-600 text-white text-xs rounded">
        Add
      </button>
      <button onClick={() => setShow(false)} className="px-3 py-1.5 bg-slate-700 text-slate-300 text-xs rounded">
        Cancel
      </button>
    </div>
  );
}

// ── HeadersEditor ─────────────────────────────────────────────────────────
interface HeaderPair {
  key: string;
  value: string;
}

function parseHeaders(jsonStr: string): HeaderPair[] {
  try {
    const obj = JSON.parse(jsonStr || '{}');
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    }
  } catch {
    // ignore
  }
  return [];
}

function serializeHeaders(pairs: HeaderPair[]): string {
  const obj: Record<string, string> = {};
  for (const { key, value } of pairs) {
    if (key.trim()) obj[key.trim()] = value;
  }
  return JSON.stringify(obj);
}

function HeadersEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [pairs, setPairs] = useState<HeaderPair[]>(() => {
    const p = parseHeaders(value);
    return p.length > 0 ? p : [];
  });

  const update = (newPairs: HeaderPair[]) => {
    setPairs(newPairs);
    onChange(serializeHeaders(newPairs));
  };

  const addRow = () => update([...pairs, { key: '', value: '' }]);

  const removeRow = (i: number) => update(pairs.filter((_, idx) => idx !== i));

  const setKey = (i: number, key: string) => {
    const next = pairs.map((p, idx) => idx === i ? { ...p, key } : p);
    update(next);
  };

  const setValue = (i: number, val: string) => {
    const next = pairs.map((p, idx) => idx === i ? { ...p, value: val } : p);
    update(next);
  };

  return (
    <div className="space-y-1.5">
      {pairs.map((pair, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            value={pair.key}
            onChange={(e) => setKey(i, e.target.value)}
            placeholder="Header name"
            className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-0"
          />
          <span className="text-slate-600 text-xs shrink-0">:</span>
          <input
            value={pair.value}
            onChange={(e) => setValue(i, e.target.value)}
            placeholder="Value"
            className="flex-[2] bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-0"
          />
          <button
            onClick={() => removeRow(i)}
            className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400 transition-colors mt-1"
      >
        <Plus size={12} /> Add Header
      </button>
    </div>
  );
}

// ── Shared mock response editor ────────────────────────────────────────────
interface MockVersionFieldsProps {
  draft: MockVersionDraft;
  onChange: (draft: MockVersionDraft) => void;
  delayMs: number;
  onDelayChange: (delayMs: number) => void;
}

function MockVersionFields({ draft, onChange, delayMs, onDelayChange }: MockVersionFieldsProps) {
  const [headersCollapsed, setHeadersCollapsed] = useState(true);
  const [bodyView, setBodyView] = useState<'tree' | 'source'>(() => {
    try {
      const parsed = JSON.parse(draft.response_body);
      return parsed !== null && typeof parsed === 'object' ? 'tree' : 'source';
    } catch {
      return 'source';
    }
  });
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiCancelRef = useRef<(() => void) | null>(null);
  const bodyError = getBodyError(draft.response_body);

  const update = (values: Partial<MockVersionDraft>) => onChange({ ...draft, ...values });

  const handleFormatBody = () => {
    try {
      update({ response_body: JSON.stringify(JSON.parse(draft.response_body), null, 2) });
    } catch {
      // Invalid JSON stays in source mode so it can be corrected.
    }
  };

  const handleAiGenerate = () => {
    if (!aiDescription.trim()) return;
    setAiLoading(true);
    let generated = '';
    aiCancelRef.current = streamAiRequest(
      '/ai/generate-json',
      {
        description: aiDescription,
        context: `HTTP ${draft.response_status} response for mock version ${draft.name}`,
      },
      (text) => { generated += text; },
      (fullText) => {
        const cleanText = (fullText || generated).trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        update({ response_body: cleanText });
        try {
          const parsed = JSON.parse(cleanText);
          if (parsed !== null && typeof parsed === 'object') setBodyView('tree');
        } catch {
          setBodyView('source');
        }
        setAiLoading(false);
      },
      (error) => {
        console.error('AI error:', error);
        setAiLoading(false);
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Mock Response</h3>
          <p className="text-xs text-slate-500 mt-0.5">Header、响应体和延时在两个入口共用同一编辑器</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-slate-400 mb-1">Version Name</label>
          <input
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            className="input-field w-full text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Status Code</label>
          <input
            type="number"
            value={draft.response_status}
            onChange={(event) => update({ response_status: Number(event.target.value) })}
            className={`input-field w-full text-sm font-mono ${
              draft.response_status >= 200 && draft.response_status < 300 ? 'text-emerald-400' :
              draft.response_status >= 400 ? 'text-red-400' : 'text-slate-200'
            }`}
          />
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg p-3 bg-slate-800/30">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-xs font-medium text-slate-400">Delay Response</p>
            <p className="text-[10px] text-slate-600 mt-0.5">Applies to every version of this mock rule</p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={delayMs}
              onChange={(event) => onDelayChange(Math.min(60000, Math.max(0, Number(event.target.value) || 0)))}
              aria-label="Delay Response"
              className="input-field w-24 py-1 text-xs text-right font-mono"
            />
            <span className="text-xs text-slate-500">ms</span>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={60000}
          step={1}
          value={delayMs}
          onChange={(event) => onDelayChange(Number(event.target.value))}
          aria-label="Delay Response Slider"
          className="w-full accent-cyan-500"
        />
        <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
          <span>立即返回</span><span>60 秒</span>
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/30">
        <button
          type="button"
          onClick={() => setHeadersCollapsed((value) => !value)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-800/70 transition-colors"
          aria-expanded={!headersCollapsed}
        >
          <ChevronRight
            size={13}
            className={`text-slate-500 transition-transform ${headersCollapsed ? '' : 'rotate-90'}`}
          />
          <span className="text-xs font-medium text-slate-400">Response Headers</span>
          <span className="ml-auto text-[10px] text-slate-600">
            {parseHeaders(draft.response_headers).length} 项 · {headersCollapsed ? '点击编辑' : '点击折叠'}
          </span>
        </button>
        {!headersCollapsed && (
          <div className="border-t border-slate-700 p-3">
            <HeadersEditor
              value={draft.response_headers}
              onChange={(responseHeaders) => update({ response_headers: responseHeaders })}
            />
          </div>
        )}
      </div>

      <div className="min-h-[420px]">
        <div className="flex items-center justify-between gap-3 mb-2">
          <label className="text-xs font-medium text-slate-400">Response Body</label>
          <div className="flex items-center gap-1.5">
            {bodyError && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={11} /> {bodyError.slice(0, 50)}
              </span>
            )}
            <div className="flex rounded-md bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => setBodyView('tree')}
                disabled={!!bodyError}
                className={`px-2 py-1 text-[10px] rounded transition-colors disabled:opacity-40 ${
                  bodyView === 'tree' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                JSON Tree
              </button>
              <button
                type="button"
                onClick={() => setBodyView('source')}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  bodyView === 'source' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Source
              </button>
            </div>
            <button
              type="button"
              onClick={handleFormatBody}
              title="Format JSON"
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-700"
            >
              <WrapText size={11} /> Format
            </button>
          </div>
        </div>
        {bodyView === 'tree' && !bodyError ? (
          <div className="border border-slate-700 rounded-lg bg-slate-800/50 p-3 min-h-[390px]">
            <JsonViewer data={draft.response_body} maxHeight="50vh" />
          </div>
        ) : (
          <textarea
            value={draft.response_body}
            onChange={(event) => update({ response_body: event.target.value })}
            rows={20}
            spellCheck={false}
            aria-label="Response Body Source"
            className={`w-full min-h-[390px] bg-slate-800 border text-slate-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-1 resize-y ${
              bodyError ? 'border-red-500/70 focus:ring-red-500' : 'border-slate-700 focus:ring-cyan-500'
            }`}
          />
        )}
      </div>

      <div className="border border-slate-700 rounded-lg p-3 bg-slate-800/50">
        <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
          <Bot size={12} className="text-purple-400" /> AI Generate Body
        </p>
        <div className="flex gap-2">
          <input
            value={aiDescription}
            onChange={(event) => setAiDescription(event.target.value)}
            placeholder="Describe the response you want..."
            className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
            onKeyDown={(event) => event.key === 'Enter' && handleAiGenerate()}
          />
          <button
            type="button"
            onClick={handleAiGenerate}
            disabled={aiLoading || !aiDescription.trim()}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded disabled:opacity-50 flex items-center gap-1"
          >
            {aiLoading ? (
              <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
            ) : <Bot size={12} />}
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// ── VersionEditModal ───────────────────────────────────────────────────────
interface VersionEditModalProps {
  version: MockVersion;
  ruleId: number;
  initialDelayMs: number;
  onSaved: (v: MockVersion, delayMs: number) => void;
  onClose: () => void;
}

export function VersionEditModal({
  version, ruleId, initialDelayMs, onSaved, onClose,
}: VersionEditModalProps) {
  const [draft, setDraft] = useState<MockVersionDraft>(() => createVersionDraft(version));
  const [delayMs, setDelayMs] = useState(initialDelayMs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const bodyError = getBodyError(draft.response_body);
    if (bodyError) {
      setError(`Response Body JSON is invalid: ${bodyError}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [updated] = await Promise.all([
        mocksApi.updateVersion(ruleId, version.id, draft),
        delayMs !== initialDelayMs
          ? mocksApi.update(ruleId, { delay_ms: delayMs } as Partial<MockRule>)
          : Promise.resolve(),
      ]);
      onSaved(updated, delayMs);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl h-[calc(100vh-2rem)] max-h-[1000px] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Edit Mock Response</h3>
            <p className="text-xs text-slate-500 mt-0.5">{version.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <MockVersionFields
            draft={draft}
            onChange={setDraft}
            delayMs={delayMs}
            onDelayChange={setDelayMs}
          />
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !!getBodyError(draft.response_body)}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {saving && <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />}
            Save Mock
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
