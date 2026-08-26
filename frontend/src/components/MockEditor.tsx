import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Bot, AlertCircle, WrapText, Copy, ChevronRight, Check, Sparkles, Clock } from 'lucide-react';
import type { MockFolder, MockRule, MockVersion } from '../types';
import { mocksApi, streamAiRequest } from '../api/client';
import JsonViewer from './JsonViewer';

interface MockEditorProps {
  rule?: MockRule | null;
  initialVersionId?: number;
  defaultFolderId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

interface MockVersionDraft {
  id?: number;
  name: string;
  response_status: number;
  response_headers: string;
  response_body: string;
  isModified?: boolean;
}

const COMMON_STATUS_CODES = [
  { code: 200, label: '200 OK', text: 'OK' },
  { code: 201, label: '201 Created', text: 'Created' },
  { code: 204, label: '204 No Content', text: 'No Content' },
  { code: 400, label: '400 Bad Request', text: 'Bad Request' },
  { code: 401, label: '401 Unauthorized', text: 'Unauthorized' },
  { code: 403, label: '403 Forbidden', text: 'Forbidden' },
  { code: 404, label: '404 Not Found', text: 'Not Found' },
  { code: 500, label: '500 Server Error', text: 'Internal Server Error' },
  { code: 502, label: '502 Bad Gateway', text: 'Bad Gateway' },
];

function getStatusBadgeStyle(status: number) {
  if (status >= 200 && status < 300) {
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  }
  if (status >= 300 && status < 400) {
    return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
  }
  if (status >= 400 && status < 500) {
    return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }
  if (status >= 500) {
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  }
  return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
}

function createVersionDraft(version: MockVersion): MockVersionDraft {
  return {
    id: version.id,
    name: version.name,
    response_status: version.response_status,
    response_headers: version.response_headers || '{\n  "Content-Type": "application/json"\n}',
    response_body: version.response_body || '{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}',
    isModified: false,
  };
}

const DEFAULT_NEW_VERSION_DRAFT: MockVersionDraft = {
  name: '200 OK',
  response_status: 200,
  response_headers: '{\n  "Content-Type": "application/json"\n}',
  response_body: '{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}',
  isModified: false,
};

function getBodyError(body: string): string | null {
  if (!body || !body.trim()) return null;
  try {
    JSON.parse(body);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export default function MockEditor({ rule, initialVersionId, defaultFolderId, onClose, onSaved }: MockEditorProps) {
  const [currentRule, setCurrentRule] = useState<MockRule | null>(rule || null);
  const [name, setName] = useState(rule?.name || '');
  const [urlPattern, setUrlPattern] = useState(rule?.url_pattern || '');
  const [matchType, setMatchType] = useState<'exact' | 'wildcard' | 'regex'>(rule?.match_type || 'exact');
  const [method, setMethod] = useState(rule?.method || '');
  const [folderId, setFolderId] = useState<number | null>(rule?.folder_id ?? defaultFolderId ?? null);
  const [folders, setFolders] = useState<MockFolder[]>([]);
  const [delayMs, setDelayMs] = useState(rule?.delay_ms ?? 0);
  const [condType, setCondType] = useState(rule?.condition_field_type || '');
  const [condKey, setCondKey] = useState(rule?.condition_field_key || '');
  const [condValue, setCondValue] = useState(rule?.condition_field_value || '');

  // Versions & Drafts
  const [versions, setVersions] = useState<MockVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(rule?.active_version_id || null);
  const [editingVersionId, setEditingVersionId] = useState<number | null>(null);
  const [draftsByVersionId, setDraftsByVersionId] = useState<Record<number, MockVersionDraft>>({});
  const [bodyView, setBodyView] = useState<'tree' | 'source'>('tree');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusCodeInputRef = useRef<HTMLInputElement>(null);
  const mockResponseSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mocksApi.listFolders().then(setFolders).catch(console.error);
  }, []);

  useEffect(() => {
    setCurrentRule(rule || null);
    if (rule?.id) {
      setName(rule.name || '');
      setUrlPattern(rule.url_pattern || '');
      setMatchType(rule.match_type || 'exact');
      setMethod(rule.method || '');
      setFolderId(rule.folder_id ?? defaultFolderId ?? null);
      setDelayMs(rule.delay_ms ?? 0);
      setCondType(rule.condition_field_type || '');
      setCondKey(rule.condition_field_key || '');
      setCondValue(rule.condition_field_value || '');
      setSelectedVersionId(rule.active_version_id || null);

      mocksApi.listVersions(rule.id).then((loadedVersions) => {
        setVersions(loadedVersions);
        const initialVersion = loadedVersions.find((v) => v.id === initialVersionId)
          ?? loadedVersions.find((v) => v.id === rule.active_version_id)
          ?? loadedVersions[0]
          ?? null;

        const initialDrafts: Record<number, MockVersionDraft> = {};
        loadedVersions.forEach((v) => {
          initialDrafts[v.id] = createVersionDraft(v);
        });
        setDraftsByVersionId(initialDrafts);

        if (initialVersion) {
          setEditingVersionId(initialVersion.id);
          setBodyView('tree');
        }
      }).catch(console.error);
    } else {
      // New mock rule: initialize with default draft for versionId = 0
      setDraftsByVersionId({ 0: { ...DEFAULT_NEW_VERSION_DRAFT } });
      setEditingVersionId(0);
      setBodyView('source');
    }
  }, [initialVersionId, rule?.active_version_id, rule?.id, defaultFolderId]);

  const updateCurrentDraft = (changes: Partial<MockVersionDraft>) => {
    if (editingVersionId === null) return;
    setDraftsByVersionId((prev) => {
      const current = prev[editingVersionId] || (
        editingVersionId === 0
          ? DEFAULT_NEW_VERSION_DRAFT
          : createVersionDraft(versions.find((v) => v.id === editingVersionId)!)
      );
      return {
        ...prev,
        [editingVersionId]: {
          ...current,
          ...changes,
          isModified: true,
        },
      };
    });
  };

  const handleSelectForEdit = (versionId: number, options?: { mode?: 'tree' | 'source'; focusStatusCode?: boolean }) => {
    setEditingVersionId(versionId);
    if (options?.mode) {
      setBodyView(options.mode);
    }

    // Make sure a draft exists in state
    setDraftsByVersionId((prev) => {
      if (prev[versionId]) return prev;
      const v = versions.find((item) => item.id === versionId);
      if (v) {
        return { ...prev, [versionId]: createVersionDraft(v) };
      }
      return prev;
    });

    if (options?.focusStatusCode) {
      setTimeout(() => {
        mockResponseSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        statusCodeInputRef.current?.focus();
        statusCodeInputRef.current?.select();
      }, 50);
    }
  };

  const handleSaveRule = async () => {
    if (!name.trim() || !urlPattern.trim()) {
      setError('Name and URL pattern are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (currentRule) {
        // Validate all modified version drafts
        for (const [vIdStr, draft] of Object.entries(draftsByVersionId)) {
          const vId = Number(vIdStr);
          if (draft.isModified || vId === editingVersionId) {
            const bodyError = getBodyError(draft.response_body);
            if (bodyError) {
              setError(`Version "${draft.name}" response body JSON is invalid: ${bodyError}`);
              setSaving(false);
              return;
            }
          }
        }

        const tasks: Promise<unknown>[] = [
          mocksApi.update(currentRule.id, {
            name,
            url_pattern: urlPattern,
            match_type: matchType,
            method: method || null,
            folder_id: folderId,
            delay_ms: delayMs,
            condition_field_type: condType || null,
            condition_field_key: condType ? (condKey || null) : null,
            condition_field_value: condType ? (condValue || null) : null,
            active_version_id: selectedVersionId,
          } as Partial<MockRule>)
        ];

        // Save any modified drafts
        for (const [vIdStr, draft] of Object.entries(draftsByVersionId)) {
          const vId = Number(vIdStr);
          if (draft.isModified || vId === editingVersionId) {
            tasks.push(mocksApi.updateVersion(currentRule.id, vId, {
              name: draft.name,
              response_status: draft.response_status,
              response_headers: draft.response_headers,
              response_body: draft.response_body,
            }));
          }
        }

        await Promise.all(tasks);

        // Fetch fresh versions to sync and clear modified states
        const loadedVersions = await mocksApi.listVersions(currentRule.id);
        setVersions(loadedVersions);
        const nextDrafts: Record<number, MockVersionDraft> = {};
        loadedVersions.forEach((v) => {
          nextDrafts[v.id] = createVersionDraft(v);
        });
        setDraftsByVersionId(nextDrafts);
      } else {
        // Creating a new rule + initial version
        const initialDraft = draftsByVersionId[0] || DEFAULT_NEW_VERSION_DRAFT;
        const bodyError = getBodyError(initialDraft.response_body);
        if (bodyError) {
          setError(`Response body JSON is invalid: ${bodyError}`);
          setSaving(false);
          return;
        }

        const createdRule = await mocksApi.create({
          name,
          url_pattern: urlPattern,
          match_type: matchType,
          method: method || undefined,
          folder_id: folderId,
          delay_ms: delayMs,
          condition_field_type: condType || undefined,
          condition_field_key: condKey || undefined,
          condition_field_value: condValue || undefined,
        });

        const createdVersion = await mocksApi.createVersion(createdRule.id, {
          name: initialDraft.name || '200 OK',
          response_status: initialDraft.response_status || 200,
          response_headers: initialDraft.response_headers,
          response_body: initialDraft.response_body,
        });

        await mocksApi.update(createdRule.id, {
          active_version_id: createdVersion.id,
          is_active: 1,
        });

        setCurrentRule(createdRule);
        setVersions([createdVersion]);
        setSelectedVersionId(createdVersion.id);
        setEditingVersionId(createdVersion.id);
        setDraftsByVersionId({ [createdVersion.id]: createVersionDraft(createdVersion) });
      }

      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
      }, 2500);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const activeDraft = editingVersionId !== null
    ? (draftsByVersionId[editingVersionId] || (
        editingVersionId === 0
          ? DEFAULT_NEW_VERSION_DRAFT
          : versions.find((v) => v.id === editingVersionId)
            ? createVersionDraft(versions.find((v) => v.id === editingVersionId)!)
            : null
      ))
    : null;

  return createPortal((
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-[1440px] h-[calc(100vh-2rem)] max-h-[1000px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-sm">
              M
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {currentRule ? 'Edit Mock Rule' : 'New Mock Rule'}
              </h2>
              <p className="text-xs text-slate-500">
                {currentRule ? `Editing rule “${name || currentRule.name}”` : 'Create a new mock rule and configure its response'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
          {/* Left column: Rule Settings & Versions list */}
          <div className="overflow-y-auto px-6 py-4 space-y-4 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-900/40">
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-sm">
                <AlertCircle size={14} className="shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}

            {/* Rule config */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Rule Details</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Rule Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="e.g. Get User Profile"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">URL Pattern</label>
                <input
                  value={urlPattern}
                  onChange={(e) => setUrlPattern(e.target.value)}
                  className="input-field w-full text-sm font-mono"
                  placeholder="/api/users/*"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Folder</label>
                <select
                  value={folderId ?? ''}
                  onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}
                  className="input-field w-full text-sm"
                >
                  <option value="">Unfiled</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
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
                  <label className="block text-xs font-medium text-slate-400 mb-1">Method</label>
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
              </div>
            </div>

            {/* Condition mock */}
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">Condition Mock (条件匹配，可选)</span>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={condType}
                  onChange={(e) => setCondType(e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="">No Condition</option>
                  <option value="query">Query (?key=value)</option>
                  <option value="header">Header Field</option>
                  <option value="body">Body JSON Field</option>
                </select>
                <input
                  value={condKey}
                  onChange={(e) => setCondKey(e.target.value)}
                  placeholder={condType === 'query' ? 'Param key (e.g. type)' : condType === 'header' ? 'Header (e.g. x-token)' : 'JSON Key (e.g. id)'}
                  className="input-field text-xs"
                  disabled={!condType}
                />
                <input
                  value={condValue}
                  onChange={(e) => setCondValue(e.target.value)}
                  placeholder="Expected value"
                  className="input-field text-xs"
                  disabled={!condType}
                />
              </div>
            </div>

            {/* Versions List */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Mock Versions {currentRule?.id ? `(${versions.length})` : ''}
                </span>
                <span className="text-[10px] text-slate-500">
                  点击版本或编辑按钮修改响应
                </span>
              </div>

              {currentRule?.id ? (
                <div className="space-y-2">
                  {versions.map((v) => {
                    const draft = draftsByVersionId[v.id] || createVersionDraft(v);
                    const isEditing = editingVersionId === v.id;
                    const isActive = selectedVersionId === v.id;

                    return (
                      <VersionRow
                        key={v.id}
                        version={v}
                        draft={draft}
                        isActive={isActive}
                        isEditing={isEditing}
                        onSelectActive={() => {
                          setSelectedVersionId(v.id);
                          handleSelectForEdit(v.id, { mode: 'tree' });
                        }}
                        onSelectVersion={() => handleSelectForEdit(v.id, { mode: 'tree' })}
                        onStartEdit={(options) => handleSelectForEdit(v.id, { mode: 'source', ...options })}
                        onCopy={async () => {
                          const copied = await mocksApi.createVersion(currentRule.id, {
                            name: `${draft.name} Copy`,
                            response_status: draft.response_status,
                            response_headers: draft.response_headers,
                            response_body: draft.response_body,
                          });
                          setVersions((prev) => [...prev, copied]);
                          setDraftsByVersionId((prev) => ({
                            ...prev,
                            [copied.id]: createVersionDraft(copied),
                          }));
                          handleSelectForEdit(copied.id, { mode: 'source', focusStatusCode: true });
                        }}
                        onDelete={async () => {
                          if (!confirm(`Delete mock version “${draft.name}”?`)) return;
                          await mocksApi.deleteVersion(currentRule.id, v.id);
                          const remaining = versions.filter((x) => x.id !== v.id);
                          setVersions(remaining);
                          setDraftsByVersionId((prev) => {
                            const next = { ...prev };
                            delete next[v.id];
                            return next;
                          });
                          if (selectedVersionId === v.id) {
                            setSelectedVersionId(remaining[0]?.id || null);
                          }
                          if (editingVersionId === v.id) {
                            const nextVer = remaining[0] ?? null;
                            setEditingVersionId(nextVer ? nextVer.id : null);
                          }
                        }}
                      />
                    );
                  })}

                  <AddVersionRow
                    ruleId={currentRule.id}
                    onAdded={(v) => {
                      setVersions((current) => [...current, v]);
                      setDraftsByVersionId((prev) => ({
                        ...prev,
                        [v.id]: createVersionDraft(v),
                      }));
                      setSelectedVersionId(v.id);
                      handleSelectForEdit(v.id, { mode: 'source', focusStatusCode: true });
                    }}
                  />
                </div>
              ) : (
                <div className="p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 text-xs text-slate-300">
                  <div className="flex items-center gap-1.5 font-medium text-cyan-400 mb-1">
                    <Sparkles size={13} /> Initial Version
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    在右侧编辑初始版本的响应状态码（HTTP Code）、响应头和响应体。保存时将自动创建规则并激活该版本。
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right column: Mock Response Editor */}
          <div ref={mockResponseSectionRef} className="min-h-0 overflow-y-auto px-6 py-4 bg-slate-950/40">
            {activeDraft ? (
              <MockVersionFields
                draft={activeDraft}
                onChange={updateCurrentDraft}
                delayMs={delayMs}
                onDelayChange={setDelayMs}
                statusCodeInputRef={statusCodeInputRef}
                bodyView={bodyView}
                onBodyViewChange={setBodyView}
              />
            ) : (
              <div className="h-full min-h-64 flex items-center justify-center text-center text-slate-500">
                <div>
                  <div className="text-3xl mb-3">📄</div>
                  <p className="text-sm text-slate-400 font-medium">No mock version selected</p>
                  <p className="text-xs mt-1 text-slate-500">Click on a version on the left to edit its response code and body.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {editingVersionId !== null && activeDraft && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                {bodyView === 'source' ? '正在编辑：' : '当前查看：'}<strong className="text-slate-200">{activeDraft.name}</strong>
                <span className={`px-1.5 py-0.2 rounded font-mono text-[11px] border ${getStatusBadgeStyle(activeDraft.response_status)}`}>
                  {activeDraft.response_status}
                </span>
                {activeDraft.isModified && <span className="text-amber-400 text-[11px]">(有未保存修改)</span>}
              </span>
            )}
            {savedSuccess && (
              <span className="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[11px] font-medium">
                <Check size={13} /> 已保存
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button
              onClick={handleSaveRule}
              disabled={saving}
              className={`btn-primary text-sm flex items-center gap-2 ${savedSuccess ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500' : ''}`}
            >
              {saving ? (
                <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              ) : savedSuccess ? (
                <Check size={14} />
              ) : null}
              {savedSuccess ? 'Saved' : (currentRule ? 'Save Mock' : 'Create Rule')}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

function VersionRow({
  version,
  draft,
  isActive,
  isEditing,
  onSelectActive,
  onSelectVersion,
  onStartEdit,
  onCopy,
  onDelete,
}: {
  version: MockVersion;
  draft: MockVersionDraft;
  isActive: boolean;
  isEditing: boolean;
  onSelectActive: () => void;
  onSelectVersion: () => void;
  onStartEdit: (options?: { mode?: 'tree' | 'source'; focusStatusCode?: boolean }) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={() => onSelectVersion()}
      className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all cursor-pointer ${
        isEditing
          ? 'border-cyan-500 ring-1 ring-cyan-500/50 bg-slate-800/90 shadow-lg shadow-cyan-950/20'
          : isActive
            ? 'border-cyan-500/40 bg-cyan-500/5 hover:border-cyan-500/60 hover:bg-cyan-500/10'
            : 'border-slate-700/80 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/70'
      }`}
    >
      {/* Radio for Traffic Activation */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelectActive();
        }}
        title={isActive ? 'Active version for mock traffic' : 'Click to set as active mock version'}
        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          isActive ? 'border-cyan-500 bg-cyan-500' : 'border-slate-600 hover:border-cyan-400'
        }`}
      >
        {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </button>

      {/* Name and Status Code */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-200 truncate" title={draft.name}>
          {draft.name}
        </span>
        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${getStatusBadgeStyle(draft.response_status)}`}>
          {draft.response_status}
        </span>
        {draft.isModified && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit({ mode: 'source', focusStatusCode: true });
          }}
          title="Edit response code and body"
          className={`px-2 py-1 rounded text-xs transition-colors font-medium flex items-center gap-1 ${
            isEditing
              ? 'bg-cyan-600 text-white hover:bg-cyan-500'
              : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-700'
          }`}
        >
          Edit
        </button>

        <button
          type="button"
          onClick={onCopy}
          title="Duplicate version"
          className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-cyan-400 transition-colors"
        >
          <Copy size={13} />
        </button>

        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${draft.name}`}
          className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function AddVersionRow({ ruleId, onAdded }: { ruleId: number; onAdded: (v: MockVersion) => void }) {
  const [name, setName] = useState('');
  const [statusCode, setStatusCode] = useState('200');
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState(false);

  const handleAdd = async () => {
    const trimmed = name.trim() || `${statusCode} OK`;
    const num = parseInt(statusCode, 10) || 200;
    setAdding(true);
    try {
      const v = await mocksApi.createVersion(ruleId, {
        name: trimmed,
        response_status: num,
        response_headers: '{\n  "Content-Type": "application/json"\n}',
        response_body: '{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}',
      });
      onAdded(v);
      setName('');
      setStatusCode('200');
      setShow(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add version');
    } finally {
      setAdding(false);
    }
  };

  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-slate-700 hover:border-cyan-500/60 text-slate-400 hover:text-cyan-400 text-xs transition-colors"
      >
        <Plus size={13} /> Add Version
      </button>
    );
  }

  return (
    <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 space-y-2">
      <div className="text-xs font-semibold text-slate-300">New Version</div>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Version Name (e.g. 404 Error)"
          className="input-field text-xs flex-1"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input
          value={statusCode}
          onChange={(e) => setStatusCode(e.target.value)}
          placeholder="200"
          className="input-field text-xs w-16 font-mono text-center"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setShow(false)}
          className="btn-secondary text-xs px-2.5 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg disabled:opacity-40 transition-colors"
        >
          {adding ? 'Adding...' : 'Add Version'}
        </button>
      </div>
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
  return JSON.stringify(obj, null, 2);
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
            placeholder="Header name (e.g. Content-Type)"
            className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-0"
          />
          <span className="text-slate-600 text-xs shrink-0">:</span>
          <input
            value={pair.value}
            onChange={(e) => setValue(i, e.target.value)}
            placeholder="Value"
            className="flex-[2] bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-w-0"
          />
          <button
            onClick={() => removeRow(i)}
            aria-label="Remove header"
            className="p-1.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 shrink-0 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors mt-2"
      >
        <Plus size={13} /> Add Header
      </button>
    </div>
  );
}

// ── Shared mock response editor ────────────────────────────────────────────
interface MockVersionFieldsProps {
  draft: MockVersionDraft;
  onChange: (draft: Partial<MockVersionDraft>) => void;
  delayMs: number;
  onDelayChange: (delayMs: number) => void;
  statusCodeInputRef?: React.RefObject<HTMLInputElement>;
  bodyView?: 'tree' | 'source';
  onBodyViewChange?: (view: 'tree' | 'source') => void;
}

function MockVersionFields({
  draft,
  onChange,
  delayMs,
  onDelayChange,
  statusCodeInputRef,
  bodyView: externalBodyView,
  onBodyViewChange,
}: MockVersionFieldsProps) {
  const [headersCollapsed, setHeadersCollapsed] = useState(true);
  const [internalBodyView, setInternalBodyView] = useState<'tree' | 'source'>('tree');
  const bodyView = externalBodyView ?? internalBodyView;
  const setBodyView = (view: 'tree' | 'source') => {
    setInternalBodyView(view);
    onBodyViewChange?.(view);
  };
  const [statusInput, setStatusInput] = useState(String(draft.response_status || 200));
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiCancelRef = useRef<(() => void) | null>(null);
  const bodyError = getBodyError(draft.response_body);

  useEffect(() => {
    setStatusInput(String(draft.response_status || 200));
  }, [draft.response_status]);

  const handleStatusInputChange = (val: string) => {
    setStatusInput(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 100 && num <= 599) {
      onChange({ response_status: num });
    }
  };

  const handleStatusInputBlur = () => {
    const num = parseInt(statusInput, 10);
    if (isNaN(num) || num < 100 || num > 599) {
      const fallback = draft.response_status || 200;
      setStatusInput(String(fallback));
      onChange({ response_status: fallback });
    } else {
      setStatusInput(String(num));
      onChange({ response_status: num });
    }
  };

  const handleSelectPreset = (code: number, label: string) => {
    setStatusInput(String(code));
    const updates: Partial<MockVersionDraft> = { response_status: code };
    // If name is standard code name or empty, update name too
    if (!draft.name || draft.name.match(/^\d{3}/)) {
      updates.name = label;
    }
    onChange(updates);
  };

  const handleFormatBody = () => {
    try {
      onChange({ response_body: JSON.stringify(JSON.parse(draft.response_body), null, 2) });
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
        onChange({ response_body: cleanText });
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
      {/* Title */}
      <div>
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <span>Mock Response Editor</span>
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getStatusBadgeStyle(draft.response_status)}`}>
            HTTP {draft.response_status}
          </span>
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          直接在下方修改此版本的响应状态码、名称、Headers与响应体
        </p>
      </div>

      {/* Version Name and Status Code */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Version Name <span className="text-slate-500">(版本名称)</span>
          </label>
          <input
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="e.g. 200 OK, 404 Not Found"
            className="input-field w-full text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Status Code <span className="text-cyan-400 font-mono">(HTTP 状态码)</span>
          </label>
          <input
            ref={statusCodeInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={statusInput}
            onChange={(e) => handleStatusInputChange(e.target.value)}
            onBlur={handleStatusInputBlur}
            placeholder="200"
            className={`input-field w-full text-sm font-mono font-bold tracking-wider ${
              draft.response_status >= 200 && draft.response_status < 300 ? 'text-emerald-400 focus:border-emerald-500' :
              draft.response_status >= 400 && draft.response_status < 500 ? 'text-amber-400 focus:border-amber-500' :
              draft.response_status >= 500 ? 'text-red-400 focus:border-red-500' : 'text-slate-200'
            }`}
          />
        </div>

        {/* Quick status code presets */}
        <div className="sm:col-span-3 pt-1 border-t border-slate-800/80">
          <span className="text-[11px] text-slate-500 block mb-1.5">快捷选择状态码 (Quick Presets):</span>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_STATUS_CODES.map((preset) => {
              const isSelected = draft.response_status === preset.code;
              return (
                <button
                  key={preset.code}
                  type="button"
                  onClick={() => handleSelectPreset(preset.code, preset.label)}
                  className={`px-2 py-1 rounded-md text-xs font-mono transition-all border flex items-center gap-1 ${
                    isSelected
                      ? `${getStatusBadgeStyle(preset.code)} font-bold ring-1 ring-cyan-500`
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>{preset.code}</span>
                  <span className="text-[10px] opacity-75 font-sans">{preset.text}</span>
                  {isSelected && <Check size={11} className="ml-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Delay Response Setting */}
      <div className="border border-slate-800 rounded-xl p-3.5 bg-slate-900/60 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Clock size={13} className="text-cyan-400" />
              <span>Delay Response (延时响应时间)</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">命中此 Mock 规则时等待指定时长后再返回响应</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950/70 border border-slate-700 rounded-lg px-2.5 py-1 focus-within:ring-1 focus-within:ring-cyan-500 focus-within:border-cyan-500">
              <input
                type="number"
                min={0}
                max={60000}
                step={100}
                value={delayMs === 0 ? '' : delayMs}
                placeholder="0"
                onChange={(event) => {
                  const val = event.target.value === '' ? 0 : Math.min(60000, Math.max(0, parseInt(event.target.value, 10) || 0));
                  onDelayChange(val);
                }}
                aria-label="Delay Response in milliseconds"
                className="w-20 bg-transparent text-sm text-right font-mono font-bold text-cyan-300 focus:outline-none"
              />
              <span className="text-xs text-slate-400 font-mono">ms</span>
            </div>
            {delayMs > 0 && (
              <span className="text-xs text-slate-400 font-mono">
                ({(delayMs / 1000).toFixed(delayMs % 1000 === 0 ? 0 : 1)} 秒)
              </span>
            )}
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/80">
          <span className="text-[11px] text-slate-500 mr-1">快捷预设:</span>
          {[
            { label: '0 ms (立即)', value: 0 },
            { label: '200 ms', value: 200 },
            { label: '500 ms', value: 500 },
            { label: '1 秒 (1000ms)', value: 1000 },
            { label: '2 秒 (2000ms)', value: 2000 },
            { label: '3 秒 (3000ms)', value: 3000 },
            { label: '5 秒 (弱网模拟)', value: 5000 },
          ].map((preset) => {
            const isSelected = delayMs === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onDelayChange(preset.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all border ${
                  isSelected
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-semibold ring-1 ring-cyan-500/50'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200 hover:bg-slate-700'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Response Headers */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
        <button
          type="button"
          onClick={() => setHeadersCollapsed((value) => !value)}
          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-slate-800/60 transition-colors"
          aria-expanded={!headersCollapsed}
        >
          <ChevronRight
            size={14}
            className={`text-slate-400 transition-transform ${headersCollapsed ? '' : 'rotate-90'}`}
          />
          <span className="text-xs font-medium text-slate-300">Response Headers (响应头)</span>
          <span className="ml-auto text-[11px] text-slate-500">
            {parseHeaders(draft.response_headers).length} 项 · {headersCollapsed ? '点击展开编辑' : '点击折叠'}
          </span>
        </button>
        {!headersCollapsed && (
          <div className="border-t border-slate-800 p-3.5 bg-slate-950/30">
            <HeadersEditor
              value={draft.response_headers}
              onChange={(responseHeaders) => onChange({ response_headers: responseHeaders })}
            />
          </div>
        )}
      </div>

      {/* Response Body */}
      <div className="border border-slate-800 rounded-xl p-3.5 bg-slate-900/60 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-slate-300">Response Body (响应体)</label>
          <div className="flex items-center gap-2">
            {bodyError && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> JSON 格式错误: {bodyError.slice(0, 35)}...
              </span>
            )}
            <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setBodyView('tree')}
                disabled={!!bodyError}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors disabled:opacity-40 ${
                  bodyView === 'tree' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                JSON Tree
              </button>
              <button
                type="button"
                onClick={() => setBodyView('source')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
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
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400 transition-colors px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700"
            >
              <WrapText size={12} /> Format
            </button>
          </div>
        </div>

        {bodyView === 'tree' && !bodyError ? (
          <div className="border border-slate-800 rounded-lg bg-slate-950/60 p-3 min-h-[300px] max-h-[500px] overflow-y-auto">
            <JsonViewer data={draft.response_body} maxHeight="450px" />
          </div>
        ) : (
          <textarea
            value={draft.response_body}
            onChange={(event) => onChange({ response_body: event.target.value })}
            rows={14}
            spellCheck={false}
            aria-label="Response Body Source"
            className={`w-full min-h-[300px] bg-slate-950/70 border text-slate-200 text-xs font-mono rounded-lg p-3 focus:outline-none focus:ring-1 resize-y leading-relaxed ${
              bodyError ? 'border-red-500/70 focus:ring-red-500' : 'border-slate-800 focus:ring-cyan-500'
            }`}
          />
        )}
      </div>

      {/* AI Generate Body */}
      <div className="border border-purple-500/20 rounded-xl p-3.5 bg-purple-500/5">
        <p className="text-xs font-medium text-purple-300 mb-2 flex items-center gap-1.5">
          <Bot size={14} className="text-purple-400" /> AI Generate Body
        </p>
        <div className="flex gap-2">
          <input
            value={aiDescription}
            onChange={(event) => setAiDescription(event.target.value)}
            placeholder="Describe the mock response you want (e.g. user profile with avatar and address)..."
            className="flex-1 bg-slate-900 border border-purple-500/30 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
            onKeyDown={(event) => event.key === 'Enter' && handleAiGenerate()}
          />
          <button
            type="button"
            onClick={handleAiGenerate}
            disabled={aiLoading || !aiDescription.trim()}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors shrink-0"
          >
            {aiLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : <Bot size={13} />}
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
