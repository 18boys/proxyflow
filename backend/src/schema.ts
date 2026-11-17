/**
 * schema.ts — 数据库 Schema 单一真相来源
 *
 * 使用方式：
 *   - 新增表：在 SCHEMA 对象中新增一个 key，值为列定义对象
 *   - 新增列：在对应表的列定义中新增一个 key
 *   - 修改列类型/重命名：不支持自动 sync，需手动执行 SQL
 *
 * 服务启动时会自动对比数据库现状，完成以下操作：
 *   ✅ 表不存在 → CREATE TABLE
 *   ✅ 列不存在 → ALTER TABLE ADD COLUMN
 *   ⏭️  列已存在 → 跳过（不修改已有数据）
 */
export const SCHEMA: Record<string, Record<string, string>> = {
  users: {
    id:              'INTEGER PRIMARY KEY AUTOINCREMENT',
    email:           'TEXT UNIQUE NOT NULL',
    hashed_password: 'TEXT NOT NULL',
    created_at:      "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:      "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  device_sessions: {
    id:            'INTEGER PRIMARY KEY AUTOINCREMENT',
    session_id:    'TEXT UNIQUE NOT NULL',
    user_id:       'INTEGER NOT NULL REFERENCES users(id)',
    name:          "TEXT NOT NULL DEFAULT 'Unknown Device'",
    pairing_token: 'TEXT UNIQUE NOT NULL',
    is_online:     'INTEGER NOT NULL DEFAULT 0',
    last_seen:     'TEXT',
    created_at:    "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:    "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  request_logs: {
    id:               'INTEGER PRIMARY KEY AUTOINCREMENT',
    session_id:       'TEXT',
    user_id:          'INTEGER',
    method:           'TEXT NOT NULL',
    url:              'TEXT NOT NULL',
    path:             "TEXT NOT NULL DEFAULT ''",
    request_headers:  "TEXT NOT NULL DEFAULT '{}'",
    request_body:     'TEXT',
    response_status:  'INTEGER',
    response_headers: "TEXT NOT NULL DEFAULT '{}'",
    response_body:    'TEXT',
    duration_ms:      'INTEGER',
    is_mocked:        'INTEGER NOT NULL DEFAULT 0',
    mock_id:          'INTEGER',
    dns_ms:           'INTEGER',
    connect_ms:       'INTEGER',
    ttfb_ms:          'INTEGER',
    share_token:      'TEXT',
    created_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  shared_requests: {
    id:                'INTEGER PRIMARY KEY AUTOINCREMENT',
    share_token:       'TEXT UNIQUE NOT NULL',
    owner_user_id:     'INTEGER NOT NULL REFERENCES users(id)',
    source_request_id: 'INTEGER',
    request_snapshot:  'TEXT NOT NULL',
    created_at:        "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:        "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  mock_folders: {
    id:         'INTEGER PRIMARY KEY AUTOINCREMENT',
    user_id:    'INTEGER NOT NULL REFERENCES users(id)',
    name:       'TEXT NOT NULL',
    created_at: "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at: "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  mock_rules: {
    id:                    'INTEGER PRIMARY KEY AUTOINCREMENT',
    user_id:               'INTEGER NOT NULL REFERENCES users(id)',
    folder_id:             'INTEGER REFERENCES mock_folders(id) ON DELETE SET NULL',
    name:                  'TEXT NOT NULL',
    url_pattern:           'TEXT NOT NULL',
    match_type:            "TEXT NOT NULL DEFAULT 'exact'",
    method:                'TEXT',
    is_active:             'INTEGER NOT NULL DEFAULT 0',
    active_version_id:     'INTEGER',
    delay_ms:              'INTEGER NOT NULL DEFAULT 0',
    condition_field_type:  'TEXT',
    condition_field_key:   'TEXT',
    condition_field_value: 'TEXT',
    created_at:            "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:            "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  mock_versions: {
    id:               'INTEGER PRIMARY KEY AUTOINCREMENT',
    rule_id:          'INTEGER NOT NULL REFERENCES mock_rules(id) ON DELETE CASCADE',
    user_id:          'INTEGER NOT NULL REFERENCES users(id)',
    name:             'TEXT NOT NULL',
    response_status:  'INTEGER NOT NULL DEFAULT 200',
    response_headers: 'TEXT NOT NULL DEFAULT \'{"Content-Type":"application/json"}\'',
    response_body:    "TEXT NOT NULL DEFAULT '{}'",
    created_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  user_settings: {
    user_id:            'INTEGER PRIMARY KEY REFERENCES users(id)',
    exclusion_domains:  "TEXT NOT NULL DEFAULT '[]'",
    created_at:         "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:         "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  user_ai_settings: {
    user_id:          'INTEGER PRIMARY KEY REFERENCES users(id)',
    enabled:          'INTEGER NOT NULL DEFAULT 0',
    protocol:         "TEXT NOT NULL DEFAULT 'openai'",
    endpoint:         'TEXT NOT NULL',
    model:            'TEXT NOT NULL',
    api_key_encrypted:'TEXT',
    created_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
    updated_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  api_tokens: {
    id:           'INTEGER PRIMARY KEY AUTOINCREMENT',
    user_id:      'INTEGER NOT NULL REFERENCES users(id)',
    name:         'TEXT NOT NULL',
    token_prefix: 'TEXT NOT NULL',
    token_hash:   'TEXT NOT NULL',
    last_used_at: 'TEXT',
    revoked_at:   'TEXT',
    created_at:   "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  // ── 历史统计归档表（每次请求实时增量更新，清理抓包明细不影响历史统计） ──
  stats_daily_rollup: {
    stat_date:            'TEXT PRIMARY KEY',
    total_requests:       'INTEGER NOT NULL DEFAULT 0',
    mocked_requests:      'INTEGER NOT NULL DEFAULT 0',
    proxied_requests:     'INTEGER NOT NULL DEFAULT 0',
    error_requests:       'INTEGER NOT NULL DEFAULT 0',
    total_duration_ms:    'INTEGER NOT NULL DEFAULT 0',
    duration_count:       'INTEGER NOT NULL DEFAULT 0',
    mock_duration_ms:     'INTEGER NOT NULL DEFAULT 0',
    mock_duration_count:  'INTEGER NOT NULL DEFAULT 0',
    proxy_duration_ms:    'INTEGER NOT NULL DEFAULT 0',
    proxy_duration_count: 'INTEGER NOT NULL DEFAULT 0',
    updated_at:           "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  stats_daily_actors: {
    id:             'INTEGER PRIMARY KEY AUTOINCREMENT',
    stat_date:      'TEXT NOT NULL',
    actor_type:     'TEXT NOT NULL',
    actor_key:      'TEXT NOT NULL',
    user_id:        'INTEGER',
    request_count:  'INTEGER NOT NULL DEFAULT 0',
    mocked_count:   'INTEGER NOT NULL DEFAULT 0',
    last_active_at: "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  stats_endpoint_rollup: {
    id:                'INTEGER PRIMARY KEY AUTOINCREMENT',
    endpoint:          'TEXT NOT NULL',
    method:            'TEXT NOT NULL',
    total_hits:        'INTEGER NOT NULL DEFAULT 0',
    mocked_hits:       'INTEGER NOT NULL DEFAULT 0',
    error_hits:        'INTEGER NOT NULL DEFAULT 0',
    total_duration_ms: 'INTEGER NOT NULL DEFAULT 0',
    duration_count:    'INTEGER NOT NULL DEFAULT 0',
    last_hit_at:       "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },

  stats_mcp_calls: {
    id:              'INTEGER PRIMARY KEY AUTOINCREMENT',
    stat_date:       "TEXT NOT NULL DEFAULT (date(datetime('now', '+8 hours')))",
    user_id:         'INTEGER NOT NULL REFERENCES users(id)',
    token_id:        'INTEGER',
    token_name:      "TEXT NOT NULL DEFAULT ''",
    tool_name:       'TEXT NOT NULL',
    target_endpoint: "TEXT NOT NULL DEFAULT ''",
    target_method:   "TEXT NOT NULL DEFAULT 'ANY'",
    status_code:     'INTEGER NOT NULL DEFAULT 200',
    duration_ms:     'INTEGER NOT NULL DEFAULT 0',
    created_at:      "TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))",
  },
};
