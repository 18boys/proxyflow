import { getDb } from './db';

export const MATCH_TYPES = ['exact', 'wildcard', 'regex'] as const;

/**
 * Normalise a user-supplied URL / path into the pattern stored on a mock rule.
 *   - "https://api.x.com/users/1?a=b" -> "/users/1"
 *   - "/users/:id" or "/users/{id}"   -> "/users/*"   (hadParams = true)
 * Regex patterns are kept verbatim: they are matched against the pathname as-is.
 */
export function normalizeUrlPattern(input: string, matchType?: string): { pattern: string; hadParams: boolean } {
  if (matchType === 'regex') return { pattern: input, hadParams: false };

  let pathname: string;
  try {
    pathname = new URL(input).pathname;
  } catch {
    pathname = input.split('?')[0];
  }
  const withoutParams = pathname
    .replace(/\/:[A-Za-z_][\w-]*/g, '/*')
    .replace(/\/\{[^/}]+\}/g, '/*');
  return { pattern: withoutParams, hadParams: withoutParams !== pathname };
}

/** Clamp a stored status code to something Node's http layer will accept. */
export function safeStatus(status: unknown, fallback = 200): number {
  const n = Number(status);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : fallback;
}

export function parseHeaders(json: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
      return out;
    }
  } catch { /* fall through */ }
  return { 'Content-Type': 'application/json' };
}

// Headers that describe the *original* transport and must not be replayed by a mock.
const HOP_HEADERS = new Set([
  'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie',
]);

export function stripHopHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !HOP_HEADERS.has(k.toLowerCase())));
}

export interface RuleLookup {
  id: number;
  method: string | null;
  match_type: string;
  url_pattern: string;
  is_active: number;
  active_version_id: number | null;
  [key: string]: unknown;
}

/**
 * Find a user's rules by pattern. With `method` given, only that method (or null = "any" when
 * method === null). With method === undefined, every method matches.
 */
export function findRulesByPattern(userId: number, rawPattern: string, method: string | null | undefined): RuleLookup[] {
  const { pattern } = normalizeUrlPattern(rawPattern);
  // Regex rules keep their raw pattern, so look those up by the raw string too.
  const patterns = pattern === rawPattern ? [pattern] : [pattern, rawPattern];
  const marks = patterns.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT * FROM mock_rules WHERE user_id = ? AND url_pattern IN (${marks}) ORDER BY id ASC`
  ).all(userId, ...patterns) as RuleLookup[];
  if (method === undefined) return rows;
  return rows.filter((r) => (r.method ?? null) === method);
}
