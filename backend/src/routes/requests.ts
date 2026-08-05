import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { buildCurl } from '../requestReplay';
import { createSharedRequest } from '../sharedRequests';
import { matchUrlPattern } from '../proxy';

const router = Router();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

// GET /api/requests/wait - wait for the next request matching a URL pattern (for MCP tooling)
router.get('/wait', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { url_pattern, method } = req.query as { url_pattern?: string; method?: string };
  const timeoutMs = Math.min(60_000, Math.max(1000, Number(req.query['timeout_ms']) || 30_000));

  if (!url_pattern) {
    res.status(400).json({ error: 'url_pattern is required' });
    return;
  }

  const db = getDb();
  const normalizedMethod = method ? method.toUpperCase() : null;
  const sinceId = (db.prepare(
    'SELECT COALESCE(MAX(id), 0) AS id FROM request_logs WHERE user_id = ?'
  ).get(req.userId!) as { id: number }).id;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const logs = db.prepare(
      'SELECT * FROM request_logs WHERE user_id = ? AND id > ? ORDER BY id ASC'
    ).all(req.userId!, sinceId) as Record<string, unknown>[];

    const match = logs.find((log) => {
      if (normalizedMethod && (log['method'] as string).toUpperCase() !== normalizedMethod) return false;
      return matchUrlPattern(url_pattern, log['url'] as string, 'wildcard');
    });

    if (match) {
      res.json({
        matched: true,
        request: {
          ...match,
          request_body: tryParseJson(match['request_body']),
          response_body: tryParseJson(match['response_body']),
        },
      });
      return;
    }

    await sleep(500);
  }

  res.json({ matched: false });
});

// GET /api/requests - list with filters
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const {
    url,
    method,
    status,
    sessionId,
    startTime,
    endTime,
    page = '1',
    limit = '100',
  } = req.query as Record<string, string>;

  // Show logs belonging to this user
  let query = 'SELECT * FROM request_logs WHERE user_id = ?';
  const params: unknown[] = [req.userId!];

  if (url) {
    query += ' AND url LIKE ?';
    params.push(`%${url}%`);
  }
  if (method) {
    query += ' AND method = ?';
    params.push(method.toUpperCase());
  }
  if (status) {
    if (status.endsWith('xx')) {
      const prefix = status[0];
      query += ' AND response_status >= ? AND response_status < ?';
      params.push(Number(prefix) * 100, (Number(prefix) + 1) * 100);
    } else {
      query += ' AND response_status = ?';
      params.push(Number(status));
    }
  }
  if (sessionId) {
    query += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (startTime) {
    query += ' AND created_at >= ?';
    params.push(startTime);
  }
  if (endTime) {
    query += ' AND created_at <= ?';
    params.push(endTime);
  }

  const offset = (Number(page) - 1) * Number(limit);
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  const logs = db.prepare(query).all(...params);
  const total = (db.prepare(
    query.replace('SELECT *', 'SELECT COUNT(*) as count').split('ORDER BY')[0]
  ).get(...params.slice(0, -2)) as { count: number }).count;

  res.json({ logs, total, page: Number(page), limit: Number(limit) });
});

// GET /api/requests/:id
router.get('/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const log = db.prepare(
    'SELECT * FROM request_logs WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!);

  if (!log) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  res.json(log);
});

// DELETE /api/requests - clear all requests
router.delete('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const result = db.prepare('DELETE FROM request_logs WHERE user_id = ?').run(req.userId!);
  res.json({ deleted: result.changes });
});

// GET /api/requests/:id/curl - export as cURL
router.get('/:id/curl', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const log = db.prepare(
    'SELECT * FROM request_logs WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!) as Record<string, unknown> | undefined;

  if (!log) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  res.json({ curl: buildCurl(log) });
});

// POST /api/requests/:id/share - generate a permanent share token
router.post('/:id/share', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const log = db.prepare(
    'SELECT * FROM request_logs WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!) as Record<string, unknown> | undefined;

  if (!log) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  let shareToken = log['share_token'] as string | null;
  if (!shareToken) {
    shareToken = randomUUID();
  }

  const saveShare = db.transaction(() => {
    db.prepare(
      "UPDATE request_logs SET share_token = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?"
    ).run(shareToken, Number(req.params['id']));
    createSharedRequest(shareToken!, log);
  });
  saveShare();

  res.json({ share_token: shareToken });
});

export default router;
