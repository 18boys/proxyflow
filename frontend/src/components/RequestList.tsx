import { useStore } from '../store/useStore';
import { getStatusColor, getMethodColor } from '../types';
import type { RequestLog } from '../types';
import { Trash2, Filter, X, CheckSquare, Square, Search, RefreshCw, Zap } from 'lucide-react';
import { useState, useEffect } from 'react';
import { requestsApi } from '../api/client';

interface RequestListProps {
  onSelectRequest: (id: number) => void;
}

const METHOD_CHIPS = ['ALL', 'GET', 'POST', 'PUT', 'DELETE'];
const STATUS_CHIPS = [
  { label: 'ALL', value: '' },
  { label: '2xx', value: '2xx', color: 'text-emerald-400' },
  { label: '4xx', value: '4xx', color: 'text-amber-400' },
  { label: '5xx', value: '5xx', color: 'text-red-400' },
  { label: 'MOCKED', value: 'mock', color: 'text-cyan-400' },
];

export default function RequestList({ onSelectRequest }: RequestListProps) {
  const {
    requests, selectedRequestId, setSelectedRequestId, filters, setFilter, clearFilters,
    selectedForDiagnosis, toggleDiagnosisSelection, clearDiagnosisSelection, devices
  } = useStore();
  const [clearLoading, setClearLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [disablingId, setDisablingId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const setRequests = useStore((s) => s.setRequests);
  const setDevices = useStore((s) => s.setDevices);

  useEffect(() => {
    import('../api/client').then(({ devicesApi }) => {
      devicesApi.list().then(setDevices).catch(() => {});
    });
  }, [setDevices]);

  const handleDisableMock = async (req: RequestLog) => {
    setDisablingId(req.id);
    try {
      const res = await requestsApi.disableMock(req.id);
      if (res.success) {
        setToastMsg({ text: `Mock 规则 "${res.rule.name}" 已关闭`, type: 'success' });
        setTimeout(() => setToastMsg((curr) => curr?.text.includes(res.rule.name) ? null : curr), 3500);

        setRequests(
          requests.map((r) => {
            if (r.id === req.id || (res.rule.id && r.mock_id === res.rule.id)) {
              return { ...r, is_mocked: 0 };
            }
            return r;
          })
        );
      }
    } catch (err) {
      setToastMsg({ text: err instanceof Error ? err.message : '关闭 Mock 失败', type: 'error' });
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setDisablingId(null);
    }
  };

  const filteredRequests = requests.filter((req) => {
    if (filters.url) {
      const q = filters.url.toLowerCase();
      const urlMatches = req.url.toLowerCase().includes(q);
      const bodyMatches = req.request_body && req.request_body.toLowerCase().includes(q);
      if (!urlMatches && !bodyMatches) return false;
    }
    if (filters.method && req.method.toUpperCase() !== filters.method.toUpperCase()) return false;
    if (filters.status) {
      if (filters.status === 'mock') {
        if (req.is_mocked !== 1) return false;
      } else {
        const status = req.response_status;
        if (filters.status === '2xx' && !(status && status >= 200 && status < 300)) return false;
        if (filters.status === '4xx' && !(status && status >= 400 && status < 500)) return false;
        if (filters.status === '5xx' && !(status && status >= 500)) return false;
        if (!isNaN(Number(filters.status)) && status !== Number(filters.status)) return false;
      }
    }
    if (filters.sessionId && req.session_id !== filters.sessionId) return false;
    return true;
  });

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const handleClear = async () => {
    setClearLoading(true);
    try {
      await requestsApi.clear();
      setRequests([]);
      setToastMsg({ text: '已清空所有抓包日志', type: 'success' });
      setTimeout(() => setToastMsg((curr) => curr?.text === '已清空所有抓包日志' ? null : curr), 2500);
    } catch (err) {
      setToastMsg({ text: err instanceof Error ? err.message : '清空日志失败', type: 'error' });
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/30">
      {/* Top Search & Filter Bar */}
      <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-900/60">
        {/* Search input & actions */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search URL, path or body..."
              value={filters.url}
              onChange={(e) => setFilter('url', e.target.value)}
              className="w-full bg-slate-800/90 border border-slate-700 text-slate-200 text-xs rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-500"
            />
            {filters.url && (
              <button
                onClick={() => setFilter('url', '')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className={`p-1.5 rounded-lg border transition-colors ${
              showAdvanced || filters.sessionId
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
            title="More filters"
          >
            <Filter size={13} />
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs transition-colors"
              title="Reset all filters"
            >
              Reset
            </button>
          )}

          <button
            onClick={handleClear}
            disabled={clearLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="清空所有日志 (Clear all logs)"
          >
            {clearLoading ? <RefreshCw size={13} className="animate-spin text-red-400" /> : <Trash2 size={13} />}
          </button>
        </div>

        {/* Quick Filter Chips: Method & Status */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
          {/* Method Chips */}
          <div className="flex items-center gap-1">
            {METHOD_CHIPS.map((m) => {
              const val = m === 'ALL' ? '' : m;
              const isSelected = (filters.method || '') === val;
              return (
                <button
                  key={m}
                  onClick={() => setFilter('method', isSelected && val ? '' : val)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                    isSelected
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Status / Mock Chips */}
          <div className="flex items-center gap-1">
            {STATUS_CHIPS.map((s) => {
              const isSelected = (filters.status || '') === s.value;
              return (
                <button
                  key={s.label}
                  onClick={() => setFilter('status', isSelected && s.value ? '' : s.value)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all ${
                    isSelected
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : `bg-slate-800/80 ${s.color || 'text-slate-400'} hover:bg-slate-700 opacity-80 hover:opacity-100`
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced Filter: Devices */}
        {showAdvanced && (
          <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
            <span className="text-[11px] text-slate-500 shrink-0">Device:</span>
            <select
              value={filters.sessionId}
              onChange={(e) => setFilter('sessionId', e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1"
            >
              <option value="">All Devices & Browsers</option>
              {devices.map((d) => (
                <option key={d.session_id} value={d.session_id}>
                  {d.name || d.session_id.slice(0, 8)} {d.is_online ? '● Online' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Toast Notification */}
      {toastMsg && (
        <div className={`px-3 py-1.5 text-xs flex items-center justify-between border-b transition-all ${
          toastMsg.type === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/15 border-red-500/30 text-red-300'
        }`}>
          <span>{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="hover:opacity-75 p-0.5">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Request items count & list */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/40 text-[11px] text-slate-500 border-b border-slate-800/50">
        <span>Showing {filteredRequests.length} of {requests.length} requests</span>
        {hasActiveFilters && <span className="text-cyan-400">Filtered</span>}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-600 text-sm">
            <div className="text-3xl mb-2">📡</div>
            <p className="font-medium text-slate-400">{requests.length === 0 ? 'No requests yet' : 'No matching requests'}</p>
            <p className="text-xs mt-1 text-slate-500">
              {requests.length === 0 ? 'Proxy traffic will appear here in real-time' : 'Try clearing search or filters'}
            </p>
          </div>
        ) : (
          filteredRequests.map((req) => (
            <RequestItem
              key={req.id}
              req={req}
              isSelected={selectedRequestId === req.id}
              isSelectedForDiagnosis={selectedForDiagnosis.includes(req.id)}
              isDisabling={disablingId === req.id}
              onClick={() => onSelectRequest(req.id)}
              onDiagnosisToggle={() => toggleDiagnosisSelection(req.id)}
              onDisableMock={() => handleDisableMock(req)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RequestItemProps {
  req: RequestLog;
  isSelected: boolean;
  isSelectedForDiagnosis: boolean;
  isDisabling?: boolean;
  onClick: () => void;
  onDiagnosisToggle: () => void;
  onDisableMock: () => void;
}

function RequestItem({
  req,
  isSelected,
  isSelectedForDiagnosis,
  isDisabling,
  onClick,
  onDiagnosisToggle,
  onDisableMock,
}: RequestItemProps) {
  const statusColor = getStatusColor(req.response_status);
  const methodColor = getMethodColor(req.method);

  // Extract path from URL
  let displayPath = req.url;
  try {
    const u = new URL(req.url);
    displayPath = u.pathname + u.search;
  } catch {
    displayPath = req.url;
  }

  let isRed = false;
  if (req.response_body) {
    try {
      const parsed = JSON.parse(req.response_body);
      if (parsed && typeof parsed === 'object') {
        let codeValue = undefined;
        if (parsed.data && 'code' in parsed.data) {
          codeValue = parsed.data.code;
        } else if ('code' in parsed) {
          codeValue = parsed.code;
        }

        if (codeValue !== undefined && codeValue !== null) {
          const codeStr = String(codeValue);
          if (codeStr !== '0' && codeStr !== '200') {
            isRed = true;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2 cursor-pointer border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors text-xs border-l-2
        ${isRed
          ? isSelected ? 'bg-red-500/20 border-l-red-500' : 'border-l-red-500/50 bg-red-500/10'
          : isSelected
            ? 'bg-cyan-500/10 border-l-cyan-500'
            : req.is_mocked === 1
              ? 'border-l-emerald-500/70 bg-emerald-500/5'
              : 'border-l-transparent'
        }`}
    >
      {/* Diagnosis checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onDiagnosisToggle(); }}
        className="text-slate-600 hover:text-cyan-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4"
      >
        {isSelectedForDiagnosis ? (
          <CheckSquare size={14} className="text-cyan-400 opacity-100" />
        ) : (
          <Square size={14} />
        )}
      </button>

      {/* Method & Mocked Badge */}
      <div className="flex items-center gap-2 shrink-0 min-w-[70px]">
        <span className={`w-11 text-center px-1 py-0.5 rounded text-[10px] font-bold font-mono ${methodColor}`}>
          {req.method}
        </span>
        {req.is_mocked === 1 && (
          <button
            type="button"
            disabled={isDisabling}
            onClick={(e) => {
              e.stopPropagation();
              onDisableMock();
            }}
            title="点击关闭此 Mock 规则"
            className="group/mock px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 hover:bg-red-500/25 hover:text-red-300 hover:border-red-500/40 border border-emerald-500/30 transition-all shrink-0 flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            {isDisabling ? (
              <RefreshCw size={10} className="animate-spin text-emerald-400" />
            ) : (
              <>
                <span className="group-hover/mock:hidden">MOCK</span>
                <span className="hidden group-hover/mock:inline">关闭</span>
                <X size={10} className="opacity-70 group-hover/mock:opacity-100 group-hover/mock:scale-110 transition-transform" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Path */}
      <div className={`${isRed ? 'text-red-400 font-semibold' : 'text-slate-300'} truncate font-mono text-[12px] flex-1 min-w-0`} title={displayPath}>
        {displayPath}
      </div>

      {/* Trailing details */}
      <div className={`flex items-center gap-4 shrink-0 text-[11px] ${isRed ? 'text-red-400' : ''}`}>
        {req.response_status ? (
          <span className={`w-8 text-center font-mono font-semibold status-${statusColor}`}>
            {req.response_status}
          </span>
        ) : (
          <span className="w-8"></span>
        )}
        
        <span className="w-12 text-slate-500 font-mono text-right">
          {req.duration_ms !== null ? `${req.duration_ms}ms` : '-'}
        </span>
        
        <span className="w-16 text-slate-600 font-mono text-right">
          {new Date(req.created_at).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      </div>
    </div>
  );
}
