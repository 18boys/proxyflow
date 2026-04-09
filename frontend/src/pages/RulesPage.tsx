import { useEffect, useState } from 'react';
import { GitBranch, ToggleLeft, ToggleRight, ChevronDown, RefreshCw } from 'lucide-react';
import type { MockRule, MockVersion } from '../types';
import { rulesApi } from '../api/client';

export default function RulesPage() {
  const [rules, setRules] = useState<MockRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalMode, setGlobalMode] = useState<'proxy' | 'mock' | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const loadRules = async () => {
    try {
      const data = await rulesApi.list();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleToggle = async (rule: MockRule) => {
    setToggling(rule.id);
    try {
      const { is_active } = await rulesApi.toggle(rule.id);
      setRules(rules.map((r) => r.id === rule.id ? { ...r, is_active } : r));
    } finally {
      setToggling(null);
    }
  };

  const handleVersionChange = async (rule: MockRule, versionId: number) => {
    await rulesApi.setVersion(rule.id, versionId);
    setRules(rules.map((r) =>
      r.id === rule.id
        ? { ...r, active_version_id: versionId, active_version_name: r.versions?.find((v) => v.id === versionId)?.name }
        : r
    ));
  };

  const handleGlobalMode = async (mode: 'mock' | 'proxy') => {
    setGlobalMode(mode);
    await rulesApi.setGlobal(mode);
    await loadRules();
    setTimeout(() => setGlobalMode(null), 1500);
  };

  const mockCount = rules.filter((r) => r.is_active).length;
  const proxyCount = rules.filter((r) => !r.is_active).length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/30">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Route Control</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {mockCount} mocked, {proxyCount} proxied
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadRules}
            className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => handleGlobalMode('proxy')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
              ${globalMode === 'proxy' ? 'bg-blue-500 text-white' : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'}`}
          >
            <GitBranch size={13} /> All Proxy
          </button>
          <button
            onClick={() => handleGlobalMode('mock')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5
              ${globalMode === 'mock' ? 'bg-emerald-500 text-white' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'}`}
          >
            <ToggleRight size={13} /> All Mock
          </button>
        </div>
      </div>

      {/* Rules table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            <div className="text-4xl mb-3">🔀</div>
            <p>No mock rules configured</p>
            <p className="text-sm mt-1">Go to Mocks to create rules</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_1fr_2fr_80px] gap-4 px-6 py-2 border-b border-slate-800 text-xs font-medium text-slate-500 uppercase tracking-wider">
              <span>URL Pattern</span>
              <span>Method</span>
              <span>Match</span>
              <span>Active Version</span>
              <span>Mode</span>
            </div>

            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => handleToggle(rule)}
                onVersionChange={(vid) => handleVersionChange(rule, vid)}
                toggling={toggling === rule.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface RuleRowProps {
  rule: MockRule;
  onToggle: () => void;
  onVersionChange: (vid: number) => void;
  toggling: boolean;
}

function RuleRow({ rule, onToggle, onVersionChange, toggling }: RuleRowProps) {
  const isMocked = rule.is_active === 1;

  return (
    <div className={`grid grid-cols-[2fr_1fr_1fr_2fr_80px] gap-4 items-center px-6 py-3 border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors text-sm
      ${isMocked ? 'bg-emerald-500/3' : ''}`}>
      <div className="min-w-0">
        <p className="font-mono text-slate-200 text-xs truncate" title={rule.url_pattern}>
          {rule.url_pattern}
        </p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{rule.name}</p>
      </div>

      <span className={`text-xs font-mono px-1.5 py-0.5 rounded w-fit
        ${rule.method ? 'bg-slate-700 text-slate-300' : 'text-slate-600 italic'}`}>
        {rule.method || 'any'}
      </span>

      <span className={`text-xs px-1.5 py-0.5 rounded w-fit ${
        rule.match_type === 'exact' ? 'bg-slate-700 text-slate-400' :
        rule.match_type === 'wildcard' ? 'bg-blue-500/20 text-blue-400' :
        'bg-purple-500/20 text-purple-400'
      }`}>
        {rule.match_type}
      </span>

      <div>
        {isMocked && rule.versions && rule.versions.length > 0 ? (
          <div className="relative">
            <select
              value={rule.active_version_id || ''}
              onChange={(e) => onVersionChange(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 pr-6 appearance-none focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              {rule.versions.map((v: MockVersion) => (
                <option key={v.id} value={v.id}>{v.name} ({v.response_status})</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        ) : (
          <span className="text-xs text-slate-600 italic">
            {isMocked ? 'No versions' : 'Real server'}
          </span>
        )}
      </div>

      <div className="flex justify-center">
        <button
          onClick={onToggle}
          disabled={toggling}
          className="relative flex items-center gap-1.5 focus:outline-none"
          title={isMocked ? 'Switch to Proxy' : 'Switch to Mock'}
        >
          {toggling ? (
            <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : isMocked ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
              <ToggleRight size={20} className="text-emerald-400" />
              MOCK
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-blue-400">
              <ToggleLeft size={20} className="text-slate-500" />
              PROXY
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
