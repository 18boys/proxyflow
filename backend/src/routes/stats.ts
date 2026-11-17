import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb, backfillStatsRollupIfNeeded, backfillMcpStatsIfNeeded } from '../db';

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
  backfillMcpStatsIfNeeded(db);

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
      COUNT(DISTINCT a.stat_date) as active_days,
      (SELECT COUNT(*) FROM mock_rules m WHERE m.user_id = u.id) as mock_rules_count,
      (SELECT COUNT(*) FROM mock_rules m WHERE m.user_id = u.id AND m.is_active = 1) as active_rules_count,
      (SELECT COUNT(*) FROM mock_versions v WHERE v.user_id = u.id) as versions_count,
      (SELECT COUNT(*) FROM device_sessions d WHERE d.user_id = u.id) as devices_count,
      (SELECT COUNT(*) FROM stats_mcp_calls mc WHERE mc.user_id = u.id) as mcp_calls_count,
      (SELECT COUNT(*) FROM api_tokens t WHERE t.user_id = u.id AND t.revoked_at IS NULL) as mcp_tokens_count,
      COALESCE(
        MAX(a.last_active_at),
        (SELECT MAX(mc.created_at) FROM stats_mcp_calls mc WHERE mc.user_id = u.id),
        (SELECT MAX(d.last_seen) FROM device_sessions d WHERE d.user_id = u.id),
        u.created_at
      ) as last_active_at
    FROM users u
    LEFT JOIN stats_daily_actors a ON a.user_id = u.id AND a.actor_type = 'user'
    GROUP BY u.id
    ORDER BY request_count DESC, mcp_calls_count DESC, last_active_at DESC
  `).all() as Array<{
    id: number;
    email: string;
    request_count: number;
    mocked_count: number;
    active_days: number;
    mock_rules_count: number;
    active_rules_count: number;
    versions_count: number;
    devices_count: number;
    mcp_calls_count: number;
    mcp_tokens_count: number;
    last_active_at: string | null;
  }>;

  // 8. MCP Usage Statistics ("谁用了, 用了哪些接口")
  const mcpSummaryRow = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(CASE WHEN stat_date = date(datetime('now', '+8 hours')) THEN 1 ELSE 0 END), 0) as today_calls,
      COALESCE(SUM(CASE WHEN stat_date >= date(datetime('now', '+8 hours', ?)) THEN 1 ELSE 0 END), 0) as period_calls,
      COUNT(DISTINCT user_id) as active_users,
      COUNT(DISTINCT CASE WHEN target_endpoint != '' AND target_endpoint != '*' THEN target_endpoint ELSE NULL END) as unique_endpoints,
      COALESCE(SUM(CASE WHEN tool_name IN ('upsert_mock', 'toggle_mock', 'switch_mock_version', 'delete_mock') THEN 1 ELSE 0 END), 0) as write_calls,
      COALESCE(SUM(CASE WHEN tool_name NOT IN ('upsert_mock', 'toggle_mock', 'switch_mock_version', 'delete_mock') THEN 1 ELSE 0 END), 0) as read_calls
    FROM stats_mcp_calls
  `).get(`-${days - 1} days`) as {
    total_calls: number;
    today_calls: number;
    period_calls: number;
    active_users: number;
    unique_endpoints: number;
    write_calls: number;
    read_calls: number;
  };

  // 8a. MCP Users ("谁用了") — all users who have either called MCP or created API tokens
  const mcpUserRows = db.prepare(`
    SELECT
      u.id as user_id,
      u.email as email,
      COUNT(mc.id) as total_calls,
      COALESCE(SUM(CASE WHEN mc.tool_name IN ('upsert_mock', 'toggle_mock', 'switch_mock_version', 'delete_mock') THEN 1 ELSE 0 END), 0) as write_calls,
      COALESCE(SUM(CASE WHEN mc.id IS NOT NULL AND mc.tool_name NOT IN ('upsert_mock', 'toggle_mock', 'switch_mock_version', 'delete_mock') THEN 1 ELSE 0 END), 0) as read_calls,
      COUNT(DISTINCT CASE WHEN mc.target_endpoint != '' AND mc.target_endpoint != '*' THEN mc.target_endpoint ELSE NULL END) as unique_endpoints,
      COALESCE(
        MAX(mc.created_at),
        (SELECT MAX(t.last_used_at) FROM api_tokens t WHERE t.user_id = u.id)
      ) as last_used_at
    FROM users u
    LEFT JOIN stats_mcp_calls mc ON mc.user_id = u.id
    WHERE EXISTS (SELECT 1 FROM stats_mcp_calls m2 WHERE m2.user_id = u.id)
       OR EXISTS (SELECT 1 FROM api_tokens t2 WHERE t2.user_id = u.id)
    GROUP BY u.id
    ORDER BY total_calls DESC, last_used_at DESC
  `).all() as Array<{
    user_id: number;
    email: string;
    total_calls: number;
    write_calls: number;
    read_calls: number;
    unique_endpoints: number;
    last_used_at: string | null;
  }>;

  const userTokensStmt = db.prepare(`
    SELECT id, name, token_prefix, last_used_at, revoked_at
    FROM api_tokens
    WHERE user_id = ?
    ORDER BY revoked_at IS NOT NULL ASC, last_used_at DESC, id DESC
  `);

  const userToolsStmt = db.prepare(`
    SELECT tool_name, COUNT(*) as count
    FROM stats_mcp_calls
    WHERE user_id = ?
    GROUP BY tool_name
    ORDER BY count DESC
  `);

  const userEndpointsStmt = db.prepare(`
    SELECT target_endpoint
    FROM stats_mcp_calls
    WHERE user_id = ? AND target_endpoint != '' AND target_endpoint != '*'
    GROUP BY target_endpoint
    ORDER BY COUNT(*) DESC, MAX(created_at) DESC
    LIMIT 5
  `);

  const mcpUsers = mcpUserRows.map((row) => {
    const tokens = userTokensStmt.all(row.user_id) as Array<{
      id: number;
      name: string;
      token_prefix: string;
      last_used_at: string | null;
      revoked_at: string | null;
    }>;
    const topTools = userToolsStmt.all(row.user_id) as Array<{ tool_name: string; count: number }>;
    const recentEndpoints = (userEndpointsStmt.all(row.user_id) as Array<{ target_endpoint: string }>).map(
      (r) => r.target_endpoint
    );
    return {
      ...row,
      tokens,
      top_tools: topTools,
      recent_endpoints: recentEndpoints,
    };
  });

  // 8b. MCP Target Endpoints ("用了哪些接口" — AI 操作过的具体业务 API)
  const mcpEndpointRows = db.prepare(`
    SELECT
      mc.target_endpoint as endpoint,
      CASE
        WHEN COUNT(DISTINCT CASE WHEN mc.target_method != 'ANY' THEN mc.target_method END) = 1
        THEN MAX(CASE WHEN mc.target_method != 'ANY' THEN mc.target_method END)
        ELSE COALESCE(NULLIF(MAX(CASE WHEN mc.target_method != 'ANY' THEN mc.target_method END), ''), 'ANY')
      END as method,
      COUNT(*) as total_calls,
      SUM(CASE WHEN mc.tool_name = 'upsert_mock' THEN 1 ELSE 0 END) as upsert_count,
      SUM(CASE WHEN mc.tool_name IN ('wait_for_request', 'list_recent_requests', 'get_request') THEN 1 ELSE 0 END) as inspect_count,
      SUM(CASE WHEN mc.tool_name IN ('switch_mock_version', 'toggle_mock', 'delete_mock') THEN 1 ELSE 0 END) as switch_toggle_count,
      COUNT(DISTINCT mc.user_id) as user_count,
      GROUP_CONCAT(DISTINCT u.email) as user_emails,
      GROUP_CONCAT(DISTINCT mc.tool_name) as tool_names,
      MAX(mc.created_at) as last_called_at
    FROM stats_mcp_calls mc
    JOIN users u ON u.id = mc.user_id
    WHERE mc.target_endpoint != '' AND mc.target_endpoint != '*'
    GROUP BY mc.target_endpoint
    ORDER BY total_calls DESC, last_called_at DESC
    LIMIT 30
  `).all() as Array<{
    endpoint: string;
    method: string;
    total_calls: number;
    upsert_count: number;
    inspect_count: number;
    switch_toggle_count: number;
    user_count: number;
    user_emails: string | null;
    tool_names: string | null;
    last_called_at: string;
  }>;

  const mcpEndpoints = mcpEndpointRows.map((r) => ({
    endpoint: r.endpoint,
    method: r.method || 'ANY',
    total_calls: r.total_calls,
    upsert_count: r.upsert_count,
    inspect_count: r.inspect_count,
    switch_toggle_count: r.switch_toggle_count,
    user_count: r.user_count,
    users: r.user_emails ? r.user_emails.split(',').filter(Boolean) : [],
    tools: r.tool_names ? r.tool_names.split(',').filter(Boolean) : [],
    last_called_at: r.last_called_at,
  }));

  // 8c. MCP Tool Distribution (8 MCP Tools)
  const mcpToolDistribution = db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as count,
      COUNT(DISTINCT user_id) as user_count,
      MAX(created_at) as last_called_at
    FROM stats_mcp_calls
    GROUP BY tool_name
    ORDER BY count DESC
  `).all() as Array<{
    tool_name: string;
    count: number;
    user_count: number;
    last_called_at: string | null;
  }>;

  // 8d. Recent MCP Call Stream (最近调用流水)
  const mcpRecentCalls = db.prepare(`
    SELECT
      mc.id,
      u.email as user_email,
      mc.token_name,
      mc.tool_name,
      mc.target_endpoint,
      mc.target_method,
      mc.status_code,
      mc.duration_ms,
      mc.created_at
    FROM stats_mcp_calls mc
    JOIN users u ON u.id = mc.user_id
    ORDER BY mc.created_at DESC, mc.id DESC
    LIMIT 30
  `).all() as Array<{
    id: number;
    user_email: string;
    token_name: string;
    tool_name: string;
    target_endpoint: string;
    target_method: string;
    status_code: number;
    duration_ms: number;
    created_at: string;
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
    mcp_stats: {
      total_calls: mcpSummaryRow?.total_calls || 0,
      today_calls: mcpSummaryRow?.today_calls || 0,
      period_calls: mcpSummaryRow?.period_calls || 0,
      active_users: mcpSummaryRow?.active_users || 0,
      active_tokens: activeMcpTokens,
      unique_endpoints: mcpSummaryRow?.unique_endpoints || 0,
      write_calls: mcpSummaryRow?.write_calls || 0,
      read_calls: mcpSummaryRow?.read_calls || 0,
      users: mcpUsers,
      endpoints: mcpEndpoints,
      tool_distribution: mcpToolDistribution,
      recent_calls: mcpRecentCalls,
    },
  });
});

export default router;
