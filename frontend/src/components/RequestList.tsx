import { useStore } from '../store/useStore';
import { getStatusColor, getMethodColor } from '../types';
import type { RequestLog } from '../types';
import { Trash2, Filter, X, CheckSquare, Square } from 'lucide-react';
import { useState, useEffect } from 'react';
import { requestsApi } from '../api/client';

interface RequestListProps {
  onSelectRequest: (id: number) => void;
}

const METHOD_OPTIONS = ['', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: '2xx', value: '2xx' },
  { label: '4xx', value: '4xx' },
  { label: '5xx', value: '5xx' },
];

export default function RequestList({ onSelectRequest }: RequestListProps) {
  const {
    requests, selectedRequestId, filters, setFilter, clearFilters,
    selectedForDiagnosis, toggleDiagnosisSelection, devices
  } = useStore();
  const [showFilters, setShowFilters] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const setRequests = useStore((s) => s.setRequests);
  const setDevices = useStore((s) => s.setDevices);

  useEffect(() => {
    // 确保组件挂载时加载设备列表，让下拉框有数据
    import('../api/client').then(({ devicesApi }) => {
      devicesApi.list().then(setDevices).catch(() => {});
    });
  }, [setDevices]);

  const filteredRequests = requests.filter((req) => {
    if (filters.url && !req.url.toLowerCase().includes(filters.url.toLowerCase())) return false;
    if (filters.method && req.method !== filters.method) return false;
    if (filters.status) {
      const status = req.response_status;
      if (filters.status === '2xx' && !(status && status >= 200 && status < 300)) return false;
      if (filters.status === '4xx' && !(status && status >= 400 && status < 500)) return false;
      if (filters.status === '5xx' && !(status && status >= 500)) return false;
      if (!isNaN(Number(filters.status)) && status !== Number(filters.status)) return false;
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
    } finally {
      setClearLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${hasActiveFilters ? 'text-cyan-400' : 'text-slate-400'}`}
          title="Filter"
        >
          <Filter size={14} />
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="p-1.5 rounded hover:bg-slate-700 transition-colors text-slate-400"
            title="Clear filters"
          >
            <X size={14} />
          </button>
        )}
        <button
          onClick={handleClear}
          disabled={clearLoading}
          className="p-1.5 rounded hover:bg-slate-700 transition-colors text-slate-400 hover:text-red-400"
          title="Clear all"
        >
          <Trash2 size={14} />
        </button>
        <div className="flex-1" />
        <span className="text-xs font-medium text-slate-400">
          {filteredRequests.length} requests
        </span>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/50 space-y-2">
          <input
            type="text"
            placeholder="Filter by URL..."
            value={filters.url}
            onChange={(e) => setFilter('url', e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-600"
          />
          <div className="flex gap-2">
            <select
              value={filters.method}
              onChange={(e) => setFilter('method', e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">All Methods</option>
              {METHOD_OPTIONS.filter(Boolean).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <select
              value={filters.sessionId}
              onChange={(e) => setFilter('sessionId', e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">All Devices</option>
              {devices.map((d) => (
                <option key={d.session_id} value={d.session_id}>
                  {d.name || d.session_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Request items */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        {filteredRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-600 text-sm">
            <div className="text-3xl mb-2">📡</div>
            <p>No requests yet</p>
            <p className="text-xs mt-1">Proxy traffic will appear here</p>
          </div>
        ) : (
          filteredRequests.map((req) => (
            <RequestItem
              key={req.id}
              req={req}
              isSelected={selectedRequestId === req.id}
              isSelectedForDiagnosis={selectedForDiagnosis.includes(req.id)}
              onClick={() => onSelectRequest(req.id)}
              onDiagnosisToggle={() => toggleDiagnosisSelection(req.id)}
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
  onClick: () => void;
  onDiagnosisToggle: () => void;
}

function RequestItem({ req, isSelected, isSelectedForDiagnosis, onClick, onDiagnosisToggle }: RequestItemProps) {
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
        // 支持 {"data": {"code": ...}} 或 {"code": ...} 格式
        if (parsed.data && 'code' in parsed.data) {
          codeValue = parsed.data.code;
        } else if ('code' in parsed) {
          codeValue = parsed.code;
        }

        if (codeValue !== undefined && codeValue !== null) {
          const codeStr = String(codeValue);
          // 如果 code 存在，且不等于 0 也不等于 200，则判定为错误（飘红）
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
        ${isSelected
          ? 'bg-cyan-500/10 border-l-cyan-500'
          : req.is_mocked === 1
            ? 'border-l-emerald-500/70 bg-emerald-500/5'
            : isRed
              ? 'border-l-red-500/50 bg-red-500/10'
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
          <span className="px-1 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 shrink-0">
            MOCK
          </span>
        )}
      </div>

      {/* Path - fills remaining space */}
      <div className={`${isRed && !isSelected ? 'text-red-400 font-semibold' : 'text-slate-300'} truncate font-mono text-[12px] flex-1 min-w-0`} title={displayPath}>
        {displayPath}
      </div>

      {/* Trailing details */}
      <div className={`flex items-center gap-4 shrink-0 text-[11px] ${isRed && !isSelected ? 'text-red-400' : ''}`}>
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
