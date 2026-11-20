import { Router, Request, Response } from 'express';
import { optionalAuth, requireAuth, AuthRequest } from '../auth';
import { buildCurl } from '../requestReplay';
import { deleteSharedRequest, getSharedRequest, listSharedRequests } from '../sharedRequests';

const router = Router();

// GET /api/shared/mine/list - list current user's permanently archived shared requests
router.get('/mine/list', requireAuth, (req: AuthRequest, res: Response): void => {
  const { search, limit } = req.query as { search?: string; limit?: string };
  const items = listSharedRequests(req.userId!, {
    search,
    limit: limit ? Number(limit) : undefined,
  });
  res.json({ count: items.length, items });
});

// DELETE /api/shared/mine/:token - delete one archived shared request owned by current user
router.delete('/mine/:token', requireAuth, (req: AuthRequest, res: Response): void => {
  const deleted = deleteSharedRequest(req.userId!, req.params['token']);
  if (!deleted) {
    res.status(404).json({ error: 'Shared request not found' });
    return;
  }
  res.json({ success: true });
});

// GET /api/shared/:token - public read-only access to a shared request
router.get('/:token', optionalAuth, (req: Request, res: Response): void => {
  const log = getSharedRequest(req.params['token']);

  if (!log) {
    res.status(404).json({ error: 'Shared request not found' });
    return;
  }

  res.json({ ...log, curl: buildCurl(log) });
});

// GET /api/shared/:token/curl - public cURL replay command
router.get('/:token/curl', (req: Request, res: Response): void => {
  const log = getSharedRequest(req.params['token']);

  if (!log) {
    res.status(404).json({ error: 'Shared request not found' });
    return;
  }

  res.json({ curl: buildCurl(log) });
});

export default router;
