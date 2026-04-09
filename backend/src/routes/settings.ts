import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';

const router = Router();

// GET /api/settings - get user settings
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const settings = db.prepare(
    'SELECT * FROM user_settings WHERE user_id = ?'
  ).get(req.userId!) as { exclusion_domains: string } | undefined;

  res.json({
    exclusion_domains: settings ? JSON.parse(settings.exclusion_domains) : [],
  });
});

// PUT /api/settings/exclusions - update exclusion domains
router.put('/exclusions', requireAuth, (req: AuthRequest, res: Response): void => {
  const { domains } = req.body as { domains: string[] };

  if (!Array.isArray(domains)) {
    res.status(400).json({ error: 'domains must be an array of strings' });
    return;
  }

  // Normalise: trim whitespace, remove empty entries, lowercase
  const cleaned = domains
    .map((d) => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
    .filter((d) => d.length > 0);

  const db = getDb();

  // Upsert user settings
  db.prepare(`
    INSERT INTO user_settings (user_id, exclusion_domains, updated_at)
    VALUES (?, ?, datetime('now', '+8 hours'))
    ON CONFLICT(user_id) DO UPDATE SET
      exclusion_domains = excluded.exclusion_domains,
      updated_at = excluded.updated_at
  `).run(req.userId!, JSON.stringify(cleaned));

  res.json({ exclusion_domains: cleaned });
});

export default router;
