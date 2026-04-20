import { Router, Request, Response } from 'express';
import { getDb } from '../db';

const router = Router();

// GET /api/shared/:token - public read-only access to a shared request
router.get('/:token', (req: Request, res: Response): void => {
  const db = getDb();
  const log = db.prepare(
    'SELECT * FROM request_logs WHERE share_token = ?'
  ).get(req.params['token']);

  if (!log) {
    res.status(404).json({ error: 'Shared request not found' });
    return;
  }

  res.json(log);
});

export default router;
