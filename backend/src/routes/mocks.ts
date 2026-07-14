import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { getSharedRequest } from '../sharedRequests';

const router = Router();

function parseDelayMs(value: unknown): number | null {
  const delay = Number(value);
  if (!Number.isFinite(delay) || delay < 0 || delay > 60_000) return null;
  return Math.round(delay);
}

function parseFolderId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const folderId = Number(value);
  return Number.isInteger(folderId) && folderId > 0 ? folderId : null;
}

function folderBelongsToUser(folderId: number | null, userId: number): boolean {
  if (folderId === null) return true;
  return Boolean(getDb().prepare(
    'SELECT id FROM mock_folders WHERE id = ? AND user_id = ?'
  ).get(folderId, userId));
}

function normalizeFolderName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

// ── Folders ───────────────────────────────────────────────────────────────

router.get('/folders', requireAuth, (req: AuthRequest, res: Response): void => {
  const folders = getDb().prepare(`
    SELECT mf.*, COUNT(mr.id) AS mock_count
    FROM mock_folders mf
    LEFT JOIN mock_rules mr ON mr.folder_id = mf.id
    WHERE mf.user_id = ?
    GROUP BY mf.id
    ORDER BY mf.name COLLATE NOCASE ASC
  `).all(req.userId!);
  res.json(folders);
});

router.post('/folders', requireAuth, (req: AuthRequest, res: Response): void => {
  const name = normalizeFolderName(req.body.name);
  if (!name) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }

  const db = getDb();
  const duplicate = db.prepare(
    'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
  ).get(req.userId!, name);
  if (duplicate) {
    res.status(409).json({ error: 'A folder with this name already exists' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO mock_folders (user_id, name, created_at, updated_at)
    VALUES (?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(req.userId!, name);
  res.status(201).json(db.prepare('SELECT *, 0 AS mock_count FROM mock_folders WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/folders/:folderId', requireAuth, (req: AuthRequest, res: Response): void => {
  const name = normalizeFolderName(req.body.name);
  if (!name) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }

  const db = getDb();
  const folderId = Number(req.params['folderId']);
  const duplicate = db.prepare(
    'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?'
  ).get(req.userId!, name, folderId);
  if (duplicate) {
    res.status(409).json({ error: 'A folder with this name already exists' });
    return;
  }

  const result = db.prepare(`
    UPDATE mock_folders SET name = ?, updated_at = datetime('now', '+8 hours')
    WHERE id = ? AND user_id = ?
  `).run(name, folderId, req.userId!);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }
  res.json(db.prepare('SELECT * FROM mock_folders WHERE id = ?').get(folderId));
});

router.delete('/folders/:folderId', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const folderId = Number(req.params['folderId']);
  const result = db.prepare(
    'DELETE FROM mock_folders WHERE id = ? AND user_id = ?'
  ).run(folderId, req.userId!);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }
  res.json({ success: true });
});

// GET /api/mocks - list rules with search
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { search } = req.query as { search?: string };

  let query = `
    SELECT mr.*, mf.name AS folder_name
    FROM mock_rules mr
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.user_id = ?
  `;
  const params: unknown[] = [req.userId!];

  if (search) {
    query += ' AND (mr.name LIKE ? OR mr.url_pattern LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY mr.created_at DESC';

  const rules = db.prepare(query).all(...params) as Record<string, unknown>[];

  // Attach version count to each rule
  const enriched = rules.map((rule) => {
    const versions = db.prepare(
      'SELECT id, name, response_status FROM mock_versions WHERE rule_id = ? ORDER BY created_at ASC'
    ).all(rule['id']);

    const activeVersion = rule['active_version_id']
      ? db.prepare('SELECT * FROM mock_versions WHERE id = ?').get(rule['active_version_id'])
      : null;

    return { ...rule, version_count: versions.length, versions, active_version: activeVersion };
  });

  res.json(enriched);
});

// POST /api/mocks - create rule
router.post('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    name, url_pattern, match_type = 'exact', method,
    folder_id, delay_ms = 0, condition_field_type, condition_field_key, condition_field_value,
  } = req.body;

  if (!name || !url_pattern) {
    res.status(400).json({ error: 'name and url_pattern are required' });
    return;
  }

  const normalizedDelayMs = parseDelayMs(delay_ms);
  if (normalizedDelayMs === null) {
    res.status(400).json({ error: 'delay_ms must be between 0 and 60000' });
    return;
  }

  const normalizedFolderId = parseFolderId(folder_id);
  if (folder_id !== undefined && folder_id !== null && folder_id !== '' && normalizedFolderId === null) {
    res.status(400).json({ error: 'folder_id must be a positive integer or null' });
    return;
  }
  if (!folderBelongsToUser(normalizedFolderId, req.userId!)) {
    res.status(400).json({ error: 'Folder not found' });
    return;
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO mock_rules
      (user_id, folder_id, name, url_pattern, match_type, method, delay_ms,
       condition_field_type, condition_field_key, condition_field_value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    req.userId!, normalizedFolderId, name, url_pattern, match_type, method || null, normalizedDelayMs,
    condition_field_type || null, condition_field_key || null, condition_field_value || null,
  );

  const rule = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(rule);
});

// GET /api/mocks/:id
router.get('/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!);

  if (!rule) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  res.json(rule);
});

// PUT /api/mocks/:id - update rule
router.put('/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!) as Record<string, unknown> | undefined;

  if (!rule) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  const {
    name, url_pattern, match_type, method, folder_id, is_active,
    active_version_id, delay_ms, condition_field_type, condition_field_key, condition_field_value,
  } = req.body;

  if (delay_ms !== undefined && parseDelayMs(delay_ms) === null) {
    res.status(400).json({ error: 'delay_ms must be between 0 and 60000' });
    return;
  }

  const normalizedFolderId = parseFolderId(folder_id);
  if (folder_id !== undefined) {
    if (folder_id !== null && folder_id !== '' && normalizedFolderId === null) {
      res.status(400).json({ error: 'folder_id must be a positive integer or null' });
      return;
    }
    if (!folderBelongsToUser(normalizedFolderId, req.userId!)) {
      res.status(400).json({ error: 'Folder not found' });
      return;
    }
  }

  if (active_version_id !== undefined && active_version_id !== null) {
    const ownedVersion = db.prepare(
      'SELECT id FROM mock_versions WHERE id = ? AND rule_id = ? AND user_id = ?'
    ).get(Number(active_version_id), Number(req.params['id']), req.userId!);
    if (!ownedVersion) {
      res.status(400).json({ error: 'active_version_id must belong to this mock rule' });
      return;
    }
  }

  db.prepare(`
    UPDATE mock_rules SET
      name = COALESCE(?, name),
      folder_id = ?,
      url_pattern = COALESCE(?, url_pattern),
      match_type = COALESCE(?, match_type),
      method = ?,
      is_active = COALESCE(?, is_active),
      active_version_id = ?,
      delay_ms = COALESCE(?, delay_ms),
      condition_field_type = ?,
      condition_field_key = ?,
      condition_field_value = ?,
      updated_at = datetime('now', '+8 hours')
    WHERE id = ? AND user_id = ?
  `).run(
    name ?? null,
    folder_id !== undefined ? normalizedFolderId : rule['folder_id'],
    url_pattern ?? null, match_type ?? null,
    method !== undefined ? method : rule['method'],
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    active_version_id !== undefined ? active_version_id : rule['active_version_id'],
    delay_ms !== undefined ? parseDelayMs(delay_ms) : null,
    condition_field_type !== undefined ? condition_field_type : rule['condition_field_type'],
    condition_field_key !== undefined ? condition_field_key : rule['condition_field_key'],
    condition_field_value !== undefined ? condition_field_value : rule['condition_field_value'],
    Number(req.params['id']), req.userId!,
  );

  const updated = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(Number(req.params['id']));
  res.json(updated);
});

// DELETE /api/mocks/:id - delete rule
router.delete('/:id', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM mock_rules WHERE id = ? AND user_id = ?'
  ).run(Number(req.params['id']), req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  res.json({ success: true });
});

// ── Versions ──────────────────────────────────────────────────────────────

// GET /api/mocks/:id/versions
router.get('/:id/versions', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!);

  if (!rule) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  const versions = db.prepare(
    'SELECT * FROM mock_versions WHERE rule_id = ? ORDER BY created_at ASC'
  ).all(Number(req.params['id']));

  res.json(versions);
});

// POST /api/mocks/:id/versions - add version
router.post('/:id/versions', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!);

  if (!rule) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  const {
    name,
    response_status = 200,
    response_headers = '{"Content-Type":"application/json"}',
    response_body = '{}',
  } = req.body;

  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  // Normalize response_headers: accept both object and JSON string
  let headersStr: string;
  if (typeof response_headers === 'object' && response_headers !== null) {
    headersStr = JSON.stringify(response_headers);
  } else {
    headersStr = response_headers;
  }

  // Validate JSON body
  try {
    JSON.parse(response_body);
  } catch {
    res.status(400).json({ error: 'response_body must be valid JSON' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    Number(req.params['id']), req.userId!, name,
    response_status, headersStr, response_body,
  );

  const version = db.prepare('SELECT * FROM mock_versions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(version);
});

// PUT /api/mocks/:id/versions/:vid - update version
router.put('/:id/versions/:vid', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const version = db.prepare(
    'SELECT mv.* FROM mock_versions mv JOIN mock_rules mr ON mv.rule_id = mr.id WHERE mv.id = ? AND mr.user_id = ?'
  ).get(Number(req.params['vid']), req.userId!);

  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const { name, response_status, response_headers, response_body } = req.body;

  if (response_body !== undefined) {
    try {
      JSON.parse(response_body);
    } catch {
      res.status(400).json({ error: 'response_body must be valid JSON' });
      return;
    }
  }

  // Normalize response_headers: accept both object and JSON string
  let headersStr: string | null = null;
  if (response_headers !== undefined && response_headers !== null) {
    headersStr = typeof response_headers === 'object'
      ? JSON.stringify(response_headers)
      : response_headers;
  }

  db.prepare(`
    UPDATE mock_versions SET
      name = COALESCE(?, name),
      response_status = COALESCE(?, response_status),
      response_headers = COALESCE(?, response_headers),
      response_body = COALESCE(?, response_body),
      updated_at = datetime('now', '+8 hours')
    WHERE id = ?
  `).run(
    name ?? null, response_status ?? null, headersStr, response_body ?? null,
    Number(req.params['vid']),
  );

  const updated = db.prepare('SELECT * FROM mock_versions WHERE id = ?').get(Number(req.params['vid']));
  res.json(updated);
});

// DELETE /api/mocks/:id/versions/:vid
router.delete('/:id/versions/:vid', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const version = db.prepare(
    'SELECT mv.*, mr.active_version_id FROM mock_versions mv JOIN mock_rules mr ON mv.rule_id = mr.id WHERE mv.id = ? AND mr.id = ? AND mr.user_id = ?'
  ).get(Number(req.params['vid']), Number(req.params['id']), req.userId!) as Record<string, unknown> | undefined;

  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const deleteVersion = db.transaction(() => {
    db.prepare('DELETE FROM mock_versions WHERE id = ?').run(Number(req.params['vid']));
    if (Number(version['active_version_id']) === Number(req.params['vid'])) {
      db.prepare(`
        UPDATE mock_rules
        SET active_version_id = NULL, is_active = 0, updated_at = datetime('now', '+8 hours')
        WHERE id = ? AND user_id = ?
      `).run(Number(req.params['id']), req.userId!);
    }
  });
  deleteVersion();

  const rule = db.prepare(
    'SELECT * FROM mock_rules WHERE id = ? AND user_id = ?'
  ).get(Number(req.params['id']), req.userId!);
  res.json({ success: true, rule });
});

// POST /api/mocks/:id/versions/:vid/select - activate this version
router.post('/:id/versions/:vid/select', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const version = db.prepare(
    'SELECT id FROM mock_versions WHERE id = ? AND rule_id = ? AND user_id = ?'
  ).get(Number(req.params['vid']), Number(req.params['id']), req.userId!);
  if (!version) {
    res.status(404).json({ error: 'Version not found' });
    return;
  }

  const result = db.prepare(
    'UPDATE mock_rules SET active_version_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?'
  ).run(Number(req.params['vid']), Number(req.params['id']), req.userId!);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }
  res.json({ success: true });
});

// GET /api/mocks/export - export all mocks
router.get('/data/export', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const folders = db.prepare(
    'SELECT id, name FROM mock_folders WHERE user_id = ? ORDER BY name COLLATE NOCASE'
  ).all(req.userId!);
  const rules = db.prepare(`
    SELECT mr.*, mf.name AS folder_name
    FROM mock_rules mr
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.user_id = ?
  `).all(req.userId!) as Record<string, unknown>[];
  const data = rules.map((rule) => {
    const versions = db.prepare('SELECT * FROM mock_versions WHERE rule_id = ?').all(rule['id']);
    return { ...rule, versions };
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="proxyflow-mocks.json"');
  res.json({ version: '1.1', exported_at: new Date().toISOString(), folders, mocks: data });
});

// POST /api/mocks/import - import mocks
router.post('/data/import', requireAuth, (req: AuthRequest, res: Response): void => {
  const { mocks } = req.body;

  if (!Array.isArray(mocks)) {
    res.status(400).json({ error: 'Invalid format: expected { mocks: [...] }' });
    return;
  }

  const db = getDb();
  let imported = 0;

  const findOrCreateFolder = (folderNameValue: unknown): number | null => {
    const folderName = normalizeFolderName(folderNameValue);
    if (!folderName) return null;
    const existing = db.prepare(
      'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
    ).get(req.userId!, folderName) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(db.prepare(`
      INSERT INTO mock_folders (user_id, name, created_at, updated_at)
      VALUES (?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `).run(req.userId!, folderName).lastInsertRowid);
  };

  const insertRule = db.prepare(`
    INSERT INTO mock_rules
      (user_id, folder_id, name, url_pattern, match_type, method, delay_ms,
       condition_field_type, condition_field_key, condition_field_value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `);

  const insertVersion = db.prepare(`
    INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `);

  const doImport = db.transaction(() => {
    for (const mock of mocks) {
      const folderId = findOrCreateFolder(mock.folder_name);
      const ruleResult = insertRule.run(
        req.userId!, folderId, mock.name || 'Imported Rule', mock.url_pattern || '/',
        mock.match_type || 'exact', mock.method || null, mock.delay_ms || 0,
        mock.condition_field_type || null, mock.condition_field_key || null, mock.condition_field_value || null,
      );
      const ruleId = ruleResult.lastInsertRowid;

      if (Array.isArray(mock.versions)) {
        for (const v of mock.versions) {
          insertVersion.run(
            ruleId, req.userId!, v.name || 'Imported Version',
            v.response_status || 200,
            v.response_headers || '{"Content-Type":"application/json"}',
            v.response_body || '{}',
          );
        }
      }
      imported++;
    }
  });

  doImport();
  res.json({ imported });
});

// POST /api/mocks/from-shared - create mock from a shared request (no ownership check)
router.post('/from-shared', requireAuth, (req: AuthRequest, res: Response): void => {
  const { shareToken, name, versionName, folderId: folderIdValue } = req.body;

  if (!shareToken || !name) {
    res.status(400).json({ error: 'shareToken and name are required' });
    return;
  }

  const db = getDb();
  const log = getSharedRequest(shareToken);
  const folderId = parseFolderId(folderIdValue);

  if (folderIdValue !== undefined && folderIdValue !== null && folderIdValue !== '' && folderId === null) {
    res.status(400).json({ error: 'folderId must be a positive integer or null' });
    return;
  }
  if (!folderBelongsToUser(folderId, req.userId!)) {
    res.status(400).json({ error: 'Folder not found' });
    return;
  }

  if (!log) {
    res.status(404).json({ error: 'Shared request not found' });
    return;
  }

  let urlPattern: string;
  try {
    urlPattern = new URL(log['url'] as string).pathname;
  } catch {
    urlPattern = (log['url'] as string).split('?')[0];
  }

  const ruleResult = db.prepare(`
    INSERT INTO mock_rules (user_id, folder_id, name, url_pattern, match_type, method, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'wildcard', ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(req.userId!, folderId, name, urlPattern, log['method'] as string);

  const ruleId = ruleResult.lastInsertRowid;

  const versionResult = db.prepare(`
    INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    ruleId, req.userId!, versionName || '200 OK',
    (log['response_status'] as number) || 200,
    log['response_headers'] as string || '{"Content-Type":"application/json"}',
    log['response_body'] as string || '{}',
  );

  db.prepare('UPDATE mock_rules SET active_version_id = ? WHERE id = ?')
    .run(versionResult.lastInsertRowid, ruleId);

  const rule = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(ruleId);
  res.status(201).json(rule);
});

// POST /api/mocks/from-request - create mock from a request log
router.post('/from-request', requireAuth, (req: AuthRequest, res: Response): void => {
  const { requestId, name, versionName, folderId: folderIdValue } = req.body;

  if (!requestId || !name) {
    res.status(400).json({ error: 'requestId and name are required' });
    return;
  }

  const db = getDb();
  const folderId = parseFolderId(folderIdValue);
  if (folderIdValue !== undefined && folderIdValue !== null && folderIdValue !== '' && folderId === null) {
    res.status(400).json({ error: 'folderId must be a positive integer or null' });
    return;
  }
  if (!folderBelongsToUser(folderId, req.userId!)) {
    res.status(400).json({ error: 'Folder not found' });
    return;
  }
  const log = db.prepare(
    'SELECT * FROM request_logs WHERE id = ? AND user_id = ?'
  ).get(Number(requestId), req.userId!) as Record<string, unknown> | undefined;

  if (!log) {
    res.status(404).json({ error: 'Request log not found' });
    return;
  }

  // Use the URL pathname as the default pattern with wildcard matching
  // e.g. "http://example.com/api/users/123?foo=bar" → "/api/users/123"
  let urlPattern: string;
  try {
    const parsedUrl = new URL(log['url'] as string);
    urlPattern = parsedUrl.pathname;
  } catch {
    urlPattern = (log['url'] as string).split('?')[0];
  }

  const ruleResult = db.prepare(`
    INSERT INTO mock_rules (user_id, folder_id, name, url_pattern, match_type, method, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'wildcard', ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(req.userId!, folderId, name, urlPattern, log['method'] as string);

  const ruleId = ruleResult.lastInsertRowid;

  const versionResult = db.prepare(`
    INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    ruleId, req.userId!, versionName || '200 OK',
    (log['response_status'] as number) || 200,
    log['response_headers'] as string || '{"Content-Type":"application/json"}',
    log['response_body'] as string || '{}',
  );

  // Set as active version
  db.prepare(
    'UPDATE mock_rules SET active_version_id = ? WHERE id = ?'
  ).run(versionResult.lastInsertRowid, ruleId);

  const rule = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(ruleId);
  res.status(201).json(rule);
});

export default router;
