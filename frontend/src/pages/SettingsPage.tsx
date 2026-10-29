import { useEffect, useState } from 'react';
import {
  AlertCircle, Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound,
  Plus, Save, Shield, Sparkles, Terminal, TestTube2, Trash2, X, Globe
} from 'lucide-react';
import { settingsApi, tokensApi } from '../api/client';
import type { AiProtocol, AiSettings, ApiToken } from '../types';
import { useStore } from '../store/useStore';
import { useDialog } from '../context/DialogContext';
import CustomSelect from '../components/CustomSelect';

const DEFAULT_ENDPOINTS: Record<AiProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

const QUICK_EXCLUSION_PRESETS = [
  'analytics.google.com',
  'sentry.io',
  'firebaseinstallations.googleapis.com',
  'app-measurement.com',
];

export default function SettingsPage() {
  const user = useStore((state) => state.user);
  const { confirm, toast } = useDialog();

  // AI Settings State
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [protocol, setProtocol] = useState<AiProtocol>('openai');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINTS.openai);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Exclusion Domains State
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [savedExclusions, setSavedExclusions] = useState<string[]>([]);
  const [exclusionsLoading, setExclusionsLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [savingExclusions, setSavingExclusions] = useState(false);

  // API Tokens State
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [creatingToken, setCreatingToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenMessage, setTokenMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [mcpTab, setMcpTab] = useState<'json' | 'prompt' | 'cli'>('json');
  const [copiedType, setCopiedType] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.getAi()
      .then((data) => {
        setSettings(data);
        setEnabled(data.enabled);
        setProtocol(data.protocol);
        setEndpoint(data.endpoint);
        setModel(data.model);
      })
      .catch((error) => setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load AI settings' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    settingsApi.getExclusions()
      .then((data) => {
        const list = data.exclusion_domains || [];
        setExclusions(list);
        setSavedExclusions(list);
      })
      .catch(() => {})
      .finally(() => setExclusionsLoading(false));
  }, []);

  useEffect(() => {
    tokensApi.list()
      .then(setTokens)
      .catch((error) => setTokenMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load API tokens' }))
      .finally(() => setTokensLoading(false));
  }, []);

  const normalizeDomain = (raw: string) =>
    raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  const handleAddExclusion = (domainInput?: string) => {
    const raw = domainInput !== undefined ? domainInput : newDomain;
    const domain = normalizeDomain(raw);
    if (!domain) return;
    if (exclusions.includes(domain)) {
      if (domainInput === undefined) setNewDomain('');
      return;
    }
    setExclusions((prev) => [...prev, domain]);
    if (domainInput === undefined) setNewDomain('');
  };

  const handleRemoveExclusion = (domain: string) => {
    setExclusions((prev) => prev.filter((d) => d !== domain));
  };

  const handleSaveExclusions = async () => {
    setSavingExclusions(true);
    try {
      const finalExclusions = [...exclusions];
      const pending = normalizeDomain(newDomain);
      if (pending && !finalExclusions.includes(pending)) {
        finalExclusions.push(pending);
        setNewDomain('');
      }
      const result = await settingsApi.updateExclusions(finalExclusions);
      const updated = result.exclusion_domains || [];
      setExclusions(updated);
      setSavedExclusions(updated);
      toast.success('过滤域名列表已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存过滤域名失败');
    } finally {
      setSavingExclusions(false);
    }
  };

  const exclusionsChanged =
    JSON.stringify(exclusions) !== JSON.stringify(savedExclusions) || Boolean(normalizeDomain(newDomain));

  const handleCreateToken = async () => {
    const name = newTokenName.trim();
    if (!name) return;
    setCreatingToken(true);
    setTokenMessage(null);
    try {
      const created = await tokensApi.create(name);
      const { token, ...rest } = created;
      setTokens((prev) => [rest, ...prev]);
      setRevealedToken(token);
      setNewTokenName('');
      setCopied(false);
    } catch (error) {
      setTokenMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not create token' });
    } finally {
      setCreatingToken(false);
    }
  };

  const handleRevokeToken = async (tokenObj: ApiToken) => {
    const ok = await confirm({
      title: '吊销 API Token',
      message: `确定要吊销 Token “${tokenObj.name}” (${tokenObj.token_prefix}••••••••) 吗？使用该 Token 的 MCP 客户端将立即失去访问权限。`,
      confirmText: '吊销 Token',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await tokensApi.revoke(tokenObj.id);
      setTokens((prev) => prev.map((t) => (t.id === tokenObj.id ? { ...t, revoked_at: new Date().toISOString() } : t)));
      toast.success('Token 已吊销');
    } catch (error) {
      setTokenMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not revoke token' });
    }
  };

  const handleCopyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const handleCopyText = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedType(type);
      setTimeout(() => setCopiedType((prev) => (prev === type ? null : prev)), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const tokenPlaceholder = revealedToken ?? 'pf_xxxxxxxxxxxxxxxxxxxxxxxx';
  const proxyflowUrl = window.location.origin;

  const mcpConfigExample = `{
  "mcpServers": {
    "proxyflow": {
      "command": "npx",
      "args": ["-y", "@proxyflow/mcp-server"],
      "env": {
        "PROXYFLOW_URL": "${proxyflowUrl}",
        "PROXYFLOW_TOKEN": "${tokenPlaceholder}"
      }
    }
  }
}`;

  const claudeCliCommand = `claude mcp add proxyflow --env PROXYFLOW_URL="${proxyflowUrl}" --env PROXYFLOW_TOKEN="${tokenPlaceholder}" -- npx -y @proxyflow/mcp-server`;

  const agentPrompt = `请帮我在当前环境/项目中配置 Proxyflow MCP 工具：

MCP 配置信息如下（JSON 格式）：
\`\`\`json
${mcpConfigExample}
\`\`\`

如果是 Claude Code，也可以直接在终端执行：
${claudeCliCommand}

配置完成后，请帮我检查 MCP 连接状态并列出可用的 proxyflow 工具。`;

  const changeProtocol = (nextProtocol: AiProtocol) => {
    const currentDefault = DEFAULT_ENDPOINTS[protocol];
    setProtocol(nextProtocol);
    if (!endpoint || endpoint === currentDefault) setEndpoint(DEFAULT_ENDPOINTS[nextProtocol]);
    setMessage(null);
  };

  const apiKeyValue = clearApiKey ? null : apiKey.trim() || undefined;
  const hasKeyForSelectedProtocol = Boolean(settings?.has_api_key && settings.protocol === protocol);

  const validate = (): boolean => {
    if (!endpoint.trim() || !model.trim()) {
      setMessage({ type: 'error', text: 'Endpoint and Model are required.' });
      return false;
    }
    if (protocol === 'anthropic' && !apiKey.trim() && (!hasKeyForSelectedProtocol || clearApiKey)) {
      setMessage({ type: 'error', text: 'Anthropic protocol requires an API key.' });
      return false;
    }
    return true;
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setMessage(null);
    try {
      const result = await settingsApi.testAi({
        protocol,
        endpoint: endpoint.trim(),
        model: model.trim(),
        api_key: apiKeyValue,
      });
      setMessage({ type: 'success', text: `Connection successful: ${result.message}` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await settingsApi.updateAi({
        enabled,
        protocol,
        endpoint: endpoint.trim(),
        model: model.trim(),
        api_key: apiKeyValue,
      });
      setSettings(updated);
      setApiKey('');
      setClearApiKey(false);
      setMessage({ type: 'success', text: enabled ? 'Personal AI configuration saved and enabled.' : 'AI configuration saved. System default remains active.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save AI settings' });
    } finally {
      setSaving(false);
    }
  };

  const activeTokensCount = tokens.filter((t) => !t.revoked_at).length;

  return (
    <div className="h-full overflow-y-auto bg-slate-950">
      {/* Page Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Settings & Preferences</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage proxy filtering rules, personal AI provider, and MCP assistant tokens · <span className="font-mono text-slate-400">{user?.email}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full border border-slate-800 bg-slate-800/60 text-slate-400">
              过滤域名: <strong className="text-slate-200 font-mono">{exclusions.length}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-full border border-slate-800 bg-slate-800/60 text-slate-400">
              有效 Token: <strong className="text-slate-200 font-mono">{activeTokensCount}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* 1. Proxy Exclusion Domains Card */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 border-b border-slate-800">
            <div className="flex gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                <Shield size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">Proxy Exclusion Domains</h2>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {exclusions.length} domains
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  命中以下域名的请求将直接静默透传，不会出现在抓包控制台，也不会触发任何 Mock 规则（适用于埋点统计、日志上报、CDN 静态资源等）。
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Add domain bar */}
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddExclusion();
                    }
                  }}
                  placeholder="输入要忽略的域名，例如 analytics.google.com 或 sentry.io"
                  className="input-field w-full pl-9 text-sm font-mono"
                />
              </div>
              <button
                type="button"
                onClick={() => handleAddExclusion()}
                disabled={!normalizeDomain(newDomain)}
                className="btn-secondary text-sm px-3.5 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                <Plus size={14} /> Add Domain
              </button>
              <button
                type="button"
                onClick={handleSaveExclusions}
                disabled={savingExclusions || !exclusionsChanged}
                className="btn-primary text-sm px-4 flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {savingExclusions ? (
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save Exclusions
              </button>
            </div>

            {/* Domain tags */}
            {exclusionsLoading ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
              </div>
            ) : exclusions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center">
                <p className="text-xs text-slate-500">当前暂未配置过滤域名，所有代理流量都会显示在 Monitor 列表中。</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 p-3.5 rounded-xl border border-slate-800 bg-slate-900/40">
                {exclusions.map((domain) => (
                  <span
                    key={domain}
                    className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-slate-200 font-mono shadow-sm"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
                    {domain}
                    <button
                      type="button"
                      onClick={() => handleRemoveExclusion(domain)}
                      className="p-0.5 rounded hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-colors ml-0.5"
                      title={`移除 ${domain}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Quick presets */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 mr-1">常用推荐添加:</span>
                {QUICK_EXCLUSION_PRESETS.filter((d) => !exclusions.includes(d)).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleAddExclusion(preset)}
                    className="text-[11px] font-mono px-2 py-0.5 rounded-md border border-slate-800 bg-slate-900 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-400 transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
              {exclusionsChanged && (
                <span className="text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertCircle size={12} /> 有未保存的修改，请点击 Save Exclusions 保存生效
                </span>
              )}
            </div>
          </div>
        </section>

        {/* 2. AI Provider Card */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 border-b border-slate-800">
            <div className="flex gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                <KeyRound size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">AI Provider</h2>
                  {settings && (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      settings.effective_source === 'personal'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : settings.effective_source === 'system'
                          ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {settings.effective_source === 'personal' ? 'Personal AI Active' : settings.effective_source === 'system' ? 'System AI Active' : 'Not configured'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  配置自定义大模型接口，用于 AI 生成 Mock 场景、自动构造 JSON 响应以及抓包请求智能诊断。
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="h-56 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Toggle switch bar */}
              <div
                onClick={() => setEnabled(!enabled)}
                className={`flex items-center justify-between gap-4 p-4 rounded-xl border transition-all cursor-pointer select-none ${
                  enabled
                    ? 'border-cyan-500/40 bg-cyan-500/5'
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-slate-200">Use personal AI configuration</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    开启后优先使用下方配置的个人模型；关闭时将默认使用系统内置 AI 配置。
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabled(!enabled);
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    enabled ? 'bg-cyan-600' : 'bg-slate-600/60'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ai-protocol" className="block text-xs font-medium text-slate-400 mb-1.5">Protocol</label>
                  <CustomSelect
                    value={protocol}
                    onChange={(val) => changeProtocol(val as AiProtocol)}
                    ariaLabel="Protocol"
                    options={[
                      { value: 'openai', label: 'OpenAI-compatible (/chat/completions)' },
                      { value: 'anthropic', label: 'Anthropic (/v1/messages)' },
                    ]}
                  />
                </div>
                <div>
                  <label htmlFor="ai-model" className="block text-xs font-medium text-slate-400 mb-1.5">Model Name</label>
                  <input
                    id="ai-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="e.g. gpt-4o, claude-3-5-sonnet-latest, deepseek-chat"
                    className="input-field w-full text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ai-endpoint" className="block text-xs font-medium text-slate-400 mb-1.5">API Base Endpoint</label>
                  <input
                    id="ai-endpoint"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder={DEFAULT_ENDPOINTS[protocol]}
                    className="input-field w-full text-sm font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {protocol === 'openai'
                      ? '自动拼接 /chat/completions（若地址已包含则直接使用）。'
                      : 'Anthropic 协议兼容接口地址，SDK 自动调用 /v1/messages。'}
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="ai-api-key" className="text-xs font-medium text-slate-400">API Key</label>
                    {hasKeyForSelectedProtocol && (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={11} /> 已保存密钥
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="ai-api-key"
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
                      placeholder={hasKeyForSelectedProtocol ? '留空则保留已保存的 Key' : protocol === 'openai' ? 'sk-... (本地模型可留空)' : 'sk-ant-...'}
                      autoComplete="off"
                      className="input-field w-full text-sm font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((visible) => !visible)}
                      aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {hasKeyForSelectedProtocol ? (
                    <label className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clearApiKey}
                        onChange={(event) => { setClearApiKey(event.target.checked); if (event.target.checked) setApiKey(''); }}
                        className="accent-red-500 rounded"
                      />
                      保存时清除已存储的 API Key
                    </label>
                  ) : (
                    <p className="text-[11px] text-slate-500 mt-1.5">密钥在服务端加密存储，不会明文返回给浏览器。</p>
                  )}
                </div>
              </div>

              {message && (
                <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                  message.type === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                }`}>
                  {message.type === 'success' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                  <span className="break-all leading-relaxed">{message.text}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
                <button
                  onClick={handleTest}
                  disabled={testing || saving}
                  className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {testing ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <TestTube2 size={14} />}
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || testing}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                  {saving ? 'Saving...' : 'Save AI Settings'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 3. API Tokens (MCP) Card */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 border-b border-slate-800">
            <div className="flex gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <Terminal size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">API Tokens (MCP Integration)</h2>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {activeTokensCount} active
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  生成专属访问令牌，让 Claude Code、Cursor、Antigravity 等 AI 助手通过 MCP 直接创建/切换 Mock 并实时监听抓包请求。
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {revealedToken && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                    <CheckCircle2 size={14} /> Token 已生成 — 请立即复制保存（关闭后将不再显示完整明文）
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-slate-100 bg-slate-900 border border-emerald-500/30 rounded-lg px-3 py-2 break-all">
                    {revealedToken}
                  </code>
                  <button
                    onClick={() => handleCopyToken(revealedToken)}
                    className="btn-primary text-xs py-2 px-3 flex items-center gap-1.5 shrink-0"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy Token'}
                  </button>
                </div>
              </div>
            )}

            {tokenMessage && (
              <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                tokenMessage.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}>
                {tokenMessage.type === 'success' ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
                <span className="break-all">{tokenMessage.text}</span>
              </div>
            )}

            {/* Create token bar */}
            <div className="flex gap-2">
              <input
                value={newTokenName}
                onChange={(event) => setNewTokenName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') handleCreateToken(); }}
                placeholder="输入新 Token 标识名称，例如：macbook-claude 或 work-mcp"
                className="input-field flex-1 text-sm"
              />
              <button
                onClick={handleCreateToken}
                disabled={creatingToken || !newTokenName.trim()}
                className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {creatingToken ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus size={14} />}
                Generate Token
              </button>
            </div>

            {/* Token list */}
            {tokensLoading ? (
              <div className="h-16 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
              </div>
            ) : tokens.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center">
                <p className="text-xs text-slate-500">暂未生成任何 API Token。</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
                {tokens.map((token) => {
                  const isRevoked = Boolean(token.revoked_at);
                  return (
                    <div
                      key={token.id}
                      className={`flex items-center justify-between gap-4 px-4 py-3 transition-colors ${
                        isRevoked ? 'opacity-60' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-200 truncate">{token.name}</p>
                          <code className="text-[11px] text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                            {token.token_prefix}••••••••
                          </code>
                          {isRevoked ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-500 border border-slate-700">
                              Revoked
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Created {new Date(token.created_at).toLocaleString()}
                          {token.last_used_at && ` · Last used ${new Date(token.last_used_at).toLocaleString()}`}
                        </p>
                      </div>
                      {!isRevoked && (
                        <button
                          onClick={() => handleRevokeToken(token)}
                          aria-label="Revoke token"
                          title="吊销此 Token"
                          className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* MCP Quick Setup Guide */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setMcpTab('json')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      mcpTab === 'json'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    JSON 配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpTab('prompt')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                      mcpTab === 'prompt'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Sparkles size={12} />
                    Agent 提示词
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpTab('cli')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      mcpTab === 'cli'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Claude CLI
                  </button>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {mcpTab !== 'prompt' && (
                    <button
                      type="button"
                      onClick={() => handleCopyText(agentPrompt, 'agent-prompt-quick')}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 flex items-center gap-1.5 transition-colors font-medium"
                      title="直接复制发给 AI Agent 的完整安装提示词"
                    >
                      <Sparkles size={12} />
                      {copiedType === 'agent-prompt-quick' ? '已复制提示词' : '复制 Agent 提示词'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const textToCopy =
                        mcpTab === 'json' ? mcpConfigExample : mcpTab === 'prompt' ? agentPrompt : claudeCliCommand;
                      handleCopyText(textToCopy, mcpTab);
                    }}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    {copiedType === mcpTab ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedType === mcpTab ? '已复制' : '复制'}
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-2.5">
                {!revealedToken && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertCircle size={13} className="shrink-0" />
                    提示：生成新 Token 后，下方配置模板与提示词会自动填入真实 Token。
                  </p>
                )}

                {mcpTab === 'json' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-400">
                      MCP 客户端配置（保存到 <code className="font-mono text-slate-300">claude_desktop_config.json</code> 或 Cursor / Antigravity MCP 设置）：
                    </p>
                    <pre className="text-xs font-mono text-slate-200 bg-slate-900 p-3.5 rounded-xl border border-slate-800 overflow-x-auto whitespace-pre leading-relaxed">
                      {mcpConfigExample}
                    </pre>
                  </div>
                )}

                {mcpTab === 'prompt' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-400">
                      可直接复制以下提示词发给 Claude Code、Cursor、Windsurf、Cline 或 Antigravity 等 AI Agent 自动完成配置：
                    </p>
                    <pre className="text-xs font-mono text-slate-200 bg-slate-900 p-3.5 rounded-xl border border-slate-800 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {agentPrompt}
                    </pre>
                  </div>
                )}

                {mcpTab === 'cli' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-400">
                      Claude Code 终端一键添加命令：
                    </p>
                    <pre className="text-xs font-mono text-slate-200 bg-slate-900 p-3.5 rounded-xl border border-slate-800 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {claudeCliCommand}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
