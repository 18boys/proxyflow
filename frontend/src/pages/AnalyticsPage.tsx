import { useEffect, useState, useMemo, useRef } from 'react';
import {
  BarChart3, Activity, Users, Zap, Clock,
  Copy, Check, RefreshCw, TrendingUp, FileText, ArrowUpRight,
  Search, ChevronLeft, ChevronRight
} from 'lucide-react';
import { statsApi } from '../api/client';
import { useStore } from '../store/useStore';
import type { StatsOverview } from '../types';
import CustomSelect from '../components/CustomSelect';

const RANGE_OPTIONS = [
  { value: '7', label: '最近 7 天' },
  { value: '14', label: '最近 14 天' },
  { value: '30', label: '最近 30 天' },
  { value: '90', label: '最近 90 天' },
  { value: '365', label: '最近 365 天' },
];

function formatRelativeActive(dateStr: string | null): { label: string; isRecent: boolean } {
  if (!dateStr) return { label: '暂无记录', isRecent: false };
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + '+08:00';
  const target = new Date(normalized).getTime();
  if (Number.isNaN(target)) return { label: '', isRecent: false };
  const diffMin = Math.max(0, Math.floor((Date.now() - target) / 60000));
  if (diffMin < 5) return { label: '刚刚', isRecent: true };
  if (diffMin < 60) return { label: `${diffMin} 分钟前`, isRecent: true };
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return { label: `${diffHours} 小时前`, isRecent: true };
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays <= 7) return { label: `${diffDays} 天前`, isRecent: false };
  return { label: '', isRecent: false };
}

/**
 * Generates a smooth monotone cubic bezier SVG path through the given points
 * so the curve never overshoots below baseline or above peaks.
 */
function buildSmoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cpx1 = p0.x + (p1.x - p0.x) * 0.42;
    const cpx2 = p1.x - (p1.x - p0.x) * 0.42;
    d += ` C ${cpx1.toFixed(1)},${p0.y.toFixed(1)} ${cpx2.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}

function buildSmoothArea(pts: Array<{ x: number; y: number }>, baselineY: number): string {
  if (pts.length === 0) return '';
  const linePath = buildSmoothPath(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${linePath} L ${last.x.toFixed(1)},${baselineY.toFixed(1)} L ${first.x.toFixed(1)},${baselineY.toFixed(1)} Z`;
}

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
  const [chartMode, setChartMode] = useState<'area' | 'bar'>('area');
  const [visibleSeries, setVisibleSeries] = useState({
    proxy: true,
    mock: true,
    users: true,
  });
  const [userSearch, setUserSearch] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);

  // Measure exact pixel width of chart container for 1:1 crisp SVG rendering
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState<number>(960);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 200) setChartWidth(el.clientWidth);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

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

  const periodStats = useMemo(() => {
    const trend = data?.daily_trend || [];
    const totalReq = trend.reduce((acc, d) => acc + d.total_requests, 0);
    const totalProxy = trend.reduce((acc, d) => acc + d.proxied_requests, 0);
    const totalMock = trend.reduce((acc, d) => acc + d.mocked_requests, 0);
    const activeDaysInPeriod = trend.filter((d) => d.total_requests > 0).length;
    const avgDaily = activeDaysInPeriod > 0 ? Math.round(totalReq / activeDaysInPeriod) : 0;
    return { totalReq, totalProxy, totalMock, avgDaily, activeDaysInPeriod };
  }, [data]);

  const filteredUsers = useMemo(() => {
    const list = data?.user_leaderboard || [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => u.email.toLowerCase().includes(q));
  }, [data, userSearch]);

  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / userPageSize));
  const currentUserPage = Math.min(userPage, totalUserPages);
  const paginatedUsers = useMemo(() => {
    const start = (currentUserPage - 1) * userPageSize;
    return filteredUsers.slice(start, start + userPageSize);
  }, [filteredUsers, currentUserPage, userPageSize]);

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

  // 1:1 Pixel-Perfect Chart Geometry
  const chartGeometry = useMemo(() => {
    const trend = data?.daily_trend || [];
    const width = Math.max(360, chartWidth);
    const height = 280;
    const padLeft = 46;
    const padRight = 44;
    const padTop = 24;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const baselineY = padTop + plotH;

    const maxReqRaw = Math.max(
      10,
      ...trend.map((d) =>
        chartMode === 'bar'
          ? d.total_requests
          : Math.max(
              visibleSeries.proxy ? d.proxied_requests : 0,
              visibleSeries.mock ? d.mocked_requests : 0,
              4
            )
      )
    );
    const stepReq = maxReqRaw <= 20 ? 5 : maxReqRaw <= 60 ? 15 : maxReqRaw <= 120 ? 25 : 50;
    const cleanMaxReq = Math.ceil(maxReqRaw / stepReq) * stepReq;

    const maxUsersRaw = Math.max(4, ...trend.map((d) => d.active_users));
    const cleanMaxUsers = Math.max(4, Math.ceil(maxUsersRaw / 2) * 2);

    const n = trend.length;
    const getX = (i: number) =>
      n <= 1 ? padLeft + plotW / 2 : padLeft + (i / (n - 1)) * plotW;
    const getYReq = (val: number) => baselineY - (val / cleanMaxReq) * plotH;
    const getYUser = (val: number) => baselineY - (val / cleanMaxUsers) * plotH;

    const proxyPoints = trend.map((d, i) => ({
      x: getX(i),
      y: getYReq(d.proxied_requests),
      val: d.proxied_requests,
    }));
    const mockPoints = trend.map((d, i) => ({
      x: getX(i),
      y: getYReq(d.mocked_requests),
      val: d.mocked_requests,
    }));
    const userPoints = trend.map((d, i) => ({
      x: getX(i),
      y: getYUser(d.active_users),
      val: d.active_users,
    }));

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      plotW,
      plotH,
      baselineY,
      cleanMaxReq,
      cleanMaxUsers,
      proxyPoints,
      mockPoints,
      userPoints,
      proxyPath: buildSmoothPath(proxyPoints),
      mockPath: buildSmoothPath(mockPoints),
      userPath: buildSmoothPath(userPoints),
      proxyArea: buildSmoothArea(proxyPoints, baselineY),
      mockArea: buildSmoothArea(mockPoints, baselineY),
      userArea: buildSmoothArea(userPoints, baselineY),
    };
  }, [data, chartWidth, chartMode, visibleSeries.proxy, visibleSeries.mock]);

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
  const hoveredX = hoverDayIdx !== null ? chartGeometry.proxyPoints[hoverDayIdx]?.x ?? 0 : 0;

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

        {/* 2. Upgraded Smooth Area & Bar Trend Chart */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          {/* Top Bar: Title + Series Toggles + Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <TrendingUp size={15} className="text-cyan-400" />
                每日流量与活跃人数趋势 ({days} 天)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                左轴：每日代理转发与 Mock 拦截次数 · 右轴：每日活跃人数
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Interactive Series Pills */}
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setVisibleSeries((s) => ({ ...s, proxy: !s.proxy }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                    visibleSeries.proxy
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-slate-200'
                      : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block shadow-[0_0_6px_#22d3ee]" />
                  <span>代理转发</span>
                  <span className="font-mono text-[11px] text-cyan-400 font-semibold ml-0.5">
                    {periodStats.totalProxy.toLocaleString()}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setVisibleSeries((s) => ({ ...s, mock: !s.mock }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                    visibleSeries.mock
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-200'
                      : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shadow-[0_0_6px_#34d399]" />
                  <span>Mock 拦截</span>
                  <span className="font-mono text-[11px] text-emerald-400 font-semibold ml-0.5">
                    {periodStats.totalMock.toLocaleString()}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setVisibleSeries((s) => ({ ...s, users: !s.users }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                    visibleSeries.users
                      ? 'bg-violet-500/10 border-violet-500/30 text-slate-200'
                      : 'bg-slate-800/40 border-slate-800 text-slate-500 opacity-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-violet-400 inline-block shadow-[0_0_6px_#a78bfa]" />
                  <span>活跃人数</span>
                </button>
              </div>

              {/* Chart Mode Switcher: Smooth Curve vs Stacked Bar */}
              <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-700/80 text-xs">
                <button
                  type="button"
                  onClick={() => setChartMode('area')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    chartMode === 'area'
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  平滑曲线
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode('bar')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    chartMode === 'bar'
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  柱状对比
                </button>
              </div>
            </div>
          </div>

          {/* Interactive SVG Chart Canvas + Floating Tooltip */}
          <div ref={chartContainerRef} className="relative w-full select-none">
            <svg
              width={chartGeometry.width}
              height={chartGeometry.height}
              viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
              className="block w-full overflow-visible"
              onMouseLeave={() => setHoverDayIdx(null)}
            >
              <defs>
                <linearGradient id="pfProxyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={isLight ? '0.24' : '0.32'} />
                  <stop offset="65%" stopColor="#06b6d4" stopOpacity={isLight ? '0.06' : '0.08'} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="pfMockGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={isLight ? '0.24' : '0.30'} />
                  <stop offset="65%" stopColor="#10b981" stopOpacity={isLight ? '0.06' : '0.07'} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="pfUserGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={isLight ? '0.12' : '0.15'} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines & Dual Y-Axis Labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = Math.round(chartGeometry.padTop + chartGeometry.plotH * (1 - ratio)) + 0.5;
                const leftVal = Math.round(chartGeometry.cleanMaxReq * ratio);
                const rightVal = Math.round(chartGeometry.cleanMaxUsers * ratio);
                return (
                  <g key={idx}>
                    <line
                      x1={chartGeometry.padLeft}
                      y1={y}
                      x2={chartGeometry.width - chartGeometry.padRight}
                      y2={y}
                      stroke={
                        idx === 0
                          ? isLight ? '#cbd5e1' : '#334155'
                          : isLight ? '#f1f5f9' : '#1e293b'
                      }
                      strokeDasharray={idx === 0 ? undefined : '3 3'}
                      strokeWidth="1"
                    />
                    <text
                      x={chartGeometry.padLeft - 10}
                      y={y + 3.5}
                      textAnchor="end"
                      fill={isLight ? '#64748b' : '#64748b'}
                      fontSize="11"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {leftVal}
                    </text>
                    {visibleSeries.users && (
                      <text
                        x={chartGeometry.width - chartGeometry.padRight + 10}
                        y={y + 3.5}
                        textAnchor="start"
                        fill={isLight ? '#7c3aed' : '#a78bfa'}
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {rightVal}人
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Hover Vertical Highlight Band */}
              {hoverDayIdx !== null && chartGeometry.proxyPoints[hoverDayIdx] && (
                <g>
                  <rect
                    x={
                      chartGeometry.proxyPoints[hoverDayIdx].x -
                      Math.min(18, chartGeometry.plotW / Math.max(2, data.daily_trend.length * 2))
                    }
                    y={chartGeometry.padTop}
                    width={Math.min(36, chartGeometry.plotW / Math.max(1, data.daily_trend.length))}
                    height={chartGeometry.plotH}
                    rx="6"
                    fill={isLight ? 'rgba(6, 182, 212, 0.06)' : 'rgba(6, 182, 212, 0.07)'}
                  />
                  <line
                    x1={chartGeometry.proxyPoints[hoverDayIdx].x}
                    y1={chartGeometry.padTop}
                    x2={chartGeometry.proxyPoints[hoverDayIdx].x}
                    y2={chartGeometry.baselineY}
                    stroke={isLight ? '#0891b2' : '#22d3ee'}
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.75"
                  />
                </g>
              )}

              {/* Mode A: Smooth Area Curves */}
              {chartMode === 'area' && (
                <>
                  {visibleSeries.users && chartGeometry.userArea && (
                    <path d={chartGeometry.userArea} fill="url(#pfUserGrad)" />
                  )}
                  {visibleSeries.proxy && chartGeometry.proxyArea && (
                    <path d={chartGeometry.proxyArea} fill="url(#pfProxyGrad)" />
                  )}
                  {visibleSeries.mock && chartGeometry.mockArea && (
                    <path d={chartGeometry.mockArea} fill="url(#pfMockGrad)" />
                  )}

                  {visibleSeries.proxy && chartGeometry.proxyPath && (
                    <path
                      d={chartGeometry.proxyPath}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {visibleSeries.mock && chartGeometry.mockPath && (
                    <path
                      d={chartGeometry.mockPath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {visibleSeries.users && chartGeometry.userPath && (
                    <path
                      d={chartGeometry.userPath}
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="2"
                      strokeDasharray="5 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </>
              )}

              {/* Mode B: Stacked Bars + Active Users Curve */}
              {chartMode === 'bar' && (
                <>
                  {data.daily_trend.map((d, i) => {
                    const cx = chartGeometry.proxyPoints[i]?.x || 0;
                    const barW = Math.max(
                      6,
                      Math.min(26, Math.floor((chartGeometry.plotW / Math.max(1, data.daily_trend.length)) * 0.58))
                    );
                    const proxyVal = visibleSeries.proxy ? d.proxied_requests : 0;
                    const mockVal = visibleSeries.mock ? d.mocked_requests : 0;
                    const totalVal = proxyVal + mockVal;
                    const totalH = (totalVal / chartGeometry.cleanMaxReq) * chartGeometry.plotH;
                    const proxyH = (proxyVal / chartGeometry.cleanMaxReq) * chartGeometry.plotH;
                    const mockH = (mockVal / chartGeometry.cleanMaxReq) * chartGeometry.plotH;
                    const isHovered = hoverDayIdx === i;

                    return (
                      <g key={d.day} opacity={hoverDayIdx !== null && !isHovered ? 0.65 : 1}>
                        {proxyH > 0 && (
                          <rect
                            x={cx - barW / 2}
                            y={chartGeometry.baselineY - proxyH}
                            width={barW}
                            height={Math.max(2, proxyH)}
                            rx={mockH === 0 ? 4 : 0}
                            fill="#06b6d4"
                          />
                        )}
                        {mockH > 0 && (
                          <rect
                            x={cx - barW / 2}
                            y={chartGeometry.baselineY - totalH}
                            width={barW}
                            height={Math.max(2, mockH)}
                            rx={3}
                            fill="#10b981"
                          />
                        )}
                      </g>
                    );
                  })}
                  {visibleSeries.users && chartGeometry.userPath && (
                    <path
                      d={chartGeometry.userPath}
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </>
              )}

              {/* Active Hover Nodes + X-Axis Labels + Invisible Hover Columns */}
              {data.daily_trend.map((d, i) => {
                const px = chartGeometry.proxyPoints[i]?.x || 0;
                const pyProxy = chartGeometry.proxyPoints[i]?.y || 0;
                const pyMock = chartGeometry.mockPoints[i]?.y || 0;
                const pyUser = chartGeometry.userPoints[i]?.y || 0;
                const isHovered = hoverDayIdx === i;
                const isPeak = peakDay && d.day === peakDay.day && d.total_requests > 0;
                const colWidth = chartGeometry.plotW / Math.max(1, data.daily_trend.length - 1 || 1);

                const labelStep =
                  data.daily_trend.length <= 10
                    ? 1
                    : data.daily_trend.length <= 16
                      ? 2
                      : Math.ceil(data.daily_trend.length / 8);
                const showXLabel = i % labelStep === 0 || i === data.daily_trend.length - 1;

                return (
                  <g key={d.day}>
                    {/* Show glowing dots on hover (or subtle dots when <= 14 days) */}
                    {(isHovered || (chartMode === 'area' && data.daily_trend.length <= 14 && d.total_requests > 0)) && (
                      <>
                        {visibleSeries.proxy && (
                          <circle
                            cx={px}
                            cy={pyProxy}
                            r={isHovered ? 5 : 3}
                            fill="#06b6d4"
                            stroke={isLight ? '#ffffff' : '#0f172a'}
                            strokeWidth={isHovered ? 2 : 1.5}
                          />
                        )}
                        {visibleSeries.mock && (
                          <circle
                            cx={px}
                            cy={pyMock}
                            r={isHovered ? 5 : 3}
                            fill="#10b981"
                            stroke={isLight ? '#ffffff' : '#0f172a'}
                            strokeWidth={isHovered ? 2 : 1.5}
                          />
                        )}
                        {visibleSeries.users && (
                          <circle
                            cx={px}
                            cy={pyUser}
                            r={isHovered ? 5 : 2.5}
                            fill="#8b5cf6"
                            stroke={isLight ? '#ffffff' : '#0f172a'}
                            strokeWidth={isHovered ? 2 : 1.5}
                          />
                        )}
                      </>
                    )}

                    {/* Peak Day Crown Tag */}
                    {isPeak && !isHovered && visibleSeries.proxy && (
                      <g transform={`translate(${px}, ${Math.max(14, Math.min(pyProxy, pyMock) - 10)})`}>
                        <text
                          x="0"
                          y="0"
                          textAnchor="middle"
                          fill={isLight ? '#0891b2' : '#22d3ee'}
                          fontSize="10"
                          fontWeight="600"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          峰值 {d.total_requests}
                        </text>
                      </g>
                    )}

                    {/* X-Axis Date Label */}
                    {showXLabel && (
                      <text
                        x={px}
                        y={chartGeometry.height - 8}
                        textAnchor="middle"
                        fill={
                          isHovered
                            ? isLight ? '#0891b2' : '#22d3ee'
                            : isLight ? '#64748b' : '#64748b'
                        }
                        fontWeight={isHovered ? '700' : '400'}
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {d.day.slice(5)}
                      </text>
                    )}

                    {/* Full-Height Hit Target for Smooth Hover */}
                    <rect
                      x={px - colWidth / 2}
                      y={chartGeometry.padTop}
                      width={colWidth}
                      height={chartGeometry.plotH + 24}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverDayIdx(i)}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Floating Glassmorphic Tooltip */}
            {hoveredDay && (
              <div
                style={{
                  left:
                    hoveredX > chartGeometry.width * 0.62
                      ? Math.max(12, hoveredX - 215)
                      : Math.min(chartGeometry.width - 215, hoveredX + 16),
                  top: 12,
                }}
                className={`pointer-events-none absolute z-10 w-52 rounded-xl backdrop-blur-md border p-3 text-xs space-y-2 transition-all duration-75 ${
                  isLight
                    ? 'bg-white/95 border-slate-200 shadow-lg shadow-slate-900/10'
                    : 'bg-slate-900/95 border-slate-700/80 shadow-xl'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                  <span className="font-mono font-bold text-slate-100">{hoveredDay.day}</span>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-mono text-[10px] font-semibold">
                    共 {hoveredDay.total_requests} 次
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      代理转发
                    </span>
                    <span className="font-mono font-semibold text-cyan-400">
                      {hoveredDay.proxied_requests} 次
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Mock 拦截
                    </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {hoveredDay.mocked_requests} 次
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <span className="w-2 h-2 rounded-full bg-violet-400" />
                      活跃人数
                    </span>
                    <span className="font-mono font-semibold text-violet-400">
                      {hoveredDay.active_users} 人 <span className="text-slate-400 font-normal">({hoveredDay.active_devices} 设备)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <span>当日平均耗时</span>
                    <span className="font-mono text-slate-200">{hoveredDay.avg_duration_ms} ms</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Period Summary Strip */}
          <div className="mt-4 pt-3.5 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="flex items-center justify-between sm:justify-start sm:gap-2">
              <span className="text-slate-400">周期内总请求:</span>
              <strong className="font-mono text-slate-100">{periodStats.totalReq.toLocaleString()} 次</strong>
            </div>
            <div className="flex items-center justify-between sm:justify-start sm:gap-2">
              <span className="text-slate-400">日均处理请求:</span>
              <strong className="font-mono text-cyan-400">{periodStats.avgDaily.toLocaleString()} 次/天</strong>
            </div>
            <div className="flex items-center justify-between sm:justify-start sm:gap-2">
              <span className="text-slate-400">单日最高峰值:</span>
              <strong className="font-mono text-emerald-400">
                {peakDay?.total_requests.toLocaleString() || 0} 次 ({peakDay?.day.slice(5) || '-'})
              </strong>
            </div>
            <div className="flex items-center justify-between sm:justify-start sm:gap-2">
              <span className="text-slate-400">周期内有流量天数:</span>
              <strong className="font-mono text-slate-200">{periodStats.activeDaysInPeriod} / {days} 天</strong>
            </div>
          </div>
        </div>

        {/* 3. User Activity & Rules Detail (Full Width with Search & Pagination) */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-100">用户活跃与规则明细</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                汇总各账号累计转发请求数、Mock 命中率、活跃天数、沉淀规则版本数、绑定设备及上次活跃时间
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setUserPage(1);
                  }}
                  placeholder="搜索开发者账号..."
                  className="input-field pl-8 pr-3 py-1.5 text-xs w-48"
                />
              </div>
              <div className="w-28">
                <CustomSelect
                  size="xs"
                  value={String(userPageSize)}
                  onChange={(v) => {
                    setUserPageSize(Number(v));
                    setUserPage(1);
                  }}
                  options={[
                    { value: '10', label: '10 条 / 页' },
                    { value: '20', label: '20 条 / 页' },
                    { value: '50', label: '50 条 / 页' },
                  ]}
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">开发者账号</th>
                  <th className="py-2.5 px-3 font-medium text-right">累计请求数</th>
                  <th className="py-2.5 px-3 font-medium text-right">代理转发</th>
                  <th className="py-2.5 px-3 font-medium text-right">Mock 命中 (命中率)</th>
                  <th className="py-2.5 px-3 font-medium text-right">活跃天数</th>
                  <th className="py-2.5 px-3 font-medium text-right">Mock 规则 / 版本</th>
                  <th className="py-2.5 px-3 font-medium text-right">调试设备</th>
                  <th className="py-2.5 pl-4 font-medium text-right">上次活跃时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      未找到匹配的账号记录
                    </td>
                  </tr>
                ) : (
                  paginatedUsers.map((u) => {
                    const mockedCount = u.mocked_count || 0;
                    const proxiedCount = Math.max(0, u.request_count - mockedCount);
                    const hitRate = u.request_count > 0 ? Math.round((mockedCount / u.request_count) * 100) : 0;
                    const rel = formatRelativeActive(u.last_active_at);

                    return (
                      <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 pr-4 font-medium text-slate-200">
                          {u.email}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-cyan-400">
                          {u.request_count.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          {proxiedCount.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {mockedCount > 0 ? (
                            <span className="text-emerald-400 font-medium">
                              {mockedCount.toLocaleString()}{' '}
                              <span className="text-[11px] text-slate-400 font-normal">({hitRate}%)</span>
                            </span>
                          ) : (
                            <span className="text-slate-500">0</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          {u.active_days ?? 0} 天
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          <span className="text-slate-200 font-medium">{u.mock_rules_count}</span> 条
                          {(u.active_rules_count ?? 0) > 0 && (
                            <span className="text-[11px] text-emerald-400 ml-1">
                              ({u.active_rules_count} 开启)
                            </span>
                          )}
                          {(u.versions_count ?? 0) > 0 && (
                            <span className="text-[11px] text-slate-400 ml-1">
                              · {u.versions_count} 版本
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">
                          {u.devices_count} 台
                        </td>
                        <td className="py-3 pl-4 text-right font-mono text-slate-300 whitespace-nowrap">
                          {u.last_active_at ? (
                            <div className="inline-flex items-center justify-end gap-2">
                              <span>{u.last_active_at.slice(0, 19)}</span>
                              {rel.label && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-sans ${
                                    rel.isRecent
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {rel.label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div>
              显示第{' '}
              <span className="font-mono text-slate-200">
                {filteredUsers.length === 0 ? 0 : (currentUserPage - 1) * userPageSize + 1}
              </span>{' '}
              -{' '}
              <span className="font-mono text-slate-200">
                {Math.min(currentUserPage * userPageSize, filteredUsers.length)}
              </span>{' '}
              条，共 <span className="font-mono text-slate-200">{filteredUsers.length}</span> 位用户
            </div>

            {totalUserPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentUserPage <= 1}
                  onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <ChevronLeft size={13} />
                  上一页
                </button>
                <span className="px-2 font-mono text-slate-300">
                  {currentUserPage} / {totalUserPages}
                </span>
                <button
                  type="button"
                  disabled={currentUserPage >= totalUserPages}
                  onClick={() => setUserPage((p) => Math.min(totalUserPages, p + 1))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  下一页
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
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
