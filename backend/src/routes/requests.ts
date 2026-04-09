import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';

const router = Router();

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

  const headers = JSON.parse(log['request_headers'] as string || '{}') as Record<string, string>;
  let curl = `curl -X ${log['method']} '${log['url']}'`;

  // Add headers
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'host') {
      curl += ` \\\n  -H '${key}: ${value}'`;
    }
  }

  // Add body
  if (log['request_body']) {
    curl += ` \\\n  -d '${(log['request_body'] as string).replace(/'/g, "'\\''")}'`;
  }

  res.json({ curl });
});

export default router;
