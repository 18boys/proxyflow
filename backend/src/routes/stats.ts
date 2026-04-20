import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';

const router = Router();

// GET /api/stats/today - today's stats for the current user's account (global across all users for online count)
router.get('/today', requireAuth, (_req: AuthRequest, res: Response): void => {
  const db = getDb();

  const todayRequests = (db.prepare(
    "SELECT COUNT(*) as count FROM request_logs WHERE date(created_at) = date(datetime('now', '+8 hours'))"
  ).get() as { count: number }).count;

  const todayOnlineUsers = (db.prepare(
    "SELECT COUNT(DISTINCT user_id) as count FROM request_logs WHERE date(created_at) = date(datetime('now', '+8 hours')) AND user_id IS NOT NULL"
  ).get() as { count: number }).count;

  res.json({
    today_requests: todayRequests,
    today_online_users: todayOnlineUsers,
  });
});

export default router;
