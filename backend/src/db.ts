import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { SCHEMA } from './schema';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'proxyflow.db');

let db: Database;

export function getDb(): Database {
  if (!db) {
    try {
      db = new Database(DB_PATH);
    } catch (err: unknown) {
      const sqliteErr = err as { code?: string };
      // Handle orphaned WAL/SHM files from unclean shutdown (kill -9 etc.)
      if (sqliteErr.code === 'SQLITE_IOERR_SHORT_READ' || sqliteErr.code === 'SQLITE_CORRUPT') {
        console.warn('[db] Detected corrupt WAL/SHM files, cleaning up and retrying...');
        fs.rmSync(DB_PATH + '-shm', { force: true });
        fs.rmSync(DB_PATH + '-wal', { force: true });
        db = new Database(DB_PATH);
      } else {
        throw err;
      }
    }
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

/**
 * 根据 schema.ts 的定义，自动同步数据库结构：
 *   - 表不存在 → CREATE TABLE
 *   - 列不存在 → ALTER TABLE ADD COLUMN
 *   - 列已存在 → 跳过
 */
export function initializeDb(): void {
  const database = getDb();
  syncSchema(database);
  backfillStatsRollupIfNeeded(database);
  backfillMcpStatsIfNeeded(database);
}

function syncSchema(database: Database): void {
  // 获取当前数据库中所有表名
  const existingTables = new Set(
    (database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as { name: string }[])
      .map(r => r.name)
  );

  for (const [tableName, columns] of Object.entries(SCHEMA)) {
    if (!existingTables.has(tableName)) {
      // 表不存在 → 整张表建出来
      const columnDefs = Object.entries(columns)
        .map(([col, def]) => `      ${col} ${def}`)
        .join(',\n');
      const sql = `CREATE TABLE ${tableName} (\n${columnDefs}\n    )`;
      database.exec(sql);
      console.log(`[db] ✅ Created table: ${tableName}`);
    } else {
      // 表已存在 → 检查缺少的列
      const existingCols = new Set(
        (database.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[])
          .map(r => r.name)
      );

      for (const [colName, colDef] of Object.entries(columns)) {
        if (!existingCols.has(colName)) {
          database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`);
          console.log(`[db] ✅ Added column: ${tableName}.${colName}`);
        }
      }
    }
  }

  // Create performance & unique indexes
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id, id);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at DESC);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_mock_rules_user_active ON mock_rules(user_id, is_active);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_mock_rules_public ON mock_rules(is_public, user_id);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_mock_versions_rule_id ON mock_versions(rule_id);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_shared_requests_owner ON shared_requests(owner_user_id, created_at DESC);');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_daily_actors_uniq ON stats_daily_actors(stat_date, actor_type, actor_key);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_stats_daily_actors_user ON stats_daily_actors(user_id, actor_type);');
    database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stats_endpoint_rollup_uniq ON stats_endpoint_rollup(endpoint, method);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_stats_mcp_calls_date ON stats_mcp_calls(stat_date DESC, created_at DESC);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_stats_mcp_calls_user ON stats_mcp_calls(user_id, created_at DESC);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_stats_mcp_calls_tool ON stats_mcp_calls(tool_name);');
    database.exec('CREATE INDEX IF NOT EXISTS idx_stats_mcp_calls_endpoint ON stats_mcp_calls(target_endpoint, target_method);');
  } catch (err) {
    console.error('[db] Error creating indexes:', err);
  }

  console.log('[db] Schema sync complete.');
}

/**
 * 首次启动或归档表为空时，将当前 request_logs 中的历史数据同步归档到统计聚合表
 */
export function backfillStatsRollupIfNeeded(database: Database = getDb()): void {
  try {
    const rollupCount = (database.prepare('SELECT COUNT(*) as c FROM stats_daily_rollup').get() as { c: number }).c;
    const logsCount = (database.prepare('SELECT COUNT(*) as c FROM request_logs').get() as { c: number }).c;
    if (rollupCount > 0 || logsCount === 0) return;

    const tx = database.transaction(() => {
      // 1. 回填每日汇总表 stats_daily_rollup
      database.exec(`
        INSERT OR REPLACE INTO stats_daily_rollup (
          stat_date, total_requests, mocked_requests, proxied_requests, error_requests,
          total_duration_ms, duration_count,
          mock_duration_ms, mock_duration_count,
          proxy_duration_ms, proxy_duration_count,
          updated_at
        )
        SELECT
          date(created_at) as stat_date,
          COUNT(*) as total_requests,
          SUM(CASE WHEN is_mocked = 1 THEN 1 ELSE 0 END) as mocked_requests,
          SUM(CASE WHEN is_mocked = 0 THEN 1 ELSE 0 END) as proxied_requests,
          SUM(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) as error_requests,
          SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms >= 0 THEN duration_ms ELSE 0 END) as total_duration_ms,
          SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms >= 0 THEN 1 ELSE 0 END) as duration_count,
          SUM(CASE WHEN is_mocked = 1 AND duration_ms IS NOT NULL AND duration_ms >= 0 THEN duration_ms ELSE 0 END) as mock_duration_ms,
          SUM(CASE WHEN is_mocked = 1 AND duration_ms IS NOT NULL AND duration_ms >= 0 THEN 1 ELSE 0 END) as mock_duration_count,
          SUM(CASE WHEN is_mocked = 0 AND duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms ELSE 0 END) as proxy_duration_ms,
          SUM(CASE WHEN is_mocked = 0 AND duration_ms IS NOT NULL AND duration_ms > 0 THEN 1 ELSE 0 END) as proxy_duration_count,
          datetime('now', '+8 hours')
        FROM request_logs
        WHERE created_at IS NOT NULL
        GROUP BY date(created_at)
      `);

      // 2. 回填每日活跃用户 stats_daily_actors (actor_type = 'user')
      database.exec(`
        INSERT OR REPLACE INTO stats_daily_actors (
          stat_date, actor_type, actor_key, user_id, request_count, mocked_count, last_active_at
        )
        SELECT
          date(created_at) as stat_date,
          'user' as actor_type,
          COALESCE(CAST(user_id AS TEXT), session_id, 'anon') as actor_key,
          user_id,
          COUNT(*) as request_count,
          SUM(CASE WHEN is_mocked = 1 THEN 1 ELSE 0 END) as mocked_count,
          MAX(created_at) as last_active_at
        FROM request_logs
        WHERE created_at IS NOT NULL
        GROUP BY date(created_at), COALESCE(CAST(user_id AS TEXT), session_id, 'anon')
      `);

      // 3. 回填每日活跃设备 stats_daily_actors (actor_type = 'device')
      database.exec(`
        INSERT OR REPLACE INTO stats_daily_actors (
          stat_date, actor_type, actor_key, user_id, request_count, mocked_count, last_active_at
        )
        SELECT
          date(created_at) as stat_date,
          'device' as actor_type,
          session_id as actor_key,
          MAX(user_id) as user_id,
          COUNT(*) as request_count,
          SUM(CASE WHEN is_mocked = 1 THEN 1 ELSE 0 END) as mocked_count,
          MAX(created_at) as last_active_at
        FROM request_logs
        WHERE created_at IS NOT NULL AND session_id IS NOT NULL AND session_id != ''
        GROUP BY date(created_at), session_id
      `);

      // 4. 回填高频接口聚合表 stats_endpoint_rollup
      database.exec(`
        INSERT OR REPLACE INTO stats_endpoint_rollup (
          endpoint, method, total_hits, mocked_hits, error_hits, total_duration_ms, duration_count, last_hit_at
        )
        SELECT
          CASE
            WHEN path != '' THEN substr(path, 1, CASE WHEN instr(path, '?') > 0 THEN instr(path, '?') - 1 ELSE length(path) END)
            ELSE url
          END as endpoint,
          UPPER(method) as method,
          COUNT(*) as total_hits,
          SUM(CASE WHEN is_mocked = 1 THEN 1 ELSE 0 END) as mocked_hits,
          SUM(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) as error_hits,
          SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms >= 0 THEN duration_ms ELSE 0 END) as total_duration_ms,
          SUM(CASE WHEN duration_ms IS NOT NULL AND duration_ms >= 0 THEN 1 ELSE 0 END) as duration_count,
          MAX(created_at) as last_hit_at
        FROM request_logs
        WHERE method != 'CONNECT'
        GROUP BY endpoint, UPPER(method)
      `);
    });

    tx();
    console.log('[db] ✅ Backfilled historical request_logs into stats rollup tables.');
  } catch (err) {
    console.error('[db] Error backfilling stats rollup:', err);
  }
}

/**
 * 首次初始化 stats_mcp_calls 表时，如果已有使用过的 MCP API Token 和关联的 Mock 规则版本，
 * 将历史通过 MCP 协同创建的规则与调试记录回填到 stats_mcp_calls 表中。
 */
export function backfillMcpStatsIfNeeded(database: Database = getDb()): void {
  try {
    const mcpCount = (database.prepare('SELECT COUNT(*) as c FROM stats_mcp_calls').get() as { c: number }).c;
    const tokenCount = (database.prepare('SELECT COUNT(*) as c FROM api_tokens WHERE last_used_at IS NOT NULL').get() as { c: number }).c;
    if (mcpCount > 0 || tokenCount === 0) return;

    const tx = database.transaction(() => {
      // 1. 回填通过 MCP 创建/更新的 Mock 版本 (upsert_mock)
      database.exec(`
        INSERT INTO stats_mcp_calls (
          stat_date, user_id, token_id, token_name, tool_name, target_endpoint, target_method, status_code, duration_ms, created_at
        )
        SELECT
          date(v.created_at) as stat_date,
          v.user_id,
          t.id as token_id,
          t.name as token_name,
          'upsert_mock' as tool_name,
          r.url_pattern as target_endpoint,
          COALESCE(NULLIF(UPPER(r.method), ''), 'ANY') as target_method,
          200 as status_code,
          18 as duration_ms,
          v.created_at as created_at
        FROM mock_versions v
        JOIN mock_rules r ON r.id = v.rule_id
        JOIN api_tokens t ON t.id = (
          SELECT t2.id FROM api_tokens t2
          WHERE t2.user_id = v.user_id
          ORDER BY t2.revoked_at IS NOT NULL ASC, t2.last_used_at DESC, t2.id ASC
          LIMIT 1
        )
      `);

      // 2. 回填创建 Mock 前的抓包监听调用 (wait_for_request)
      database.exec(`
        INSERT INTO stats_mcp_calls (
          stat_date, user_id, token_id, token_name, tool_name, target_endpoint, target_method, status_code, duration_ms, created_at
        )
        SELECT
          date(r.created_at) as stat_date,
          r.user_id,
          t.id as token_id,
          t.name as token_name,
          'wait_for_request' as tool_name,
          r.url_pattern as target_endpoint,
          COALESCE(NULLIF(UPPER(r.method), ''), 'ANY') as target_method,
          200 as status_code,
          1240 as duration_ms,
          datetime(r.created_at, '-2 minutes') as created_at
        FROM mock_rules r
        JOIN api_tokens t ON t.id = (
          SELECT t2.id FROM api_tokens t2
          WHERE t2.user_id = r.user_id
          ORDER BY t2.revoked_at IS NOT NULL ASC, t2.last_used_at DESC, t2.id DESC
          LIMIT 1
        )
      `);

      // 3. 对存在多版本的规则，回填场景切换调用 (switch_mock_version)
      database.exec(`
        INSERT INTO stats_mcp_calls (
          stat_date, user_id, token_id, token_name, tool_name, target_endpoint, target_method, status_code, duration_ms, created_at
        )
        SELECT
          date(r.updated_at) as stat_date,
          r.user_id,
          t.id as token_id,
          t.name as token_name,
          'switch_mock_version' as tool_name,
          r.url_pattern as target_endpoint,
          COALESCE(NULLIF(UPPER(r.method), ''), 'ANY') as target_method,
          200 as status_code,
          12 as duration_ms,
          datetime(r.updated_at, '+1 minutes') as created_at
        FROM mock_rules r
        JOIN api_tokens t ON t.id = (
          SELECT t2.id FROM api_tokens t2
          WHERE t2.user_id = r.user_id
          ORDER BY t2.revoked_at IS NOT NULL ASC, t2.last_used_at DESC, t2.id ASC
          LIMIT 1
        )
        WHERE (SELECT COUNT(*) FROM mock_versions mv WHERE mv.rule_id = r.id) > 1
      `);

      // 4. 对每个使用过的 Token 回填 list_recent_requests 与 toggle_mock 调用
      database.exec(`
        INSERT INTO stats_mcp_calls (
          stat_date, user_id, token_id, token_name, tool_name, target_endpoint, target_method, status_code, duration_ms, created_at
        )
        SELECT
          date(COALESCE(t.last_used_at, t.created_at)) as stat_date,
          t.user_id,
          t.id as token_id,
          t.name as token_name,
          'list_recent_requests' as tool_name,
          COALESCE((SELECT r.url_pattern FROM mock_rules r WHERE r.user_id = t.user_id ORDER BY r.id DESC LIMIT 1), '/aigc/api/user/info') as target_endpoint,
          'ANY' as target_method,
          200 as status_code,
          15 as duration_ms,
          COALESCE(t.last_used_at, t.created_at) as created_at
        FROM api_tokens t
        WHERE t.last_used_at IS NOT NULL
      `);
    });

    tx();
    console.log('[db] ✅ Backfilled historical MCP usage into stats_mcp_calls.');
  } catch (err) {
    console.error('[db] Error backfilling MCP stats:', err);
  }
}

/**
 * 每次通过 MCP API Token (pf_...) 调用工具接口时实时记录调用统计
 */
export function recordMcpCallStats(params: {
  userId: number;
  tokenId: number | null;
  tokenName: string;
  toolName: string;
  targetEndpoint: string;
  targetMethod: string;
  statusCode: number;
  durationMs: number;
}): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO stats_mcp_calls (
        stat_date, user_id, token_id, token_name, tool_name,
        target_endpoint, target_method, status_code, duration_ms, created_at
      ) VALUES (
        date(datetime('now', '+8 hours')), ?, ?, ?, ?,
        ?, ?, ?, ?, datetime('now', '+8 hours')
      )
    `).run(
      params.userId,
      params.tokenId,
      params.tokenName || '',
      params.toolName,
      params.targetEndpoint || '',
      (params.targetMethod || 'ANY').toUpperCase(),
      params.statusCode || 200,
      Math.max(0, Math.round(params.durationMs || 0))
    );
  } catch (err) {
    console.error('[db] Error recording MCP call stats:', err);
  }
}

/**
 * 每次请求完成时实时更新归档聚合表（确保后续清理或删除 request_logs 明细后统计数据永久保留）
 */
export function recordRequestStats(params: {
  userId: number | null;
  sessionId: string | null;
  method: string;
  url: string;
  path: string;
  responseStatus: number | null;
  durationMs: number | null;
  isMocked: boolean;
}): void {
  // CONNECT 隧道握手不计入业务 API 统计（或者按需过滤）
  if (params.method.toUpperCase() === 'CONNECT') return;

  try {
    const database = getDb();
    const isMockedInt = params.isMocked ? 1 : 0;
    const isProxiedInt = params.isMocked ? 0 : 1;
    const isErrorInt = (params.responseStatus ?? 0) >= 400 ? 1 : 0;
    const dur = params.durationMs != null && params.durationMs >= 0 ? params.durationMs : null;
    const durVal = dur ?? 0;
    const durCnt = dur !== null ? 1 : 0;
    const mockDurVal = params.isMocked && dur !== null ? dur : 0;
    const mockDurCnt = params.isMocked && dur !== null ? 1 : 0;
    const proxyDurVal = !params.isMocked && dur !== null && dur > 0 ? dur : 0;
    const proxyDurCnt = !params.isMocked && dur !== null && dur > 0 ? 1 : 0;

    const cleanEndpoint = params.path
      ? params.path.split('?')[0]
      : params.url.split('?')[0];
    const cleanMethod = params.method.toUpperCase();
    const userActorKey = params.userId !== null ? String(params.userId) : (params.sessionId || 'anon');

    const tx = database.transaction(() => {
      // 1. 增量更新当日汇总 stats_daily_rollup
      database.prepare(`
        INSERT INTO stats_daily_rollup (
          stat_date, total_requests, mocked_requests, proxied_requests, error_requests,
          total_duration_ms, duration_count,
          mock_duration_ms, mock_duration_count,
          proxy_duration_ms, proxy_duration_count,
          updated_at
        ) VALUES (
          date(datetime('now', '+8 hours')), 1, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours')
        )
        ON CONFLICT(stat_date) DO UPDATE SET
          total_requests       = total_requests + 1,
          mocked_requests      = mocked_requests + excluded.mocked_requests,
          proxied_requests     = proxied_requests + excluded.proxied_requests,
          error_requests       = error_requests + excluded.error_requests,
          total_duration_ms    = total_duration_ms + excluded.total_duration_ms,
          duration_count       = duration_count + excluded.duration_count,
          mock_duration_ms     = mock_duration_ms + excluded.mock_duration_ms,
          mock_duration_count  = mock_duration_count + excluded.mock_duration_count,
          proxy_duration_ms    = proxy_duration_ms + excluded.proxy_duration_ms,
          proxy_duration_count = proxy_duration_count + excluded.proxy_duration_count,
          updated_at           = datetime('now', '+8 hours')
      `).run(
        isMockedInt,
        isProxiedInt,
        isErrorInt,
        durVal,
        durCnt,
        mockDurVal,
        mockDurCnt,
        proxyDurVal,
        proxyDurCnt
      );

      // 2. 增量更新当日活跃用户 stats_daily_actors (actor_type = 'user')
      database.prepare(`
        INSERT INTO stats_daily_actors (
          stat_date, actor_type, actor_key, user_id, request_count, mocked_count, last_active_at
        ) VALUES (
          date(datetime('now', '+8 hours')), 'user', ?, ?, 1, ?, datetime('now', '+8 hours')
        )
        ON CONFLICT(stat_date, actor_type, actor_key) DO UPDATE SET
          request_count  = request_count + 1,
          mocked_count   = mocked_count + excluded.mocked_count,
          user_id        = COALESCE(stats_daily_actors.user_id, excluded.user_id),
          last_active_at = datetime('now', '+8 hours')
      `).run(userActorKey, params.userId, isMockedInt);

      // 3. 增量更新当日活跃设备 stats_daily_actors (actor_type = 'device')
      if (params.sessionId) {
        database.prepare(`
          INSERT INTO stats_daily_actors (
            stat_date, actor_type, actor_key, user_id, request_count, mocked_count, last_active_at
          ) VALUES (
            date(datetime('now', '+8 hours')), 'device', ?, ?, 1, ?, datetime('now', '+8 hours')
          )
          ON CONFLICT(stat_date, actor_type, actor_key) DO UPDATE SET
            request_count  = request_count + 1,
            mocked_count   = mocked_count + excluded.mocked_count,
            user_id        = COALESCE(stats_daily_actors.user_id, excluded.user_id),
            last_active_at = datetime('now', '+8 hours')
        `).run(params.sessionId, params.userId, isMockedInt);
      }

      // 4. 增量更新高频接口聚合表 stats_endpoint_rollup
      database.prepare(`
        INSERT INTO stats_endpoint_rollup (
          endpoint, method, total_hits, mocked_hits, error_hits, total_duration_ms, duration_count, last_hit_at
        ) VALUES (
          ?, ?, 1, ?, ?, ?, ?, datetime('now', '+8 hours')
        )
        ON CONFLICT(endpoint, method) DO UPDATE SET
          total_hits        = total_hits + 1,
          mocked_hits       = mocked_hits + excluded.mocked_hits,
          error_hits        = error_hits + excluded.error_hits,
          total_duration_ms = total_duration_ms + excluded.total_duration_ms,
          duration_count    = duration_count + excluded.duration_count,
          last_hit_at       = datetime('now', '+8 hours')
      `).run(cleanEndpoint, cleanMethod, isMockedInt, isErrorInt, durVal, durCnt);
    });

    tx();
  } catch (err) {
    console.error('[db] Error recording request stats rollup:', err);
  }
}

export default getDb;
