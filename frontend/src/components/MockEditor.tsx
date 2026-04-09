import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Bot, AlertCircle, WrapText, Copy } from 'lucide-react';
import type { MockRule, MockVersion } from '../types';
import { mocksApi, streamAiRequest } from '../api/client';

interface MockEditorProps {
  rule?: MockRule | null;
  onClose: () => void;
  onSaved: () => void;
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
  const [newVersionName, setNewVersionName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule?.id) {
      mocksApi.listVersions(rule.id).then(setVersions).catch(console.error);
    }
  }, [rule?.id]);

  const handleSaveRule = async () => {
    if (!name.trim() || !urlPattern.trim()) {
      setError('Name and URL pattern are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (rule) {
        await mocksApi.update(rule.id, {
          name, url_pattern: urlPattern, match_type: matchType,
          method: method || undefined, delay_ms: delayMs,
          condition_field_type: condType || undefined,
          condition_field_key: condKey || undefined,
          condition_field_value: condValue || undefined,
        } as Partial<MockRule>);
        if (selectedVersionId && selectedVersionId !== rule.active_version_id) {
          await mocksApi.update(rule.id, { active_version_id: selectedVersionId } as Partial<MockRule>);
        }
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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-100">
            {rule ? 'Edit Mock Rule' : 'New Mock Rule'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
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
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Delay: <span className="text-cyan-400">{delayMs}ms</span>
              </label>
              <input
                type="range"
                min={0}
                max={5000}
                step={100}
                value={delayMs}
                onChange={(e) => setDelayMs(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                <span>0ms</span><span>5000ms</span>
              </div>
            </div>
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
                    onEdit={() => setEditingVersion(v)}
                    onCopy={async () => {
                      const copied = await mocksApi.createVersion(rule.id, {
                        name: `${v.name} Copy`,
                        response_status: v.response_status,
                        response_headers: v.response_headers,
                        response_body: v.response_body,
                      });
                      setVersions((prev) => [...prev, copied]);
                      setEditingVersion(copied);
                    }}
                    onDelete={async () => {
                      await mocksApi.deleteVersion(rule.id, v.id);
                      setVersions(versions.filter((x) => x.id !== v.id));
                    }}
                  />
                ))}
                <AddVersionRow
                  ruleId={rule.id}
                  onAdded={(v) => {
                    setVersions([...versions, v]);
                    setSelectedVersionId(v.id);
                  }}
                />
              </div>
            </div>
          )}
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
            {rule ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>

      {/* Version edit modal */}
      {editingVersion && rule && (
        <VersionEditModal
          version={editingVersion}
          ruleId={rule.id}
          onSaved={(updated) => {
            setVersions(versions.map((v) => v.id === updated.id ? updated : v));
            setEditingVersion(null);
          }}
          onClose={() => setEditingVersion(null)}
        />
      )}
    </div>
  );
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
      <button onClick={onDelete} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400">
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

// ── VersionEditModal ───────────────────────────────────────────────────────
interface VersionEditModalProps {
  version: MockVersion;
  ruleId: number;
  onSaved: (v: MockVersion) => void;
  onClose: () => void;
}

export function VersionEditModal({ version, ruleId, onSaved, onClose }: VersionEditModalProps) {
  const [name, setName] = useState(version.name);
  const [status, setStatus] = useState(version.response_status);
  const [headers, setHeaders] = useState(version.response_headers || '{}');
  const [body, setBody] = useState(version.response_body);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiCancelRef = useRef<(() => void) | null>(null);

  const validateBody = (str: string) => {
    if (!str.trim()) { setBodyError(null); return true; }
    try {
      JSON.parse(str);
      setBodyError(null);
      return true;
    } catch (e) {
      setBodyError((e as Error).message);
      return false;
    }
  };

  const handleBodyChange = (val: string) => {
    setBody(val);
    validateBody(val);
  };

  const handleFormatBody = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(body), null, 2);
      setBody(formatted);
      setBodyError(null);
    } catch {
      // already invalid, leave as-is
    }
  };

  const handleSave = async () => {
    if (bodyError) return;
    setSaving(true);
    try {
      const updated = await mocksApi.updateVersion(ruleId, version.id, {
        name, response_status: status, response_headers: headers, response_body: body,
      });
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleAiGenerate = () => {
    if (!aiDescription.trim()) return;
    setAiLoading(true);
    let generated = '';

    aiCancelRef.current = streamAiRequest(
      '/ai/generate-json',
      { description: aiDescription, context: `HTTP ${status} response for mock version ${name}` },
      (text) => { generated += text; },
      (fullText) => {
        const cleanText = (fullText || generated).trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
        setBody(cleanText);
        validateBody(cleanText);
        setAiLoading(false);
      },
      (err) => {
        console.error('AI error:', err);
        setAiLoading(false);
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-60 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-200">Edit Version</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-700 text-slate-400">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Name + Status */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Version Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-field w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Status Code</label>
              <input
                type="number" value={status}
                onChange={(e) => setStatus(Number(e.target.value))}
                className={`input-field w-full text-sm font-mono ${
                  status >= 200 && status < 300 ? 'text-emerald-400' :
                  status >= 400 ? 'text-red-400' : 'text-slate-200'
                }`}
              />
            </div>
          </div>

          {/* Response Headers */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Response Headers</label>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <HeadersEditor value={headers} onChange={setHeaders} />
            </div>
          </div>

          {/* Response Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-400">Response Body</label>
              <div className="flex items-center gap-2">
                {bodyError && (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle size={11} /> {bodyError.slice(0, 50)}
                  </span>
                )}
                <button
                  onClick={handleFormatBody}
                  title="Format JSON"
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-cyan-400 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-700"
                >
                  <WrapText size={11} /> Format
                </button>
              </div>
            </div>
            <textarea
              value={body}
              onChange={(e) => handleBodyChange(e.target.value)}
              rows={12}
              spellCheck={false}
              className={`w-full bg-slate-800 border text-slate-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-1 resize-y
                ${bodyError ? 'border-red-500/70 focus:ring-red-500' : 'border-slate-700 focus:ring-cyan-500'}`}
            />
          </div>

          {/* AI generate */}
          <div className="border border-slate-700 rounded-lg p-3 bg-slate-800/50">
            <p className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
              <Bot size={12} className="text-purple-400" /> AI Generate Body
            </p>
            <div className="flex gap-2">
              <input
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="Describe the response you want..."
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
                onKeyDown={(e) => e.key === 'Enter' && handleAiGenerate()}
              />
              <button
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

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-800">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving || !!bodyError} className="btn-primary text-sm flex items-center gap-2">
            {saving && <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />}
            Save Version
          </button>
        </div>
      </div>
    </div>
  );
}
