import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import {
  AiConfigInput,
  defaultEndpoint,
  decryptApiKey,
  encryptApiKey,
  getPublicAiSettings,
  getStoredAiSettings,
  normalizeAiProtocol,
  testAiConnection,
  validateAiEndpoint,
} from '../aiProvider';

const router = Router();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Connection test timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

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

  // Try update first
  const info = db.prepare(`
    UPDATE user_settings SET exclusion_domains = ?, updated_at = datetime('now', '+8 hours')
    WHERE user_id = ?
  `).run(JSON.stringify(cleaned), req.userId!);

  if (info.changes === 0) {
    db.prepare(`
      INSERT INTO user_settings (user_id, exclusion_domains)
      VALUES (?, ?)
    `).run(req.userId!, JSON.stringify(cleaned));
  }

  res.json({ exclusion_domains: cleaned });
});

// GET /api/settings/ai - get personal AI settings without exposing the API key
router.get('/ai', requireAuth, (req: AuthRequest, res: Response): void => {
  res.json(getPublicAiSettings(req.userId!));
});

// PUT /api/settings/ai - save personal AI settings
router.put('/ai', requireAuth, (req: AuthRequest, res: Response): void => {
  const protocol = normalizeAiProtocol(req.body.protocol);
  const endpoint = typeof req.body.endpoint === 'string' ? req.body.endpoint.trim().replace(/\/+$/, '') : '';
  const model = typeof req.body.model === 'string' ? req.body.model.trim() : '';
  const enabled = Boolean(req.body.enabled);

  if (!protocol) {
    res.status(400).json({ error: 'protocol must be "openai" or "anthropic"' });
    return;
  }
  if (!endpoint || !validateAiEndpoint(endpoint)) {
    res.status(400).json({ error: 'endpoint must be a valid HTTP or HTTPS URL' });
    return;
  }
  if (!model) {
    res.status(400).json({ error: 'model is required' });
    return;
  }

  const stored = getStoredAiSettings(req.userId!);
  let encryptedApiKey = stored?.protocol === protocol ? stored.api_key_encrypted : null;
  if (req.body.api_key === null) {
    encryptedApiKey = null;
  } else if (typeof req.body.api_key === 'string' && req.body.api_key.trim()) {
    encryptedApiKey = encryptApiKey(req.body.api_key.trim());
  }

  if (enabled && protocol === 'anthropic' && !encryptedApiKey) {
    res.status(400).json({ error: 'Anthropic protocol requires an API key' });
    return;
  }

  getDb().prepare(`
    INSERT INTO user_ai_settings
      (user_id, enabled, protocol, endpoint, model, api_key_encrypted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      protocol = excluded.protocol,
      endpoint = excluded.endpoint,
      model = excluded.model,
      api_key_encrypted = excluded.api_key_encrypted,
      updated_at = datetime('now', '+8 hours')
  `).run(req.userId!, enabled ? 1 : 0, protocol, endpoint, model, encryptedApiKey);

  res.json(getPublicAiSettings(req.userId!));
});

// POST /api/settings/ai/test - test settings without saving them
router.post('/ai/test', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const protocol = normalizeAiProtocol(req.body.protocol);
  const endpoint = typeof req.body.endpoint === 'string'
    ? req.body.endpoint.trim().replace(/\/+$/, '')
    : protocol ? defaultEndpoint(protocol) : '';
  const model = typeof req.body.model === 'string' ? req.body.model.trim() : '';

  if (!protocol || !endpoint || !validateAiEndpoint(endpoint) || !model) {
    res.status(400).json({ error: 'Valid protocol, endpoint, and model are required' });
    return;
  }

  const stored = getStoredAiSettings(req.userId!);
  let apiKey = stored?.protocol === protocol
    ? decryptApiKey(stored.api_key_encrypted || null)
    : null;
  if (req.body.api_key === null) apiKey = null;
  if (typeof req.body.api_key === 'string' && req.body.api_key.trim()) {
    apiKey = req.body.api_key.trim();
  }

  const config: AiConfigInput = { protocol, endpoint, model, apiKey };
  try {
    const result = await withTimeout(testAiConnection(config), 15_000);
    res.json({ success: true, message: result.slice(0, 200) });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed',
    });
  }
});

export default router;
