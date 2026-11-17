export interface User {
  id: number;
  email: string;
}

export interface DeviceSession {
  id: number;
  session_id: string;
  user_id: number;
  name: string;
  pairing_token: string;
  is_online: number;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequestLog {
  id: number;
  session_id: string | null;
  user_id: number | null;
  method: string;
  url: string;
  path: string;
  request_headers: string;
  request_body: string | null;
  response_status: number | null;
  response_headers: string;
  response_body: string | null;
  duration_ms: number | null;
  is_mocked: number;
  mock_id: number | null;
  dns_ms: number | null;
  connect_ms: number | null;
  ttfb_ms: number | null;
  share_token: string | null;
  created_at: string;
}

export interface SharedRequest extends RequestLog {
  curl: string;
}

export interface MockVersion {
  id: number;
  rule_id: number;
  user_id: number;
  name: string;
  response_status: number;
  response_headers: string;
  response_body: string;
  created_at: string;
  updated_at: string;
}

export interface MockFolder {
  id: number;
  user_id: number;
  name: string;
  mock_count: number;
  created_at: string;
  updated_at: string;
}

export type AiProtocol = 'openai' | 'anthropic';

export interface AiSettings {
  enabled: boolean;
  protocol: AiProtocol;
  endpoint: string;
  model: string;
  has_api_key: boolean;
  effective_source: 'personal' | 'system' | 'none';
  system_configured: boolean;
}

export interface MockRule {
  id: number;
  user_id: number;
  folder_id: number | null;
  folder_name?: string | null;
  name: string;
  url_pattern: string;
  match_type: 'exact' | 'wildcard' | 'regex';
  method: string | null;
  is_active: number;
  active_version_id: number | null;
  active_version: MockVersion | null;
  delay_ms: number;
  condition_field_type: string | null;
  condition_field_key: string | null;
  condition_field_value: string | null;
  version_count: number;
  versions?: MockVersion[];
  active_version_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiToken {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface StatsOverview {
  summary: {
    total_requests: number;
    mocked_requests: number;
    proxied_requests: number;
    mock_hit_rate: number;
    http_error_requests: number;
    avg_duration_ms: number;
    avg_mock_duration_ms: number;
    avg_proxy_duration_ms: number;
    active_days: number;
    total_users: number;
    total_devices: number;
    online_devices: number;
    total_mock_rules: number;
    active_mock_rules: number;
    total_mock_versions: number;
    total_folders: number;
    total_shared_links: number;
    active_mcp_tokens: number;
    estimated_hours_saved: number;
    today_requests: number;
    today_mocked: number;
    today_users: number;
    today_devices: number;
  };
  daily_trend: Array<{
    day: string;
    total_requests: number;
    mocked_requests: number;
    proxied_requests: number;
    error_requests: number;
    active_users: number;
    active_devices: number;
    avg_duration_ms: number;
  }>;
  method_distribution: Array<{
    method: string;
    count: number;
  }>;
  status_distribution: Array<{
    category: string;
    count: number;
  }>;
  top_endpoints: Array<{
    endpoint: string;
    method: string;
    total_hits: number;
    mocked_hits: number;
    error_hits: number;
    avg_ms: number | null;
  }>;
  user_leaderboard: Array<{
    id: number;
    email: string;
    request_count: number;
    mocked_count: number;
    active_days?: number;
    mock_rules_count: number;
    active_rules_count?: number;
    versions_count?: number;
    devices_count: number;
    mcp_calls_count?: number;
    mcp_tokens_count?: number;
    last_active_at: string | null;
  }>;
  mcp_stats?: {
    total_calls: number;
    today_calls: number;
    period_calls: number;
    active_users: number;
    active_tokens: number;
    unique_endpoints: number;
    write_calls: number;
    read_calls: number;
    users: Array<{
      user_id: number;
      email: string;
      total_calls: number;
      write_calls: number;
      read_calls: number;
      unique_endpoints: number;
      last_used_at: string | null;
      tokens: Array<{
        id: number;
        name: string;
        token_prefix: string;
        last_used_at: string | null;
        revoked_at: string | null;
      }>;
      top_tools: Array<{
        tool_name: string;
        count: number;
      }>;
      recent_endpoints: string[];
    }>;
    endpoints: Array<{
      endpoint: string;
      method: string;
      total_calls: number;
      upsert_count: number;
      inspect_count: number;
      switch_toggle_count: number;
      user_count: number;
      users: string[];
      tools: string[];
      last_called_at: string;
    }>;
    tool_distribution: Array<{
      tool_name: string;
      count: number;
      user_count: number;
      last_called_at: string | null;
    }>;
    recent_calls: Array<{
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
  };
}

export type StatusColor = 'green' | 'orange' | 'red' | 'gray';

export function getStatusColor(status: number | null): StatusColor {
  if (!status) return 'gray';
  if (status >= 200 && status < 300) return 'green';
  if (status >= 400 && status < 500) return 'orange';
  if (status >= 500) return 'red';
  return 'gray';
}

export function getStatusColorClass(status: number | null, isError?: boolean): string {
  if (isError) return 'text-red-400 font-bold';
  if (!status) return 'text-slate-400 font-normal';
  if (status >= 200 && status < 300) return 'text-emerald-400 font-semibold';
  if (status >= 400 && status < 500) return 'text-orange-400 font-semibold';
  if (status >= 500) return 'text-red-400 font-semibold';
  return 'text-slate-400 font-normal';
}

export function getMethodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'bg-blue-500/20 text-blue-400',
    POST: 'bg-green-500/20 text-green-400',
    PUT: 'bg-yellow-500/20 text-yellow-400',
    PATCH: 'bg-orange-500/20 text-orange-400',
    DELETE: 'bg-red-500/20 text-red-400',
    OPTIONS: 'bg-purple-500/20 text-purple-400',
    HEAD: 'bg-gray-500/20 text-gray-400',
  };
  return colors[method.toUpperCase()] || 'bg-gray-500/20 text-gray-400';
}

export function parseJson(str: string | null): unknown {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
