import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb, backfillStatsRollupIfNeeded } from '../db';

const router = Router();

// GET /api/stats/today - today's stats for the dashboard header bar (reads from permanent rollup tables)
router.get('/today', requireAuth, (_req: AuthRequest, res: Response): void => {
  const db = getDb();
  backfillStatsRollupIfNeeded(db);

  const todayRow = db.prepare(
    "SELECT total_requests FROM stats_daily_rollup WHERE stat_date = date(datetime('now', '+8 hours'))"
  ).get() as { total_requests: number } | undefined;

  const todayOnlineUsers = (db.prepare(
    "SELECT COUNT(DISTINCT actor_key) as count FROM stats_daily_actors WHERE stat_date = date(datetime('now', '+8 hours')) AND actor_type = 'user'"
  ).get() as { count: number }).count;

  res.json({
    today_requests: todayRow?.total_requests ?? 0,
    today_online_users: todayOnlineUsers,
  });
});

// GET /api/stats/overview?days=30 - comprehensive analytics powered by permanent rollup archive tables
router.get('/overview', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  backfillStatsRollupIfNeeded(db);

  const days = Math.min(365, Math.max(7, Number(req.query['days']) || 30));

  // 1. Global / Platform-wide Totals from stats_daily_rollup
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(total_requests), 0) as total_requests,
      COALESCE(SUM(mocked_requests), 0) as mocked_requests,
      COALESCE(SUM(proxied_requests), 0) as proxied_requests,
      COALESCE(SUM(error_requests), 0) as http_error_requests,
      CASE WHEN SUM(duration_count) > 0 THEN ROUND(CAST(SUM(total_duration_ms) AS REAL) / SUM(duration_count), 1) ELSE 0 END as avg_duration_ms,
      CASE WHEN SUM(mock_duration_count) > 0 THEN ROUND(CAST(SUM(mock_duration_ms) AS REAL) / SUM(mock_duration_count), 1) ELSE 0 END as avg_mock_duration_ms,
      CASE WHEN SUM(proxy_duration_count) > 0 THEN ROUND(CAST(SUM(proxy_duration_ms) AS REAL) / SUM(proxy_duration_count), 1) ELSE 0 END as avg_proxy_duration_ms,
      COUNT(DISTINCT stat_date) as active_days
    FROM stats_daily_rollup
    WHERE total_requests > 0
  `).get() as {
    total_requests: number;
    mocked_requests: number;
    proxied_requests: number;
    http_error_requests: number;
    avg_duration_ms: number;
    avg_mock_duration_ms: number;
    avg_proxy_duration_ms: number;
    active_days: number;
  };

  const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  const totalDevices = (db.prepare('SELECT COUNT(*) as count FROM device_sessions').get() as { count: number }).count;
  const onlineDevices = (db.prepare(
    "SELECT COUNT(*) as count FROM device_sessions WHERE last_seen IS NOT NULL AND last_seen >= datetime('now', '+8 hours', '-30 minutes')"
  ).get() as { count: number }).count;
  const totalMockRules = (db.prepare('SELECT COUNT(*) as count FROM mock_rules').get() as { count: number }).count;
  const activeMockRules = (db.prepare('SELECT COUNT(*) as count FROM mock_rules WHERE is_active = 1').get() as { count: number }).count;
  const totalMockVersions = (db.prepare('SELECT COUNT(*) as count FROM mock_versions').get() as { count: number }).count;
  const totalFolders = (db.prepare('SELECT COUNT(*) as count FROM mock_folders').get() as { count: number }).count;
  const totalSharedLinks = (db.prepare('SELECT COUNT(*) as count FROM shared_requests').get() as { count: number }).count;
  const activeMcpTokens = (db.prepare('SELECT COUNT(*) as count FROM api_tokens WHERE revoked_at IS NULL').get() as { count: number }).count;

  // 2. Today's snapshot from stats_daily_rollup & stats_daily_actors
  const todayRollup = db.prepare(`
    SELECT total_requests, mocked_requests
    FROM stats_daily_rollup
    WHERE stat_date = date(datetime('now', '+8 hours'))
  `).get() as { total_requests: number; mocked_requests: number } | undefined;

  const todayActors = db.prepare(`
    SELECT
      SUM(CASE WHEN actor_type = 'user' THEN 1 ELSE 0 END) as today_users,
      SUM(CASE WHEN actor_type = 'device' THEN 1 ELSE 0 END) as today_devices
    FROM stats_daily_actors
    WHERE stat_date = date(datetime('now', '+8 hours'))
  `).get() as { today_users: number | null; today_devices: number | null };

  // 3. Daily Trend (last N days) from stats_daily_rollup + stats_daily_actors
  const rawDaily = db.prepare(`
    SELECT
      r.stat_date as day,
      r.total_requests,
      r.mocked_requests,
      r.proxied_requests,
      r.error_requests,
      CASE WHEN r.duration_count > 0 THEN ROUND(CAST(r.total_duration_ms AS REAL) / r.duration_count, 1) ELSE 0 END as avg_duration_ms,
      (SELECT COUNT(*) FROM stats_daily_actors a WHERE a.stat_date = r.stat_date AND a.actor_type = 'user') as active_users,
      (SELECT COUNT(*) FROM stats_daily_actors a WHERE a.stat_date = r.stat_date AND a.actor_type = 'device') as active_devices
    FROM stats_daily_rollup r
    WHERE r.stat_date >= date(datetime('now', '+8 hours', ?))
    ORDER BY r.stat_date ASC
  `).all(`-${days - 1} days`) as Array<{
    day: string;
    total_requests: number;
    mocked_requests: number;
    proxied_requests: number;
    error_requests: number;
    avg_duration_ms: number;
    active_users: number;
    active_devices: number;
  }>;

  // Fill in missing calendar days so charts are continuous
  const dailyMap = new Map(rawDaily.map((r) => [r.day, r]));
  const dailyTrend: Array<{
    day: string;
    total_requests: number;
    mocked_requests: number;
    proxied_requests: number;
    error_requests: number;
    active_users: number;
    active_devices: number;
    avg_duration_ms: number;
  }> = [];

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400 * 1000);
    const dayStr = d.toISOString().slice(0, 10);
    const existing = dailyMap.get(dayStr);
    dailyTrend.push({
      day: dayStr,
      total_requests: existing?.total_requests ?? 0,
      mocked_requests: existing?.mocked_requests ?? 0,
      proxied_requests: existing?.proxied_requests ?? 0,
      error_requests: existing?.error_requests ?? 0,
      active_users: existing?.active_users ?? 0,
      active_devices: existing?.active_devices ?? 0,
      avg_duration_ms: existing?.avg_duration_ms ?? 0,
    });
  }

  // 4. Method Distribution from stats_endpoint_rollup
  const methodDistribution = db.prepare(`
    SELECT method, SUM(total_hits) as count
    FROM stats_endpoint_rollup
    GROUP BY method
    ORDER BY count DESC
  `).all() as Array<{ method: string; count: number }>;

  // 5. Status Code Distribution (fallback summary from rollup totals)
  const successCount = Math.max(0, (totals.total_requests || 0) - (totals.http_error_requests || 0));
  const statusDistribution = [
    { category: '2xx / 3xx Normal', count: successCount },
    { category: '4xx / 5xx Error', count: totals.http_error_requests || 0 },
  ];

  // 6. Top 10 Endpoints from stats_endpoint_rollup
  const topEndpoints = db.prepare(`
    SELECT
      endpoint,
      method,
      total_hits,
      mocked_hits,
      error_hits,
      CASE WHEN duration_count > 0 THEN ROUND(CAST(total_duration_ms AS REAL) / duration_count, 0) ELSE 0 END as avg_ms
    FROM stats_endpoint_rollup
    ORDER BY total_hits DESC
    LIMIT 10
  `).all() as Array<{
    endpoint: string;
    method: string;
    total_hits: number;
    mocked_hits: number;
    error_hits: number;
    avg_ms: number | null;
  }>;

  // 7. User Leaderboard from stats_daily_actors (aggregated across all days)
  const userLeaderboard = db.prepare(`
    SELECT
      u.id,
      u.email,
      COALESCE(SUM(a.request_count), 0) as request_count,
      COALESCE(SUM(a.mocked_count), 0) as mocked_count,
      (SELECT COUNT(*) FROM mock_rules m WHERE m.user_id = u.id) as mock_rules_count,
      (SELECT COUNT(*) FROM device_sessions d WHERE d.user_id = u.id) as devices_count,
      MAX(a.last_active_at) as last_active_at
    FROM users u
    LEFT JOIN stats_daily_actors a ON a.user_id = u.id AND a.actor_type = 'user'
    GROUP BY u.id
    ORDER BY request_count DESC
  `).all() as Array<{
    id: number;
    email: string;
    request_count: number;
    mocked_count: number;
    mock_rules_count: number;
    devices_count: number;
    last_active_at: string | null;
  }>;

  const mockedTotal = totals.mocked_requests || 0;

  res.json({
    summary: {
      total_requests: totals.total_requests || 0,
      mocked_requests: mockedTotal,
      proxied_requests: totals.proxied_requests || 0,
      mock_hit_rate: totals.total_requests ? Number(((mockedTotal / totals.total_requests) * 100).toFixed(1)) : 0,
      http_error_requests: totals.http_error_requests || 0,
      avg_duration_ms: totals.avg_duration_ms || 0,
      avg_mock_duration_ms: totals.avg_mock_duration_ms || 0,
      avg_proxy_duration_ms: totals.avg_proxy_duration_ms || 0,
      active_days: totals.active_days || 1,
      total_users: totalUsers,
      total_devices: totalDevices,
      online_devices: onlineDevices,
      total_mock_rules: totalMockRules,
      active_mock_rules: activeMockRules,
      total_mock_versions: totalMockVersions,
      total_folders: totalFolders,
      total_shared_links: totalSharedLinks,
      active_mcp_tokens: activeMcpTokens,
      estimated_hours_saved: 0,
      today_requests: todayRollup?.total_requests || 0,
      today_mocked: todayRollup?.mocked_requests || 0,
      today_users: Math.max(todayActors?.today_users || 0, onlineDevices > 0 ? 1 : 0),
      today_devices: todayActors?.today_devices || 0,
    },
    daily_trend: dailyTrend,
    method_distribution: methodDistribution,
    status_distribution: statusDistribution,
    top_endpoints: topEndpoints,
    user_leaderboard: userLeaderboard,
  });
});

export default router;
