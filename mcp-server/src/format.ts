// Pure helpers that shape backend payloads into something an LLM can consume cheaply and safely.

const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'x-api-key', 'x-auth-token', 'x-access-token', 'x-csrf-token', 'x-xsrf-token',
]);

export const DEFAULT_MAX_BODY_CHARS = 6000;

/** Backend log rows store headers/bodies as JSON strings; the /wait endpoint has already parsed them. */
export function parseJsonField(value: unknown, expect: 'object' | 'any' = 'any'): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trimStart();
  if (expect === 'object' || t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(value); } catch { /* keep raw */ }
  }
  return value;
}

export function redactHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    const sensitive = SENSITIVE_HEADERS.has(lower) || /token|secret|session|signature/.test(lower);
    out[k] = sensitive ? '[REDACTED]' : String(v);
  }
  return out;
}

export interface BodyView {
  body: unknown;
  truncated?: true;
  original_chars?: number;
}

/** Keep parsed JSON as-is when small; otherwise cut the serialised form and say so. */
export function shapeBody(body: unknown, maxChars: number): BodyView {
  if (body === null || body === undefined) return { body: null };
  const serialised = typeof body === 'string' ? body : JSON.stringify(body);
  if (serialised.length <= maxChars) return { body };
  return {
    body: serialised.slice(0, maxChars) + ` …[truncated, ${serialised.length - maxChars} more chars]`,
    truncated: true,
    original_chars: serialised.length,
  };
}

interface RawLog {
  id: number; method: string; url: string; response_status: number | null; is_mocked: number;
  mock_id: number | null; duration_ms: number | null; created_at: string;
  request_headers?: unknown; response_headers?: unknown; request_body?: unknown; response_body?: unknown;
}

export function summariseLog(log: RawLog) {
  return {
    id: log.id,
    time: log.created_at,
    method: log.method,
    url: log.url,
    status: log.response_status,
    source: log.is_mocked ? 'MOCK' : 'REAL',
    duration_ms: log.duration_ms,
  };
}

export function detailLog(log: RawLog, maxBodyChars: number) {
  const reqBody = shapeBody(parseJsonField(log.request_body), maxBodyChars);
  const resBody = shapeBody(parseJsonField(log.response_body), maxBodyChars);
  const notes: string[] = [];
  if (log.is_mocked) {
    notes.push('This response came from a MOCK rule, not the real backend. Disable the mock (toggle_mock enabled=false) and retrigger to capture the real shape.');
  }
  if (reqBody.truncated || resBody.truncated) {
    notes.push('Body was truncated for display. To save the exact original response as a mock, call upsert_mock with from_request_id=' + log.id + ' instead of re-typing the body.');
  }
  return {
    ...summariseLog(log),
    request: {
      headers: redactHeaders(parseJsonField(log.request_headers, 'object')),
      body: reqBody.body,
      ...(reqBody.truncated ? { truncated: true, original_chars: reqBody.original_chars } : {}),
    },
    response: {
      headers: redactHeaders(parseJsonField(log.response_headers, 'object')),
      body: resBody.body,
      ...(resBody.truncated ? { truncated: true, original_chars: resBody.original_chars } : {}),
    },
    ...(notes.length ? { notes } : {}),
  };
}

interface RawRule {
  id: number; name: string; url_pattern: string; method: string | null; match_type: string;
  is_active: number; delay_ms: number; folder_name?: string | null;
  condition_field_type?: string | null; condition_field_key?: string | null; condition_field_value?: string | null;
  active_version_id: number | null;
  versions?: { id: number; name: string; response_status: number }[];
  active_version?: { id: number; name: string; response_status: number; response_headers: string; response_body: string } | null;
}

export function condenseRule(rule: RawRule, opts: { includeBody?: boolean; maxBodyChars?: number } = {}) {
  const av = rule.active_version;
  let activeBody: unknown;
  if (opts.includeBody && av) {
    let parsed: unknown = av.response_body;
    try { parsed = JSON.parse(av.response_body); } catch { /* keep string */ }
    activeBody = shapeBody(parsed, opts.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS).body;
  }
  return {
    rule_id: rule.id,
    name: rule.name,
    url_pattern: rule.url_pattern,
    method: rule.method ?? 'ANY',
    match_type: rule.match_type,
    enabled: !!rule.is_active,
    delay_ms: rule.delay_ms,
    ...(rule.folder_name ? { folder: rule.folder_name } : {}),
    ...(rule.condition_field_type
      ? { condition: { type: rule.condition_field_type, key: rule.condition_field_key, value: rule.condition_field_value } }
      : {}),
    active_version: av ? { id: av.id, name: av.name, status: av.response_status } : null,
    versions: (rule.versions ?? []).map((v) => ({ id: v.id, name: v.name, status: v.response_status, active: v.id === rule.active_version_id })),
    ...(opts.includeBody && av ? { active_body: activeBody } : {}),
  };
}
