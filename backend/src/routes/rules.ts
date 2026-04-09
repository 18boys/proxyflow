import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';

const router = Router();

// GET /api/rules - list all mock rules (same as mocks but focused on routing)
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rules = db.prepare(
    'SELECT mr.*, mv.name as active_version_name FROM mock_rules mr LEFT JOIN mock_versions mv ON mr.active_version_id = mv.id WHERE mr.user_id = ? ORDER BY mr.created_at DESC'
  ).all(req.userId!) as Record<string, unknown>[];

  const enriched = rules.map((rule) => {
    const versions = db.prepare(
      'SELECT id, name, response_status FROM mock_versions WHERE rule_id = ? ORDER BY created_at ASC'
    ).all(rule['id']);
    return { ...rule, versions };
  });

  res.json(enriched);
});

// POST /api/rules/global - set global mock/proxy mode
router.post('/global', requireAuth, (req: AuthRequest, res: Response): void => {
  const { mode } = req.body; // 'mock' | 'proxy'

  if (!['mock', 'proxy'].includes(mode)) {
    res.status(400).json({ error: 'mode must be "mock" or "proxy"' });
    return;
  }

  const db = getDb();
  const isActive = mode === 'mock' ? 1 : 0;
  db.prepare(
    'UPDATE mock_rules SET is_active = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE user_id = ?'
  ).run(isActive, req.userId!);

  res.json({ success: true, mode });
});

// PATCH /api/rules/:id/toggle - toggle a single rule's active state
router.patch('/:id/toggle', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!) as { is_active: number } | undefined;

  if (!rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  const newState = rule.is_active ? 0 : 1;
  db.prepare(
    'UPDATE mock_rules SET is_active = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND user_id = ?'
  ).run(newState, Number(req.params['id']), req.userId!);

  res.json({ is_active: newState });
});

// PATCH /api/rules/:id/version - set active version
router.patch('/:id/version', requireAuth, (req: AuthRequest, res: Response): void => {
  const { versionId } = req.body;

  const db = getDb();
  const result = db.prepare(
    'UPDATE mock_rules SET active_version_id = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND user_id = ?'
  ).run(versionId, Number(req.params['id']), req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
