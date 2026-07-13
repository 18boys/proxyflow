import { getDb } from './db';

export type RequestSnapshot = Record<string, unknown>;

function persistSnapshot(token: string, log: RequestSnapshot): RequestSnapshot {
  const db = getDb();
  const snapshot = { ...log, share_token: token };

  db.prepare(`
    INSERT OR IGNORE INTO shared_requests
      (share_token, owner_user_id, source_request_id, request_snapshot, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    token,
    Number(log['user_id']),
    Number(log['id']),
    JSON.stringify(snapshot),
  );

  return snapshot;
}

export function createSharedRequest(token: string, log: RequestSnapshot): RequestSnapshot {
  return persistSnapshot(token, log);
}

export function getSharedRequest(token: string): RequestSnapshot | undefined {
  const db = getDb();
  const shared = db.prepare(
    'SELECT request_snapshot FROM shared_requests WHERE share_token = ?'
  ).get(token) as { request_snapshot: string } | undefined;

  if (shared) {
    try {
      return JSON.parse(shared.request_snapshot) as RequestSnapshot;
    } catch {
      return undefined;
    }
  }

  // Backfill links created before shared requests had their own permanent table.
  const legacyLog = db.prepare(
    'SELECT * FROM request_logs WHERE share_token = ?'
  ).get(token) as RequestSnapshot | undefined;

  return legacyLog ? persistSnapshot(token, legacyLog) : undefined;
}
