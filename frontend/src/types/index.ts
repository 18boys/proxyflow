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
  created_at: string;
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

export interface MockRule {
  id: number;
  user_id: number;
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

export type StatusColor = 'green' | 'orange' | 'red' | 'gray';

export function getStatusColor(status: number | null): StatusColor {
  if (!status) return 'gray';
  if (status >= 200 && status < 300) return 'green';
  if (status >= 400 && status < 500) return 'orange';
  if (status >= 500) return 'red';
  return 'gray';
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
