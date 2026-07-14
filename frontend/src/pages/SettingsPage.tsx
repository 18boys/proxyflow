import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Save, TestTube2 } from 'lucide-react';
import { settingsApi } from '../api/client';
import type { AiProtocol, AiSettings } from '../types';
import { useStore } from '../store/useStore';

const DEFAULT_ENDPOINTS: Record<AiProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export default function SettingsPage() {
  const user = useStore((state) => state.user);
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/30">
        <h1 className="text-lg font-semibold text-slate-100">Personal Settings</h1>
        <p className="text-xs text-slate-500 mt-0.5">{user?.email}</p>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        <div className="card overflow-hidden">
          <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-800">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center shrink-0">
                <KeyRound size={17} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">AI Provider</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Configure your own model for Mock generation, JSON generation, and request diagnosis.
                </p>
              </div>
            </div>
            {settings && (
              <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                settings.effective_source === 'personal'
                  ? 'bg-purple-500/15 text-purple-400'
                  : settings.effective_source === 'system'
                    ? 'bg-cyan-500/15 text-cyan-400'
                    : 'bg-slate-700 text-slate-400'
              }`}>
                {settings.effective_source === 'personal' ? 'Personal AI' : settings.effective_source === 'system' ? 'System AI' : 'Not configured'}
              </span>
            )}
          </div>

          {loading ? (
            <div className="h-56 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              <label className="flex items-center justify-between gap-4 p-3 rounded-lg border border-slate-700 bg-slate-800/40 cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-slate-200">Use personal AI configuration</p>
                  <p className="text-xs text-slate-500 mt-0.5">When disabled, ProxyFlow uses the system AI if one is configured.</p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  className="w-4 h-4 accent-cyan-500"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ai-protocol" className="block text-xs font-medium text-slate-400 mb-1.5">Protocol</label>
                  <select
                    id="ai-protocol"
                    value={protocol}
                    onChange={(event) => changeProtocol(event.target.value as AiProtocol)}
                    className="input-field w-full text-sm"
                  >
                    <option value="openai">OpenAI-compatible</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ai-model" className="block text-xs font-medium text-slate-400 mb-1.5">Model</label>
                  <input
                    id="ai-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="Model name from your provider"
                    className="input-field w-full text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ai-endpoint" className="block text-xs font-medium text-slate-400 mb-1.5">Endpoint</label>
                <input
                  id="ai-endpoint"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder={DEFAULT_ENDPOINTS[protocol]}
                  className="input-field w-full text-sm font-mono"
                />
                <p className="text-[11px] text-slate-600 mt-1">
                  {protocol === 'openai'
                    ? 'Enter the API base URL. ProxyFlow appends /chat/completions unless it is already present.'
                    : 'Enter the Anthropic-compatible base URL. The SDK calls /v1/messages.'}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="ai-api-key" className="text-xs font-medium text-slate-400">API Key</label>
                  {hasKeyForSelectedProtocol && (
                    <span className="text-[11px] text-emerald-400">A saved key is available</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="ai-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }}
                    placeholder={hasKeyForSelectedProtocol ? 'Leave blank to keep the saved key' : protocol === 'openai' ? 'Optional for local endpoints' : 'Required'}
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
                {hasKeyForSelectedProtocol && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                    <input
                      type="checkbox"
                      checked={clearApiKey}
                      onChange={(event) => { setClearApiKey(event.target.checked); if (event.target.checked) setApiKey(''); }}
                      className="accent-red-500"
                    />
                    Remove the saved API key when saving
                  </label>
                )}
                <p className="text-[11px] text-slate-600 mt-1.5">The API key is encrypted before it is stored and is never returned to the browser.</p>
              </div>

              {message && (
                <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  message.type === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border-red-500/20 bg-red-500/10 text-red-400'
                }`}>
                  {message.type === 'success' ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
                  <span className="break-all">{message.text}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleTest}
                  disabled={testing || saving}
                  className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {testing ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : <TestTube2 size={14} />}
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || testing}
                  className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  {saving ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={14} />}
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
