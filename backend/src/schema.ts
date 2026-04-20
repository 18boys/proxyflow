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

  mock_rules: {
    id:                    'INTEGER PRIMARY KEY AUTOINCREMENT',
    user_id:               'INTEGER NOT NULL REFERENCES users(id)',
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
};
