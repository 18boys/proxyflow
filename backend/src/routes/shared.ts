import { Router, Request, Response } from 'express';
import { buildCurl } from '../requestReplay';
import { getSharedRequest } from '../sharedRequests';

const router = Router();

// GET /api/shared/:token - public read-only access to a shared request
router.get('/:token', (req: Request, res: Response): void => {
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
