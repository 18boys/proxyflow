import { useEffect, useState, useMemo } from 'react';
import {
  BarChart3, Activity, Users, Zap, Clock,
  Copy, Check, RefreshCw, TrendingUp, FileText, ArrowUpRight
} from 'lucide-react';
import { statsApi } from '../api/client';
import { useStore } from '../store/useStore';
import { getMethodColor, type StatsOverview } from '../types';
import CustomSelect from '../components/CustomSelect';

const RANGE_OPTIONS = [
  { value: '7', label: '最近 7 天' },
  { value: '14', label: '最近 14 天' },
  { value: '30', label: '最近 30 天' },
  { value: '90', label: '最近 90 天' },
  { value: '365', label: '最近 365 天' },
];

export default function AnalyticsPage() {
  const theme = useStore((s) => s.theme);
  const isLight = theme === 'light';

  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [reportFormat, setReportFormat] = useState<'markdown' | 'text'>('markdown');
  const [hoverDayIdx, setHoverDayIdx] = useState<number | null>(null);
  const [visibleLines, setVisibleLines] = useState({
    proxy: true,
    mock: true,
    users: true,
  });

  const loadStats = async (rangeDays = days, isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await statsApi.overview(rangeDays);
      setData(res);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStats(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const peakDay = useMemo(() => {
    if (!data?.daily_trend.length) return null;
    return [...data.daily_trend].sort((a, b) => b.total_requests - a.total_requests)[0];
  }, [data]);

  const reportText = useMemo(() => {
    if (!data) return '';
    const s = data.summary;

    if (reportFormat === 'text') {
      return [
        `【ProxyFlow 运行数据统计报告】`,
        `1. 流量规模：累计运行 ${s.active_days} 天，累计处理请求 ${s.total_requests.toLocaleString()} 次（其中代理转发 ${s.proxied_requests.toLocaleString()} 次，Mock 拦截 ${s.mocked_requests.toLocaleString()} 次，Mock 命中率 ${s.mock_hit_rate}%）。`,
        `2. 用户与设备：累计活跃用户 ${s.total_users} 人，接入调试设备 ${s.total_devices} 台；今日请求 ${s.today_requests.toLocaleString()} 次，今日活跃 ${s.today_users} 人。`,
        `3. 规则与性能：沉淀业务分组 ${s.total_folders} 个、Mock 规则 ${s.total_mock_rules} 条（${s.total_mock_versions} 个响应版本）；真实代理平均耗时 ${s.avg_proxy_duration_ms}ms，Mock 响应平均耗时 ${s.avg_mock_duration_ms}ms。`,
      ].join('\n');
    }

    return [
      `### ProxyFlow 运行数据统计报告`,
      ``,
      `- **累计转发与拦截**：共处理请求 **${s.total_requests.toLocaleString()}** 次（代理转发 **${s.proxied_requests.toLocaleString()}** 次，Mock 命中 **${s.mocked_requests.toLocaleString()}** 次，Mock 命中率 **${s.mock_hit_rate}%**）`,
      `- **活跃用户与设备**：累计使用人数 **${s.total_users}** 人，接入终端设备 **${s.total_devices}** 台（累计活跃 **${s.active_days}** 天，单日峰值 **${peakDay?.total_requests.toLocaleString() || s.today_requests.toLocaleString()}** 次）`,
      `- **规则沉淀与耗时**：已配置 **${s.total_mock_rules}** 条 Mock 规则（**${s.total_mock_versions}** 个版本），代理平均响应 **${s.avg_proxy_duration_ms} ms**，Mock 平均响应 **${s.avg_mock_duration_ms} ms**`,
    ].join('\n');
  }, [data, reportFormat, peakDay]);

  const handleCopyReport = () => {
    if (!reportText) return;
    navigator.clipboard.writeText(reportText);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // Line chart geometry calculations
  const chartGeometry = useMemo(() => {
    const trend = data?.daily_trend || [];
    const width = 860;
    const height = 240;
    const padLeft = 44;
    const padRight = 40;
    const padTop = 20;
    const padBottom = 32;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxReq = Math.max(
      10,
      ...trend.map((d) => Math.max(d.proxied_requests, d.mocked_requests, 1))
    );
    // Round up maxReq to a clean number
    const cleanMaxReq = Math.ceil(maxReq / 10) * 10;

    const maxUsers = Math.max(4, ...trend.map((d) => d.active_users));
    const cleanMaxUsers = Math.ceil(maxUsers / 2) * 2;

    const n = trend.length;
    const getX = (i: number) => (n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW);
    const getYReq = (val: number) => padTop + plotH - (val / cleanMaxReq) * plotH;
    const getYUser = (val: number) => padTop + plotH - (val / cleanMaxUsers) * plotH;

    const proxyPoints = trend.map((d, i) => ({ x: getX(i), y: getYReq(d.proxied_requests), val: d.proxied_requests }));
    const mockPoints = trend.map((d, i) => ({ x: getX(i), y: getYReq(d.mocked_requests), val: d.mocked_requests }));
    const userPoints = trend.map((d, i) => ({ x: getX(i), y: getYUser(d.active_users), val: d.active_users }));

    const toPolyline = (pts: Array<{ x: number; y: number }>) =>
      pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const toArea = (pts: Array<{ x: number; y: number }>) => {
      if (pts.length === 0) return '';
      const baseline = padTop + plotH;
      return `M ${pts[0].x.toFixed(1)},${baseline} L ` +
        pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ') +
        ` L ${pts[pts.length - 1].x.toFixed(1)},${baseline} Z`;
    };

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      cleanMaxReq,
      cleanMaxUsers,
      proxyPoints,
      mockPoints,
      userPoints,
      proxyLine: toPolyline(proxyPoints),
      mockLine: toPolyline(mockPoints),
      userLine: toPolyline(userPoints),
      proxyArea: toArea(proxyPoints),
      mockArea: toArea(mockPoints),
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-xs text-slate-400">正在加载统计数据...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { summary } = data;
  const hoveredDay = hoverDayIdx !== null ? data.daily_trend[hoverDayIdx] : null;

  return (
    <div className="h-full overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-slate-900/90 border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-sm">
              <BarChart3 size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 tracking-tight">数据统计 (Analytics)</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                记录每日代理转发、Mock 拦截命中与活跃使用人数变化趋势
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-40">
              <CustomSelect
                size="sm"
                value={String(days)}
                onChange={(v) => setDays(Number(v))}
                options={RANGE_OPTIONS}
              />
            </div>
            <button
              onClick={() => loadStats(days, true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin text-cyan-400' : ''} />
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* 1. Core 4 KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Requests */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">累计请求转发总量</span>
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400">
                <Activity size={16} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-slate-100">
                {summary.total_requests.toLocaleString()}
              </span>
              <span className="text-xs text-cyan-400 font-medium flex items-center gap-0.5">
                <ArrowUpRight size={12} />
                今日 +{summary.today_requests.toLocaleString()}
              </span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>代理透传: <strong className="text-slate-200 font-mono">{summary.proxied_requests.toLocaleString()}</strong></span>
              <span>单日峰值: <strong className="text-slate-200 font-mono">{peakDay?.total_requests.toLocaleString() || 0}</strong></span>
            </div>
          </div>

          {/* Card 2: Mock Hits */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">Mock 拦截命中数</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                <Zap size={16} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-slate-100">
                {summary.mocked_requests.toLocaleString()}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs font-mono font-semibold">
                {summary.mock_hit_rate}% 命中率
              </span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>开启规则: <strong className="text-emerald-400 font-mono">{summary.active_mock_rules}</strong> / {summary.total_mock_rules} 条</span>
              <span>多场景版本: <strong className="text-slate-200 font-mono">{summary.total_mock_versions}</strong> 个</span>
            </div>
          </div>

          {/* Card 3: Active Users & Devices */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">使用人数与终端设备</span>
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-400">
                <Users size={16} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-slate-100">
                {summary.total_users} <span className="text-xs font-normal text-slate-400">人</span>
              </span>
              <span className="text-slate-500">/</span>
              <span className="text-xl font-bold font-mono text-slate-200">
                {summary.total_devices} <span className="text-xs font-normal text-slate-400">台设备</span>
              </span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>今日活跃人数: <strong className="text-amber-400 font-mono">{summary.today_users} 人</strong></span>
              <span>今日活跃设备: <strong className="text-slate-200 font-mono">{summary.today_devices} 台</strong></span>
            </div>
          </div>

          {/* Card 4: Avg Response Time & Active Days */}
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-400">平均响应耗时对比</span>
              <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/25 flex items-center justify-center text-purple-400">
                <Clock size={16} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {summary.avg_mock_duration_ms} <span className="text-xs font-normal text-slate-400">ms (Mock)</span>
              </span>
              <span className="text-xs text-slate-400 font-mono">
                vs {summary.avg_proxy_duration_ms}ms
              </span>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>累计活跃天数: <strong className="text-slate-200 font-mono">{summary.active_days} 天</strong></span>
              <span>业务分组: <strong className="text-slate-200 font-mono">{summary.total_folders} 个</strong></span>
            </div>
          </div>
        </div>

        {/* 2. Multi-Line Trend Chart: Daily Proxy, Mock, and Active Users */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <TrendingUp size={15} className="text-cyan-400" />
                每日代理转发、Mock 拦截与活跃人数变化趋势 ({days} 天)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                左轴为每日请求次数（代理转发 / Mock 拦截），右轴为每日活跃使用人数（点击图例可显示/隐藏曲线）
              </p>
            </div>

            {/* Interactive Legend */}
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setVisibleLines((s) => ({ ...s, proxy: !s.proxy }))}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                  visibleLines.proxy
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-slate-200'
                    : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-60'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
                代理转发 (次)
              </button>
              <button
                type="button"
                onClick={() => setVisibleLines((s) => ({ ...s, mock: !s.mock }))}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                  visibleLines.mock
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-200'
                    : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-60'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                Mock 拦截 (次)
              </button>
              <button
                type="button"
                onClick={() => setVisibleLines((s) => ({ ...s, users: !s.users }))}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                  visibleLines.users
                    ? 'bg-amber-500/10 border-amber-500/30 text-slate-200'
                    : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-60'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                活跃人数 (人)
              </button>
            </div>
          </div>

          {/* Hover Detail Banner */}
          <div className="h-8 mb-3 px-3 rounded-lg bg-slate-800/70 border border-slate-700/70 flex items-center justify-between text-xs">
            {hoveredDay ? (
              <>
                <span className="font-mono font-semibold text-slate-200">日期: {hoveredDay.day}</span>
                <div className="flex items-center gap-5">
                  <span className="text-slate-300">总请求: <strong className="font-mono text-slate-100">{hoveredDay.total_requests}</strong></span>
                  <span className="text-slate-300">代理转发: <strong className="font-mono text-cyan-400">{hoveredDay.proxied_requests} 次</strong></span>
                  <span className="text-slate-300">Mock 拦截: <strong className="font-mono text-emerald-400">{hoveredDay.mocked_requests} 次</strong></span>
                  <span className="text-slate-300">活跃人数: <strong className="font-mono text-amber-400">{hoveredDay.active_users} 人</strong> ({hoveredDay.active_devices} 台设备)</span>
                </div>
              </>
            ) : (
              <span className="text-slate-400">
                鼠标移入折线图节点查看当日明细 · 峰值日 <strong className="text-slate-200 font-mono">{peakDay?.day || '-'}</strong>（共 <strong className="text-cyan-400 font-mono">{peakDay?.total_requests || 0}</strong> 次请求，活跃 <strong className="text-amber-400 font-mono">{peakDay?.active_users || 0}</strong> 人）
              </span>
            )}
          </div>

          {/* SVG Line Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
              className="w-full h-60 select-none overflow-visible"
              onMouseLeave={() => setHoverDayIdx(null)}
            >
              <defs>
                <linearGradient id="proxyAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="mockAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines & Dual Y-Axis Labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = chartGeometry.padTop + chartGeometry.plotH * (1 - ratio);
                const leftVal = Math.round(chartGeometry.cleanMaxReq * ratio);
                const rightVal = Math.round(chartGeometry.cleanMaxUsers * ratio);
                return (
                  <g key={idx}>
                    <line
                      x1={chartGeometry.padLeft}
                      y1={y}
                      x2={chartGeometry.width - chartGeometry.padRight}
                      y2={y}
                      stroke={isLight ? '#e2e8f0' : '#1e293b'}
                      strokeDasharray={idx === 0 ? undefined : '4 4'}
                      strokeWidth="1"
                    />
                    <text
                      x={chartGeometry.padLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="text-[10px] font-mono fill-slate-500"
                    >
                      {leftVal}
                    </text>
                    <text
                      x={chartGeometry.width - chartGeometry.padRight + 8}
                      y={y + 3}
                      textAnchor="start"
                      className="text-[10px] font-mono fill-amber-500/80"
                    >
                      {rightVal}人
                    </text>
                  </g>
                );
              })}

              {/* Area Fills */}
              {visibleLines.proxy && chartGeometry.proxyArea && (
                <path d={chartGeometry.proxyArea} fill="url(#proxyAreaGrad)" />
              )}
              {visibleLines.mock && chartGeometry.mockArea && (
                <path d={chartGeometry.mockArea} fill="url(#mockAreaGrad)" />
              )}

              {/* Lines */}
              {visibleLines.proxy && chartGeometry.proxyLine && (
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={chartGeometry.proxyLine}
                />
              )}
              {visibleLines.mock && chartGeometry.mockLine && (
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={chartGeometry.mockLine}
                />
              )}
              {visibleLines.users && chartGeometry.userLine && (
                <polyline
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={chartGeometry.userLine}
                />
              )}

              {/* Hover Crosshair Line */}
              {hoverDayIdx !== null && chartGeometry.proxyPoints[hoverDayIdx] && (
                <line
                  x1={chartGeometry.proxyPoints[hoverDayIdx].x}
                  y1={chartGeometry.padTop}
                  x2={chartGeometry.proxyPoints[hoverDayIdx].x}
                  y2={chartGeometry.padTop + chartGeometry.plotH}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}

              {/* Data Points + Invisible Hover Columns */}
              {data.daily_trend.map((d, i) => {
                const px = chartGeometry.proxyPoints[i]?.x || 0;
                const pyProxy = chartGeometry.proxyPoints[i]?.y || 0;
                const pyMock = chartGeometry.mockPoints[i]?.y || 0;
                const pyUser = chartGeometry.userPoints[i]?.y || 0;
                const isHovered = hoverDayIdx === i;
                const colWidth = chartGeometry.plotW / Math.max(1, data.daily_trend.length);

                const showXLabel =
                  data.daily_trend.length <= 14 ||
                  i % Math.ceil(data.daily_trend.length / 8) === 0 ||
                  i === data.daily_trend.length - 1;

                return (
                  <g key={d.day}>
                    {visibleLines.proxy && (
                      <circle
                        cx={px}
                        cy={pyProxy}
                        r={isHovered ? 4.5 : 2.8}
                        fill="#06b6d4"
                        stroke={isLight ? '#ffffff' : '#0f172a'}
                        strokeWidth="1.5"
                      />
                    )}
                    {visibleLines.mock && (
                      <circle
                        cx={px}
                        cy={pyMock}
                        r={isHovered ? 4.5 : 2.8}
                        fill="#10b981"
                        stroke={isLight ? '#ffffff' : '#0f172a'}
                        strokeWidth="1.5"
                      />
                    )}
                    {visibleLines.users && (
                      <circle
                        cx={px}
                        cy={pyUser}
                        r={isHovered ? 4.5 : 2.8}
                        fill="#f59e0b"
                        stroke={isLight ? '#ffffff' : '#0f172a'}
                        strokeWidth="1.5"
                      />
                    )}

                    {showXLabel && (
                      <text
                        x={px}
                        y={chartGeometry.height - 8}
                        textAnchor="middle"
                        className={`text-[10px] font-mono ${
                          isHovered ? 'fill-cyan-400 font-bold' : 'fill-slate-500'
                        }`}
                      >
                        {d.day.slice(5)}
                      </text>
                    )}

                    {/* Hover Trigger Column */}
                    <rect
                      x={px - colWidth / 2}
                      y={chartGeometry.padTop}
                      width={colWidth}
                      height={chartGeometry.plotH}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverDayIdx(i)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* 3. Top Endpoints & Team Leaderboard (Side by Side) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Top 10 Endpoints (7 cols) */}
          <div className="lg:col-span-7 rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-100">高频接口统计 Top 10</h2>
              <p className="text-xs text-slate-400 mt-0.5">按请求转发量排序，展示各接口的 Mock 命中次数与平均耗时</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 pr-3 font-medium">接口路径</th>
                    <th className="py-2 px-2 font-medium text-right">总请求数</th>
                    <th className="py-2 px-2 font-medium text-right">Mock 命中</th>
                    <th className="py-2 pl-2 font-medium text-right">平均耗时</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {data.top_endpoints.map((ep, idx) => {
                    const hitRate = ep.total_hits > 0 ? Math.round((ep.mocked_hits / ep.total_hits) * 100) : 0;
                    return (
                      <tr key={`${ep.method}-${ep.endpoint}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 pr-3 max-w-[260px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${getMethodColor(ep.method)}`}>
                              {ep.method}
                            </span>
                            <span className="font-mono text-slate-200 truncate" title={ep.endpoint}>
                              {ep.endpoint}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-200">
                          {ep.total_hits.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono">
                          {ep.mocked_hits > 0 ? (
                            <span className="text-emerald-400">
                              {ep.mocked_hits} <span className="text-[10px] text-slate-400">({hitRate}%)</span>
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-2 text-right font-mono text-slate-300">
                          {ep.avg_ms ?? 0} ms
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* User Activity Table (5 cols) */}
          <div className="lg:col-span-5 rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-sm font-bold text-slate-100">用户活跃与规则明细</h2>
              <p className="text-xs text-slate-400 mt-0.5">各账号累计转发请求数、Mock 命中数与规则配置数</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 pr-2 font-medium">账号</th>
                    <th className="py-2 px-2 font-medium text-right">请求数</th>
                    <th className="py-2 px-2 font-medium text-right">Mock 数</th>
                    <th className="py-2 pl-2 font-medium text-right">规则数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {data.user_leaderboard.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 pr-2 font-medium text-slate-200 truncate max-w-[160px]" title={u.email}>
                        {u.email}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-semibold text-cyan-400">
                        {u.request_count.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-400">
                        {(u.mocked_count || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono text-slate-300">
                        {u.mock_rules_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 4. Generate Statistical Report */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400">
                <FileText size={16} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">生成统计报告</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  汇总当前平台请求转发量、活跃人数、Mock 覆盖率与响应耗时数据
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-700 text-xs">
                <button
                  onClick={() => setReportFormat('markdown')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    reportFormat === 'markdown'
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Markdown
                </button>
                <button
                  onClick={() => setReportFormat('text')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    reportFormat === 'text'
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  纯文本摘要
                </button>
              </div>

              <button
                onClick={handleCopyReport}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium transition-colors shadow-sm"
              >
                {copiedReport ? <Check size={13} /> : <Copy size={13} />}
                {copiedReport ? '已复制' : '复制统计报告'}
              </button>
            </div>
          </div>

          <pre
            className={`p-4 rounded-xl border text-xs font-mono leading-relaxed whitespace-pre-wrap select-all overflow-x-auto ${
              isLight
                ? 'bg-slate-50 border-slate-200 text-slate-800'
                : 'bg-slate-950/80 border-slate-800 text-slate-200'
            }`}
          >
            {reportText}
          </pre>
        </div>
      </div>
    </div>
  );
}
