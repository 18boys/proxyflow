import { Router, Response } from 'express';
import { requireAuth, AuthRequest, generateApiToken, hashApiToken } from '../auth';
import { getDb } from '../db';

const router = Router();

// GET /api/tokens - list current user's API tokens (no plaintext)
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const tokens = db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.userId!);

  res.json(tokens);
});

// POST /api/tokens - generate a new API token (plaintext returned once)
router.post('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);
  const tokenPrefix = token.slice(0, 12);

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO api_tokens (user_id, name, token_prefix, token_hash) VALUES (?, ?, ?, ?)'
  ).run(req.userId!, name, tokenPrefix, tokenHash);

  const row = db.prepare(
    'SELECT id, name, token_prefix, created_at, last_used_at, revoked_at FROM api_tokens WHERE id = ?'
  ).get(result.lastInsertRowid) as Record<string, unknown>;

  res.json({ ...row, token });
});

// DELETE /api/tokens/:id - revoke an API token
router.delete('/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const result = db.prepare(
    "UPDATE api_tokens SET revoked_at = datetime('now', '+8 hours') WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
  ).run(req.params['id'], req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
