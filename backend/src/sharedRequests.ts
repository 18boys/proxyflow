import { randomUUID } from 'crypto';
import { getDb } from './db';

export type RequestSnapshot = Record<string, unknown>;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
]);

function normalizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

export function redactHeadersValue(rawHeaders: unknown): string {
  let obj: Record<string, unknown> = {};
  if (typeof rawHeaders === 'string') {
    try {
      const parsed = JSON.parse(rawHeaders || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      return '{}';
    }
  } else if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    obj = rawHeaders as Record<string, unknown>;
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    const sensitive = SENSITIVE_HEADERS.has(lower) || /token|secret|session|signature/i.test(lower);
    out[k] = sensitive ? '[REDACTED]' : String(v);
  }
  return JSON.stringify(out);
}

function buildSnapshot(token: string, log: RequestSnapshot, redactSensitive: boolean): RequestSnapshot {
  const snapshot: RequestSnapshot = {
    ...log,
    share_token: token,
    redacted: redactSensitive,
  };
  if (redactSensitive) {
    snapshot['request_headers'] = redactHeadersValue(log['request_headers']);
    snapshot['response_headers'] = redactHeadersValue(log['response_headers']);
  }
  return snapshot;
}

function persistSnapshot(
  token: string,
  log: RequestSnapshot,
  options: { title?: string | null; note?: string | null; redactSensitive?: boolean } = {},
): RequestSnapshot {
  const db = getDb();
  const redactSensitive = Boolean(options.redactSensitive);
  const title = normalizeText(options.title, 160);
  const note = normalizeText(options.note, 2000);
  const snapshot = buildSnapshot(token, log, redactSensitive);

  db.prepare(`
    INSERT OR IGNORE INTO shared_requests
      (share_token, owner_user_id, source_request_id, title, note, request_snapshot, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    token,
    Number(log['user_id']),
    Number(log['id']),
    title,
    note,
    JSON.stringify(snapshot),
  );

  return { ...snapshot, title, note };
}

export function createSharedRequest(
  token: string,
  log: RequestSnapshot,
  options: { title?: string | null; note?: string | null; redactSensitive?: boolean } = {},
): RequestSnapshot {
  return persistSnapshot(token, log, options);
}

export interface CreateOrUpdateShareResult {
  share_token: string;
  title: string | null;
  note: string | null;
  redacted: boolean;
  created: boolean;
  created_at: string;
}

export function createOrUpdateSharedRequest(
  log: RequestSnapshot,
  options: { title?: unknown; note?: unknown; redactSensitive?: boolean } = {},
): CreateOrUpdateShareResult {
  const db = getDb();
  const ownerUserId = Number(log['user_id']);
  const sourceRequestId = Number(log['id']);
  const redactSensitive = Boolean(options.redactSensitive);
  const hasTitle = options.title !== undefined;
  const hasNote = options.note !== undefined;
  const normalizedTitle = normalizeText(options.title, 160);
  const normalizedNote = normalizeText(options.note, 2000);

  // Check if an archive already exists for this request with the same redaction mode.
  const existingRows = db.prepare(`
    SELECT share_token, title, note, request_snapshot, created_at
    FROM shared_requests
    WHERE owner_user_id = ? AND source_request_id = ?
    ORDER BY id DESC
  `).all(ownerUserId, sourceRequestId) as Array<{
    share_token: string;
    title: string | null;
    note: string | null;
    request_snapshot: string;
    created_at: string;
  }>;

  const matched = existingRows.find((row) => {
    try {
      const parsed = JSON.parse(row.request_snapshot) as RequestSnapshot;
      return Boolean(parsed['redacted']) === redactSensitive;
    } catch {
      return !redactSensitive;
    }
  });

  if (matched) {
    const nextTitle = hasTitle ? normalizedTitle : matched.title;
    const nextNote = hasNote ? normalizedNote : matched.note;
    if (hasTitle || hasNote) {
      db.prepare(`
        UPDATE shared_requests
        SET title = ?, note = ?, updated_at = datetime('now', '+8 hours')
        WHERE share_token = ?
      `).run(nextTitle, nextNote, matched.share_token);
    }
    return {
      share_token: matched.share_token,
      title: nextTitle,
      note: nextNote,
      redacted: redactSensitive,
      created: false,
      created_at: matched.created_at,
    };
  }

  const existingLogToken = typeof log['share_token'] === 'string' && log['share_token'] ? log['share_token'] : null;
  // Reuse the log's share_token if it doesn't collide with another row's redaction mode.
  const canReuseLogToken = Boolean(
    existingLogToken && !existingRows.some((row) => row.share_token === existingLogToken),
  );
  const shareToken = canReuseLogToken ? existingLogToken! : randomUUID();

  const snapshot = buildSnapshot(shareToken, log, redactSensitive);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO shared_requests
        (share_token, owner_user_id, source_request_id, title, note, request_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `).run(
      shareToken,
      ownerUserId,
      sourceRequestId,
      normalizedTitle,
      normalizedNote,
      JSON.stringify(snapshot),
    );

    if (!existingLogToken) {
      db.prepare(
        "UPDATE request_logs SET share_token = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?",
      ).run(shareToken, sourceRequestId);
    }
  })();

  const inserted = db.prepare(
    'SELECT created_at FROM shared_requests WHERE share_token = ?',
  ).get(shareToken) as { created_at: string } | undefined;

  return {
    share_token: shareToken,
    title: normalizedTitle,
    note: normalizedNote,
    redacted: redactSensitive,
    created: true,
    created_at: inserted?.created_at || new Date().toISOString(),
  };
}

export function getSharedRequest(token: string): RequestSnapshot | undefined {
  const db = getDb();
  const shared = db.prepare(
    'SELECT share_token, title, note, request_snapshot, created_at, updated_at FROM shared_requests WHERE share_token = ?',
  ).get(token) as {
    share_token: string;
    title: string | null;
    note: string | null;
    request_snapshot: string;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (shared) {
    try {
      const parsed = JSON.parse(shared.request_snapshot) as RequestSnapshot;
      return {
        ...parsed,
        share_token: shared.share_token,
        title: shared.title ?? (parsed['title'] as string | null) ?? null,
        note: shared.note ?? (parsed['note'] as string | null) ?? null,
        archived_at: shared.created_at,
      };
    } catch {
      return undefined;
    }
  }

  // Backfill links created before shared requests had their own permanent table.
  const legacyLog = db.prepare(
    'SELECT * FROM request_logs WHERE share_token = ?',
  ).get(token) as RequestSnapshot | undefined;

  return legacyLog ? persistSnapshot(token, legacyLog) : undefined;
}

export interface SharedRequestSummary {
  share_token: string;
  source_request_id: number | null;
  title: string | null;
  note: string | null;
  method: string;
  url: string;
  response_status: number | null;
  is_mocked: number;
  duration_ms: number | null;
  redacted: boolean;
  created_at: string;
  updated_at: string;
}

export function listSharedRequests(
  userId: number,
  options: { search?: string; limit?: number } = {},
): SharedRequestSummary[] {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const search = typeof options.search === 'string' ? options.search.trim().toLowerCase() : '';

  const rows = db.prepare(`
    SELECT share_token, source_request_id, title, note, request_snapshot, created_at, updated_at
    FROM shared_requests
    WHERE owner_user_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(userId) as Array<{
    share_token: string;
    source_request_id: number | null;
    title: string | null;
    note: string | null;
    request_snapshot: string;
    created_at: string;
    updated_at: string;
  }>;

  const items: SharedRequestSummary[] = [];
  for (const row of rows) {
    let snap: RequestSnapshot = {};
    try {
      snap = JSON.parse(row.request_snapshot) as RequestSnapshot;
    } catch {
      continue;
    }

    const method = String(snap['method'] || 'GET');
    const url = String(snap['url'] || '');
    const title = row.title ?? null;
    const note = row.note ?? null;

    if (search) {
      const hay = [title, note, url, method, row.share_token]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) continue;
    }

    items.push({
      share_token: row.share_token,
      source_request_id: row.source_request_id,
      title,
      note,
      method,
      url,
      response_status: typeof snap['response_status'] === 'number' ? snap['response_status'] : null,
      is_mocked: Number(snap['is_mocked']) ? 1 : 0,
      duration_ms: typeof snap['duration_ms'] === 'number' ? snap['duration_ms'] : null,
      redacted: Boolean(snap['redacted']),
      created_at: row.created_at,
      updated_at: row.updated_at,
    });

    if (items.length >= limit) break;
  }

  return items;
}

export function deleteSharedRequest(userId: number, token: string): boolean {
  const db = getDb();
  const res = db.prepare(
    'DELETE FROM shared_requests WHERE share_token = ? AND owner_user_id = ?',
  ).run(token, userId);
  return res.changes > 0;
}
