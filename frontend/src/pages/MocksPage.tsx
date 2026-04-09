import { useEffect, useState, useRef } from 'react';
import {
  Plus, Search, Download, Upload, Trash2, Edit2, Bot, Sparkles
} from 'lucide-react';
import type { MockRule } from '../types';
import { mocksApi, streamAiRequest } from '../api/client';
import MockEditor from '../components/MockEditor';

export default function MocksPage() {
  const [rules, setRules] = useState<MockRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<MockRule | null>(null);
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRules = async () => {
    try {
      const data = await mocksApi.list(search || undefined);
      setRules(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, [search]);

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this mock rule and all its versions?')) return;
    await mocksApi.delete(id);
    setRules(rules.filter((r) => r.id !== id));
  };

  const handleExport = async () => {
    const data = await mocksApi.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proxyflow-mocks.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const mocks = data.mocks || data;
      await mocksApi.import(Array.isArray(mocks) ? mocks : []);
      loadRules();
    } catch {
      alert('Invalid JSON file');
    }
    e.target.value = '';
  };

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/30">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Mock Data</h1>
          <p className="text-xs text-slate-500 mt-0.5">{rules.length} rules configured</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAiGenerate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm transition-colors"
          >
            <Sparkles size={14} />
            AI Generate
          </button>
          <button onClick={handleExport} className="btn-secondary text-sm flex items-center gap-1.5">
            <Download size={14} /> Export
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-sm flex items-center gap-1.5">
            <Upload size={14} /> Import
          </button>
          <button
            onClick={() => { setEditingRule(null); setShowEditor(true); }}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> New Rule
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-slate-800">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search by name or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field w-full pl-9 text-sm"
          />
        </div>
      </div>

      {/* Rules list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            <div className="text-4xl mb-3">📦</div>
            <p>No mock rules yet</p>
            <p className="text-sm mt-1">Create rules to intercept and mock API responses</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <MockRuleCard
                key={rule.id}
                rule={rule}
                onEdit={() => { setEditingRule(rule); setShowEditor(true); }}
                onDelete={() => handleDelete(rule.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Editor modal */}
      {showEditor && (
        <MockEditor
          rule={editingRule}
          onClose={() => setShowEditor(false)}
          onSaved={() => { setShowEditor(false); loadRules(); }}
        />
      )}

      {/* AI Generate Modal */}
      {showAiGenerate && (
        <AiGenerateModal
          onClose={() => setShowAiGenerate(false)}
          onGenerated={() => { setShowAiGenerate(false); loadRules(); }}
        />
      )}
    </div>
  );
}

function MockRuleCard({ rule, onEdit, onDelete }: {
  rule: MockRule;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card p-4 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-slate-200">{rule.name}</span>
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono ${
              rule.match_type === 'exact' ? 'bg-slate-700 text-slate-400' :
              rule.match_type === 'wildcard' ? 'bg-blue-500/20 text-blue-400' :
              'bg-purple-500/20 text-purple-400'
            }`}>
              {rule.match_type}
            </span>
            {rule.method && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-400 font-mono">
                {rule.method}
              </span>
            )}
            {rule.delay_ms > 0 && (
              <span className="text-xs text-amber-400">⏱ {rule.delay_ms}ms</span>
            )}
          </div>
          <p className="text-xs font-mono text-slate-400 truncate">{rule.url_pattern}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
            <span>{rule.version_count} version{rule.version_count !== 1 ? 's' : ''}</span>
            {rule.active_version && (
              <span className="text-emerald-400">
                Active: {rule.active_version.name}
              </span>
            )}
            {rule.condition_field_type && (
              <span className="text-amber-400">
                Cond: {rule.condition_field_type}.{rule.condition_field_key}={rule.condition_field_value}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface AiGenerateModalProps {
  onClose: () => void;
  onGenerated: () => void;
}

function AiGenerateModal({ onClose, onGenerated }: AiGenerateModalProps) {
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [loading, setLoading] = useState(false);
  const [scenarios, setScenarios] = useState<Array<{
    name: string;
    response_status: number;
    response_headers: Record<string, string>;
    response_body: string;
  }>>([]);
  const [rawOutput, setRawOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const handleGenerate = () => {
    if (!description.trim()) return;
    setLoading(true);
    setRawOutput('');
    setScenarios([]);
    setError(null);

    let fullText = '';
    cancelRef.current = streamAiRequest(
      '/ai/generate-mock',
      { description, url, method },
      (text) => {
        fullText += text;
        setRawOutput(fullText);
      },
      (final) => {
        const text = (final || fullText).trim();
        try {
          // Try to extract JSON array from the text
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            setScenarios(parsed);
          }
        } catch {
          setError('Could not parse AI response as JSON');
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
  };

  const handleSaveScenario = async (s: typeof scenarios[0]) => {
    if (!url) return;
    try {
      const rule = await mocksApi.create({ name: s.name, url_pattern: url, match_type: 'exact', method });
      await mocksApi.createVersion(rule.id, {
        name: s.name,
        response_status: s.response_status,
        response_headers: JSON.stringify(s.response_headers),
        response_body: typeof s.response_body === 'string' ? s.response_body : JSON.stringify(s.response_body),
      });
    } catch {
      // ignore
    }
  };

  const handleSaveAll = async () => {
    for (const s of scenarios) {
      await handleSaveScenario(s);
    }
    onGenerated();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-800">
          <Sparkles size={16} className="text-purple-400" />
          <h2 className="text-base font-semibold text-slate-100">AI Mock Generator</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-slate-700 text-slate-400">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">API Endpoint URL</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                className="input-field w-full text-sm font-mono" placeholder="/api/users/:id" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-field w-full text-sm">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Describe the API (what it does)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input-field w-full text-sm resize-none"
              placeholder="e.g. Returns user profile data including name, email, avatar, and account settings..."
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : <Bot size={15} />}
            Generate Mock Scenarios
          </button>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {loading && rawOutput && (
            <div className="text-xs font-mono text-slate-400 bg-slate-800/50 rounded-lg p-3 max-h-32 overflow-y-auto">
              {rawOutput}
            </div>
          )}

          {scenarios.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">
                Generated {scenarios.length} scenarios:
              </p>
              {scenarios.map((s, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-mono font-bold ${
                      s.response_status >= 200 && s.response_status < 300 ? 'text-emerald-400' : 'text-red-400'
                    }`}>{s.response_status}</span>
                    <span className="text-sm text-slate-200">{s.name}</span>
                  </div>
                  <pre className="text-xs font-mono text-slate-400 bg-slate-900 rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
                    {typeof s.response_body === 'string'
                      ? s.response_body.slice(0, 200)
                      : JSON.stringify(s.response_body, null, 2).slice(0, 200)}
                    {(typeof s.response_body === 'string' ? s.response_body : JSON.stringify(s.response_body)).length > 200 && '...'}
                  </pre>
                </div>
              ))}

              <button onClick={handleSaveAll} className="btn-primary w-full mt-2">
                Save All {scenarios.length} Scenarios
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
