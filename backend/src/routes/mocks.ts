import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { getSharedRequest } from '../sharedRequests';
import { matchUrlPattern } from '../proxy';
import {
  MATCH_TYPES, normalizeUrlPattern, parseHeaders, stripHopHeaders, findRulesByPattern, RuleLookup,
} from '../mockUtils';

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

function parseIsPublic(value: unknown, defaultVal = 1): number {
  if (value === undefined || value === null) return defaultVal;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 0 || value === '0' || value === 'false') return 0;
  return 1;
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

function findOrCreateUserFolder(userId: number, folderNameValue: unknown): number | null {
  const folderName = normalizeFolderName(folderNameValue);
  if (!folderName) return null;
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
  ).get(userId, folderName) as { id: number } | undefined;
  if (existing) return existing.id;
  return Number(db.prepare(`
    INSERT INTO mock_folders (user_id, name, is_public, created_at, updated_at)
    VALUES (?, ?, 1, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(userId, folderName).lastInsertRowid);
}

function enrichRulesWithVersions(
  rules: Record<string, unknown>[],
  options: { includeFullVersions?: boolean } = {},
): Record<string, unknown>[] {
  if (rules.length === 0) return [];
  const db = getDb();
  const ruleIds = rules.map((r) => Number(r['id']));
  const placeholders = ruleIds.map(() => '?').join(',');
  const cols = options.includeFullVersions
    ? '*'
    : 'id, rule_id, name, response_status, response_headers, response_body, created_at, updated_at';

  const allVersions = db.prepare(
    `SELECT ${cols} FROM mock_versions WHERE rule_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
  ).all(...ruleIds) as Record<string, unknown>[];

  const versionsByRuleId = new Map<number, Record<string, unknown>[]>();
  for (const v of allVersions) {
    const rid = Number(v['rule_id']);
    const list = versionsByRuleId.get(rid);
    if (list) list.push(v);
    else versionsByRuleId.set(rid, [v]);
  }

  return rules.map((rule) => {
    const rid = Number(rule['id']);
    const fullVersions = versionsByRuleId.get(rid) || [];
    const activeVersionId = rule['active_version_id'] != null ? Number(rule['active_version_id']) : null;
    const activeVersion = activeVersionId != null
      ? (fullVersions.find((v) => Number(v['id']) === activeVersionId) ?? null)
      : null;

    const versions = options.includeFullVersions
      ? fullVersions
      : fullVersions.map((v) => ({
          id: v['id'],
          name: v['name'],
          response_status: v['response_status'],
        }));

    return {
      ...rule,
      version_count: fullVersions.length,
      versions,
      active_version: activeVersion,
    };
  });
}

function getForkedSourceRuleIds(userId: number): Set<number> {
  const rows = getDb().prepare(
    'SELECT DISTINCT forked_from_rule_id FROM mock_rules WHERE user_id = ? AND forked_from_rule_id IS NOT NULL'
  ).all(userId) as Array<{ forked_from_rule_id: number }>;
  return new Set(rows.map((r) => Number(r.forked_from_rule_id)));
}

function sanitizeExportFilenamePart(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return cleaned || 'folder';
}

// ── Folders ───────────────────────────────────────────────────────────────

router.get('/folders', requireAuth, (req: AuthRequest, res: Response): void => {
  const folders = getDb().prepare(`
    SELECT
      mf.*,
      COUNT(mr.id) AS mock_count,
      COALESCE(SUM(CASE WHEN mr.is_public = 1 THEN 1 ELSE 0 END), 0) AS public_mock_count
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
  const isPublic = parseIsPublic(req.body.is_public, 1);

  const db = getDb();
  const duplicate = db.prepare(
    'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
  ).get(req.userId!, name);
  if (duplicate) {
    res.status(409).json({ error: 'A folder with this name already exists' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO mock_folders (user_id, name, is_public, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(req.userId!, name, isPublic);
  res.status(201).json(
    db.prepare('SELECT *, 0 AS mock_count, 0 AS public_mock_count FROM mock_folders WHERE id = ?')
      .get(result.lastInsertRowid)
  );
});

router.put('/folders/:folderId', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const folderId = Number(req.params['folderId']);
  const existing = db.prepare(
    'SELECT * FROM mock_folders WHERE id = ? AND user_id = ?'
  ).get(folderId, req.userId!) as { id: number; name: string; is_public: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }

  const hasName = req.body.name !== undefined;
  const hasVisibility = req.body.is_public !== undefined;
  const name = hasName ? normalizeFolderName(req.body.name) : existing.name;
  if (!name) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }

  if (hasName) {
    const duplicate = db.prepare(
      'SELECT id FROM mock_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?'
    ).get(req.userId!, name, folderId);
    if (duplicate) {
      res.status(409).json({ error: 'A folder with this name already exists' });
      return;
    }
  }

  const nextIsPublic = hasVisibility ? parseIsPublic(req.body.is_public, existing.is_public) : existing.is_public;
  db.prepare(`
    UPDATE mock_folders SET name = ?, is_public = ?, updated_at = datetime('now', '+8 hours')
    WHERE id = ? AND user_id = ?
  `).run(name, nextIsPublic, folderId, req.userId!);

  const updated = db.prepare(`
    SELECT
      mf.*,
      COUNT(mr.id) AS mock_count,
      COALESCE(SUM(CASE WHEN mr.is_public = 1 THEN 1 ELSE 0 END), 0) AS public_mock_count
    FROM mock_folders mf
    LEFT JOIN mock_rules mr ON mr.folder_id = mf.id
    WHERE mf.id = ?
    GROUP BY mf.id
  `).get(folderId);
  res.json(updated);
});

router.patch('/folders/:folderId/visibility', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const folderId = Number(req.params['folderId']);
  const isPublic = parseIsPublic(req.body?.is_public, 1);

  const result = db.prepare(`
    UPDATE mock_folders SET is_public = ?, updated_at = datetime('now', '+8 hours')
    WHERE id = ? AND user_id = ?
  `).run(isPublic, folderId, req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Folder not found' });
    return;
  }

  const updated = db.prepare(`
    SELECT
      mf.*,
      COUNT(mr.id) AS mock_count,
      COALESCE(SUM(CASE WHEN mr.is_public = 1 THEN 1 ELSE 0 END), 0) AS public_mock_count
    FROM mock_folders mf
    LEFT JOIN mock_rules mr ON mr.folder_id = mf.id
    WHERE mf.id = ?
    GROUP BY mf.id
  `).get(folderId);
  res.json(updated);
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

// ── Team Shared Mocks & Request-Matched Discovery ─────────────────────────

// GET /api/mocks/match - strictly returns own + others' public mocks that match a given request URL/method
router.get('/match', requireAuth, (req: AuthRequest, res: Response): void => {
  const { url, method, search, scope = 'all' } = req.query as {
    url?: string;
    method?: string;
    search?: string;
    scope?: string;
  };

  if (!url) {
    res.status(400).json({ error: 'url query parameter is required' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;
  const normalizedMethod = method ? method.toUpperCase() : '';
  const searchTerm = (search || '').trim().toLowerCase();

  const candidateRows = db.prepare(`
    SELECT
      mr.*,
      mf.name AS folder_name,
      mf.is_public AS folder_is_public,
      u.email AS owner_email
    FROM mock_rules mr
    JOIN users u ON u.id = mr.user_id
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.user_id = ?
       OR (mr.is_public = 1 AND (mf.id IS NULL OR mf.is_public = 1))
    ORDER BY mr.updated_at DESC, mr.id DESC
  `).all(userId) as Record<string, unknown>[];

  // Strictly keep only rules matching this request's method and URL pattern.
  const matchedRows = candidateRows.filter((row) => {
    const ruleMethod = row['method'] ? String(row['method']).toUpperCase() : null;
    if (ruleMethod && normalizedMethod && ruleMethod !== normalizedMethod) return false;
    return matchUrlPattern(String(row['url_pattern']), url, String(row['match_type'] || 'exact'));
  });

  const enriched = enrichRulesWithVersions(matchedRows, { includeFullVersions: true });
  const forkedIds = getForkedSourceRuleIds(userId);

  const annotated: Array<Record<string, unknown> & { is_mine: boolean; already_forked: boolean }> = enriched
    .map((rule): Record<string, unknown> & { is_mine: boolean; already_forked: boolean } => {
      const isMine = Number(rule['user_id']) === userId;
      return {
        ...rule,
        is_mine: isMine,
        already_forked: !isMine && forkedIds.has(Number(rule['id'])),
      };
    })
    .filter((rule) => {
      if (!searchTerm) return true;
      const versionNames = ((rule['versions'] as Array<Record<string, unknown>>) || [])
        .map((v) => String(v['name'] || ''))
        .join(' ');
      const haystack = [
        rule['name'],
        rule['url_pattern'],
        rule['folder_name'],
        rule['owner_email'],
        versionNames,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });

  annotated.sort((a, b) => {
    if (a.is_mine !== b.is_mine) return a.is_mine ? -1 : 1;
    if (a.is_mine && Number(b['is_active']) !== Number(a['is_active'])) {
      return Number(b['is_active']) - Number(a['is_active']);
    }
    return String(b['updated_at'] || '').localeCompare(String(a['updated_at'] || ''))
      || Number(b['id']) - Number(a['id']);
  });

  const mineCount = annotated.filter((r) => r.is_mine).length;
  const othersCount = annotated.length - mineCount;
  const scopedRules = scope === 'mine'
    ? annotated.filter((r) => r.is_mine)
    : scope === 'others'
      ? annotated.filter((r) => !r.is_mine)
      : annotated;

  res.json({
    rules: scopedRules,
    counts: {
      all: annotated.length,
      mine: mineCount,
      others: othersCount,
    },
  });
});

// GET /api/mocks/team - browse all team-shared (public) mocks and folder hierarchy
router.get('/team', requireAuth, (req: AuthRequest, res: Response): void => {
  const { search, ownerId, folderId } = req.query as {
    search?: string;
    ownerId?: string;
    folderId?: string;
  };

  const db = getDb();
  const userId = req.userId!;
  const searchTerm = (search || '').trim().toLowerCase();
  const parsedOwnerId = ownerId && Number.isInteger(Number(ownerId)) && Number(ownerId) > 0
    ? Number(ownerId)
    : null;
  const isUnfiledFilter = folderId === 'unfiled';
  const parsedFolderId = !isUnfiledFilter && folderId && folderId !== 'all'
    && Number.isInteger(Number(folderId)) && Number(folderId) > 0
    ? Number(folderId)
    : null;

  const allPublicRows = db.prepare(`
    SELECT
      mr.*,
      mf.name AS folder_name,
      mf.is_public AS folder_is_public,
      u.email AS owner_email
    FROM mock_rules mr
    JOIN users u ON u.id = mr.user_id
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.is_public = 1 AND (mf.id IS NULL OR mf.is_public = 1)
    ORDER BY mr.updated_at DESC, mr.id DESC
  `).all() as Record<string, unknown>[];

  // Build team owner & public folder tree
  const ownersMap = new Map<number, {
    user_id: number;
    email: string;
    is_me: boolean;
    public_rule_count: number;
    unfiled_count: number;
    folders: Map<number, { id: number; name: string; mock_count: number }>;
  }>();

  const ensureOwner = (uid: number, email: string) => {
    let entry = ownersMap.get(uid);
    if (!entry) {
      entry = {
        user_id: uid,
        email,
        is_me: uid === userId,
        public_rule_count: 0,
        unfiled_count: 0,
        folders: new Map(),
      };
      ownersMap.set(uid, entry);
    }
    return entry;
  };

  for (const row of allPublicRows) {
    const uid = Number(row['user_id']);
    const email = String(row['owner_email']);
    const owner = ensureOwner(uid, email);
    owner.public_rule_count++;
    const fid = row['folder_id'] != null ? Number(row['folder_id']) : null;
    if (fid === null) {
      owner.unfiled_count++;
    } else {
      const f = owner.folders.get(fid);
      if (f) f.mock_count++;
      else owner.folders.set(fid, { id: fid, name: String(row['folder_name'] || 'Folder'), mock_count: 1 });
    }
  }

  // If a shared folder link targets a valid public folder that happens to be empty, include it cleanly.
  let selectedFolderMeta: { id: number; name: string; owner_id: number; owner_email: string } | null = null;
  if (parsedFolderId !== null) {
    const folderRow = db.prepare(`
      SELECT mf.id, mf.name, mf.user_id, mf.is_public, u.email AS owner_email
      FROM mock_folders mf
      JOIN users u ON u.id = mf.user_id
      WHERE mf.id = ? AND (mf.is_public = 1 OR mf.user_id = ?)
    `).get(parsedFolderId, userId) as {
      id: number;
      name: string;
      user_id: number;
      is_public: number;
      owner_email: string;
    } | undefined;

    if (folderRow) {
      selectedFolderMeta = {
        id: folderRow.id,
        name: folderRow.name,
        owner_id: folderRow.user_id,
        owner_email: folderRow.owner_email,
      };
      if (folderRow.is_public === 1) {
        const owner = ensureOwner(folderRow.user_id, folderRow.owner_email);
        if (!owner.folders.has(folderRow.id)) {
          owner.folders.set(folderRow.id, { id: folderRow.id, name: folderRow.name, mock_count: 0 });
        }
      }
    }
  }

  const owners = Array.from(ownersMap.values())
    .map((o) => ({
      user_id: o.user_id,
      email: o.email,
      is_me: o.is_me,
      public_rule_count: o.public_rule_count,
      unfiled_count: o.unfiled_count,
      folders: Array.from(o.folders.values()).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      if (a.is_me !== b.is_me) return a.is_me ? 1 : -1; // colleagues first, self at bottom
      return b.public_rule_count - a.public_rule_count || a.email.localeCompare(b.email);
    });

  // Filter rules according to selection
  let filteredRows = allPublicRows;
  if (parsedOwnerId !== null) {
    filteredRows = filteredRows.filter((r) => Number(r['user_id']) === parsedOwnerId);
  }
  if (isUnfiledFilter) {
    filteredRows = filteredRows.filter((r) => r['folder_id'] === null);
  } else if (parsedFolderId !== null) {
    filteredRows = filteredRows.filter((r) => Number(r['folder_id']) === parsedFolderId);
  }

  const enriched = enrichRulesWithVersions(filteredRows, { includeFullVersions: true });
  const forkedIds = getForkedSourceRuleIds(userId);

  const rules = enriched
    .map((rule): Record<string, unknown> & { is_mine: boolean; already_forked: boolean } => {
      const isMine = Number(rule['user_id']) === userId;
      return {
        ...rule,
        is_mine: isMine,
        already_forked: !isMine && forkedIds.has(Number(rule['id'])),
      };
    })
    .filter((rule) => {
      if (!searchTerm) return true;
      const versionNames = ((rule['versions'] as Array<Record<string, unknown>>) || [])
        .map((v) => String(v['name'] || ''))
        .join(' ');
      const haystack = [
        rule['name'],
        rule['url_pattern'],
        rule['folder_name'],
        rule['owner_email'],
        versionNames,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(searchTerm);
    });

  res.json({
    owners,
    rules,
    total_public_rules: allPublicRows.length,
    selected_folder: selectedFolderMeta,
  });
});

// POST /api/mocks/fork - clone a public (or own) mock rule + all versions into current user's account
router.post('/fork', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    sourceRuleId,
    versionId,
    folderId: folderIdValue,
    preserveFolderName = false,
    activate = true,
    disableConflicting = false,
    targetUrl,
    targetMethod,
    name: customName,
  } = req.body as {
    sourceRuleId?: number;
    versionId?: number;
    folderId?: number | null;
    preserveFolderName?: boolean;
    activate?: boolean;
    disableConflicting?: boolean;
    targetUrl?: string;
    targetMethod?: string;
    name?: string;
  };

  const parsedSourceRuleId = Number(sourceRuleId);
  if (!Number.isInteger(parsedSourceRuleId) || parsedSourceRuleId <= 0) {
    res.status(400).json({ error: 'sourceRuleId is required' });
    return;
  }

  const db = getDb();
  const userId = req.userId!;

  const sourceRule = db.prepare(`
    SELECT
      mr.*,
      mf.name AS folder_name,
      mf.is_public AS folder_is_public,
      u.email AS owner_email
    FROM mock_rules mr
    JOIN users u ON u.id = mr.user_id
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.id = ?
  `).get(parsedSourceRuleId) as Record<string, unknown> | undefined;

  if (!sourceRule) {
    res.status(404).json({ error: 'Source mock rule not found' });
    return;
  }

  const isSourceOwner = Number(sourceRule['user_id']) === userId;
  const isSourcePublic = Number(sourceRule['is_public']) === 1
    && (sourceRule['folder_id'] === null || Number(sourceRule['folder_is_public']) === 1);

  if (!isSourceOwner && !isSourcePublic) {
    res.status(403).json({ error: 'This mock rule is private and cannot be forked' });
    return;
  }

  let resolvedFolderId: number | null = null;
  if (folderIdValue !== undefined) {
    resolvedFolderId = parseFolderId(folderIdValue);
    if (folderIdValue !== null && String(folderIdValue) !== '' && resolvedFolderId === null) {
      res.status(400).json({ error: 'folderId must be a positive integer or null' });
      return;
    }
    if (!folderBelongsToUser(resolvedFolderId, userId)) {
      res.status(400).json({ error: 'Target folder not found' });
      return;
    }
  } else if (preserveFolderName && sourceRule['folder_name']) {
    resolvedFolderId = findOrCreateUserFolder(userId, sourceRule['folder_name']);
  }

  const sourceVersions = db.prepare(
    'SELECT * FROM mock_versions WHERE rule_id = ? ORDER BY created_at ASC, id ASC'
  ).all(parsedSourceRuleId) as Record<string, unknown>[];

  const desiredSourceVersionId = versionId != null
    ? Number(versionId)
    : (sourceRule['active_version_id'] != null ? Number(sourceRule['active_version_id']) : null);

  const clonedRuleId = db.transaction(() => {
    if (activate && disableConflicting && targetUrl) {
      const normalizedMethod = targetMethod ? targetMethod.toUpperCase() : '';
      const activeOwnRules = db.prepare(
        'SELECT id, url_pattern, match_type, method FROM mock_rules WHERE user_id = ? AND is_active = 1'
      ).all(userId) as Array<{ id: number; url_pattern: string; match_type: string; method: string | null }>;

      const deactivateStmt = db.prepare(
        "UPDATE mock_rules SET is_active = 0, updated_at = datetime('now', '+8 hours') WHERE id = ? AND user_id = ?"
      );
      for (const own of activeOwnRules) {
        if (own.method && normalizedMethod && own.method.toUpperCase() !== normalizedMethod) continue;
        if (matchUrlPattern(own.url_pattern, targetUrl, own.match_type)) {
          deactivateStmt.run(own.id, userId);
        }
      }
    }

    const ruleName = (typeof customName === 'string' && customName.trim())
      ? customName.trim()
      : String(sourceRule['name'] || 'Forked Rule');

    const willActivate = activate && sourceVersions.length > 0 ? 1 : 0;

    const ruleInsert = db.prepare(`
      INSERT INTO mock_rules
        (user_id, folder_id, name, url_pattern, match_type, method, is_active, is_public,
         delay_ms, condition_field_type, condition_field_key, condition_field_value,
         forked_from_rule_id, forked_from_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `).run(
      userId,
      resolvedFolderId,
      ruleName,
      sourceRule['url_pattern'],
      sourceRule['match_type'] || 'exact',
      sourceRule['method'] ?? null,
      willActivate,
      sourceRule['delay_ms'] ?? 0,
      sourceRule['condition_field_type'] ?? null,
      sourceRule['condition_field_key'] ?? null,
      sourceRule['condition_field_value'] ?? null,
      isSourceOwner ? (sourceRule['forked_from_rule_id'] ?? null) : parsedSourceRuleId,
      isSourceOwner ? (sourceRule['forked_from_email'] ?? null) : String(sourceRule['owner_email']),
    );

    const newRuleId = Number(ruleInsert.lastInsertRowid);
    const insertVersion = db.prepare(`
      INSERT INTO mock_versions
        (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `);

    let newActiveVersionId: number | null = null;
    for (const v of sourceVersions) {
      const inserted = insertVersion.run(
        newRuleId,
        userId,
        v['name'] || '200 OK',
        v['response_status'] ?? 200,
        v['response_headers'] || '{"Content-Type":"application/json"}',
        v['response_body'] ?? '{}',
      );
      const newVid = Number(inserted.lastInsertRowid);
      if (newActiveVersionId === null || (desiredSourceVersionId !== null && Number(v['id']) === desiredSourceVersionId)) {
        newActiveVersionId = newVid;
      }
    }

    if (newActiveVersionId !== null) {
      db.prepare('UPDATE mock_rules SET active_version_id = ? WHERE id = ?')
        .run(newActiveVersionId, newRuleId);
    }

    return newRuleId;
  })();

  const createdRow = db.prepare(`
    SELECT mr.*, mf.name AS folder_name, mf.is_public AS folder_is_public, u.email AS owner_email
    FROM mock_rules mr
    JOIN users u ON u.id = mr.user_id
    LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
    WHERE mr.id = ?
  `).get(clonedRuleId) as Record<string, unknown>;

  const [enriched] = enrichRulesWithVersions([createdRow], { includeFullVersions: true });
  res.status(201).json({ ...enriched, is_mine: true });
});

// POST /api/mocks/fork-folder - clone an entire shared folder (or a user's unfiled public mocks)
router.post('/fork-folder', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    sourceFolderId,
    sourceOwnerId,
    targetFolderName,
    activate = false,
  } = req.body as {
    sourceFolderId?: number | 'unfiled';
    sourceOwnerId?: number;
    targetFolderName?: string;
    activate?: boolean;
  };

  const db = getDb();
  const userId = req.userId!;

  let sourceRules: Record<string, unknown>[] = [];
  let defaultFolderName = '';

  if (sourceFolderId === 'unfiled') {
    const ownerIdNum = Number(sourceOwnerId);
    if (!Number.isInteger(ownerIdNum) || ownerIdNum <= 0) {
      res.status(400).json({ error: 'sourceOwnerId is required when cloning unfiled mocks' });
      return;
    }
    const owner = db.prepare('SELECT id, email FROM users WHERE id = ?').get(ownerIdNum) as
      | { id: number; email: string }
      | undefined;
    if (!owner) {
      res.status(404).json({ error: 'Owner not found' });
      return;
    }
    sourceRules = db.prepare(`
      SELECT mr.*, u.email AS owner_email
      FROM mock_rules mr
      JOIN users u ON u.id = mr.user_id
      WHERE mr.user_id = ? AND mr.folder_id IS NULL AND mr.is_public = 1
      ORDER BY mr.created_at ASC, mr.id ASC
    `).all(ownerIdNum) as Record<string, unknown>[];
    defaultFolderName = `${owner.email.split('@')[0]} - Unfiled`;
  } else {
    const folderIdNum = Number(sourceFolderId);
    if (!Number.isInteger(folderIdNum) || folderIdNum <= 0) {
      res.status(400).json({ error: 'sourceFolderId is required' });
      return;
    }
    const sourceFolder = db.prepare(`
      SELECT mf.*, u.email AS owner_email
      FROM mock_folders mf
      JOIN users u ON u.id = mf.user_id
      WHERE mf.id = ?
    `).get(folderIdNum) as { id: number; user_id: number; name: string; is_public: number; owner_email: string } | undefined;

    if (!sourceFolder) {
      res.status(404).json({ error: 'Source folder not found' });
      return;
    }
    if (sourceFolder.user_id !== userId && sourceFolder.is_public !== 1) {
      res.status(403).json({ error: 'This folder is private and cannot be cloned' });
      return;
    }
    sourceRules = db.prepare(`
      SELECT mr.*, u.email AS owner_email
      FROM mock_rules mr
      JOIN users u ON u.id = mr.user_id
      WHERE mr.folder_id = ? AND (mr.is_public = 1 OR mr.user_id = ?)
      ORDER BY mr.created_at ASC, mr.id ASC
    `).all(folderIdNum, userId) as Record<string, unknown>[];
    defaultFolderName = sourceFolder.name;
  }

  if (sourceRules.length === 0) {
    res.status(400).json({ error: 'No public mock rules in this folder to clone' });
    return;
  }

  const finalFolderName = normalizeFolderName(targetFolderName) || normalizeFolderName(defaultFolderName) || 'Shared Mocks';
  const enrichedSources = enrichRulesWithVersions(sourceRules, { includeFullVersions: true });

  const result = db.transaction(() => {
    const targetFolderId = findOrCreateUserFolder(userId, finalFolderName);
    const insertRule = db.prepare(`
      INSERT INTO mock_rules
        (user_id, folder_id, name, url_pattern, match_type, method, is_active, is_public,
         delay_ms, condition_field_type, condition_field_key, condition_field_value,
         forked_from_rule_id, forked_from_email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `);
    const insertVersion = db.prepare(`
      INSERT INTO mock_versions
        (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
    `);
    const updateActiveVersion = db.prepare('UPDATE mock_rules SET active_version_id = ? WHERE id = ?');

    let clonedRules = 0;
    for (const src of enrichedSources) {
      const versions = (src['versions'] as Record<string, unknown>[]) || [];
      const isSelf = Number(src['user_id']) === userId;
      const willActivate = activate && versions.length > 0 ? 1 : 0;

      const r = insertRule.run(
        userId,
        targetFolderId,
        src['name'] || 'Cloned Rule',
        src['url_pattern'] || '/',
        src['match_type'] || 'exact',
        src['method'] ?? null,
        willActivate,
        src['delay_ms'] ?? 0,
        src['condition_field_type'] ?? null,
        src['condition_field_key'] ?? null,
        src['condition_field_value'] ?? null,
        isSelf ? (src['forked_from_rule_id'] ?? null) : Number(src['id']),
        isSelf ? (src['forked_from_email'] ?? null) : String(src['owner_email']),
      );
      const newRuleId = Number(r.lastInsertRowid);
      const desiredSourceVid = src['active_version_id'] != null ? Number(src['active_version_id']) : null;
      let newActiveVid: number | null = null;

      for (const v of versions) {
        const vr = insertVersion.run(
          newRuleId,
          userId,
          v['name'] || '200 OK',
          v['response_status'] ?? 200,
          v['response_headers'] || '{"Content-Type":"application/json"}',
          v['response_body'] ?? '{}',
        );
        const newVid = Number(vr.lastInsertRowid);
        if (newActiveVid === null || (desiredSourceVid !== null && Number(v['id']) === desiredSourceVid)) {
          newActiveVid = newVid;
        }
      }

      if (newActiveVid !== null) {
        updateActiveVersion.run(newActiveVid, newRuleId);
      }
      clonedRules++;
    }

    const folder = db.prepare(`
      SELECT
        mf.*,
        COUNT(mr.id) AS mock_count,
        COALESCE(SUM(CASE WHEN mr.is_public = 1 THEN 1 ELSE 0 END), 0) AS public_mock_count
      FROM mock_folders mf
      LEFT JOIN mock_rules mr ON mr.folder_id = mf.id
      WHERE mf.id = ?
      GROUP BY mf.id
    `).get(targetFolderId);

    return { folder, cloned_rules: clonedRules };
  })();

  res.status(201).json(result);
});

// GET /api/mocks - list rules with search
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { search } = req.query as { search?: string };

  let query = `
    SELECT mr.*, mf.name AS folder_name, mf.is_public AS folder_is_public
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
  res.json(enrichRulesWithVersions(rules));
});

// POST /api/mocks - create rule
router.post('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    name, url_pattern, match_type = 'exact', method,
    folder_id, delay_ms = 0, is_public = 1,
    condition_field_type, condition_field_key, condition_field_value,
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

  const normalizedIsPublic = parseIsPublic(is_public, 1);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO mock_rules
      (user_id, folder_id, name, url_pattern, match_type, method, is_public, delay_ms,
       condition_field_type, condition_field_key, condition_field_value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    req.userId!, normalizedFolderId, name, url_pattern, match_type, method || null, normalizedIsPublic, normalizedDelayMs,
    condition_field_type || null, condition_field_key || null, condition_field_value || null,
  );

  const rule = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(rule);
});

// PATCH /api/mocks/:id/visibility - quick toggle rule public/private visibility
router.patch('/:id/visibility', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const ruleId = Number(req.params['id']);
  const isPublic = parseIsPublic(req.body?.is_public, 1);

  const result = db.prepare(`
    UPDATE mock_rules SET is_public = ?, updated_at = datetime('now', '+8 hours')
    WHERE id = ? AND user_id = ?
  `).run(isPublic, ruleId, req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Mock rule not found' });
    return;
  }

  const updated = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(ruleId);
  res.json(updated);
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
    name, url_pattern, match_type, method, folder_id, is_active, is_public,
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
      is_public = COALESCE(?, is_public),
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
    is_public !== undefined ? parseIsPublic(is_public, 1) : null,
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

// GET /api/mocks/data/export - export all mocks or a specific folder/unfiled scope
router.get('/data/export', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const userId = req.userId!;
  const rawFolderId = typeof req.query['folderId'] === 'string' ? req.query['folderId'].trim() : '';

  let scope: 'all' | 'unfiled' | 'folder' = 'all';
  let folderName: string | null = null;
  let folders: Record<string, unknown>[] = [];
  let rules: Record<string, unknown>[] = [];
  let filename = 'proxyflow-mocks.json';

  if (rawFolderId === 'unfiled') {
    scope = 'unfiled';
    folders = [];
    rules = db.prepare(`
      SELECT mr.*, NULL AS folder_name
      FROM mock_rules mr
      WHERE mr.user_id = ? AND mr.folder_id IS NULL
      ORDER BY mr.created_at DESC, mr.id DESC
    `).all(userId) as Record<string, unknown>[];
    filename = 'proxyflow-mocks-unfiled.json';
  } else if (rawFolderId && rawFolderId !== 'all') {
    const folderId = parseFolderId(rawFolderId);
    if (folderId === null) {
      res.status(400).json({ error: 'Invalid folderId' });
      return;
    }
    const folder = db.prepare(
      'SELECT id, name, is_public FROM mock_folders WHERE id = ? AND user_id = ?'
    ).get(folderId, userId) as { id: number; name: string; is_public: number } | undefined;
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    scope = 'folder';
    folderName = folder.name;
    folders = [folder];
    rules = db.prepare(`
      SELECT mr.*, mf.name AS folder_name
      FROM mock_rules mr
      LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
      WHERE mr.user_id = ? AND mr.folder_id = ?
      ORDER BY mr.created_at DESC, mr.id DESC
    `).all(userId, folderId) as Record<string, unknown>[];
    filename = `proxyflow-mocks-${sanitizeExportFilenamePart(folder.name)}.json`;
  } else {
    folders = db.prepare(
      'SELECT id, name, is_public FROM mock_folders WHERE user_id = ? ORDER BY name COLLATE NOCASE'
    ).all(userId) as Record<string, unknown>[];
    rules = db.prepare(`
      SELECT mr.*, mf.name AS folder_name
      FROM mock_rules mr
      LEFT JOIN mock_folders mf ON mf.id = mr.folder_id
      WHERE mr.user_id = ?
      ORDER BY mr.created_at DESC, mr.id DESC
    `).all(userId) as Record<string, unknown>[];
  }

  // Batch load versions (avoids N+1 queries on large exports)
  const versionsByRuleId = new Map<number, Record<string, unknown>[]>();
  if (rules.length > 0) {
    const ruleIds = rules.map((r) => Number(r['id']));
    const placeholders = ruleIds.map(() => '?').join(',');
    const allVersions = db.prepare(
      `SELECT * FROM mock_versions WHERE rule_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
    ).all(...ruleIds) as Record<string, unknown>[];
    for (const v of allVersions) {
      const rid = Number(v['rule_id']);
      const list = versionsByRuleId.get(rid);
      if (list) list.push(v);
      else versionsByRuleId.set(rid, [v]);
    }
  }

  const data = rules.map((rule) => ({
    ...rule,
    versions: versionsByRuleId.get(Number(rule['id'])) || [],
  }));

  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '').replace(/-+/g, '-').replace(/^[-.]+|[-]+(?=\.json$)/g, '') || 'proxyflow-mocks.json';
  const safeAsciiName = asciiFallback.endsWith('.json') && asciiFallback.length > 5 ? asciiFallback : 'proxyflow-mocks.json';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.json({
    version: '1.1',
    scope,
    folder_name: folderName,
    filename,
    exported_at: new Date().toISOString(),
    folders,
    mocks: data,
  });
});

// POST /api/mocks/data/import - import mocks
router.post('/data/import', requireAuth, (req: AuthRequest, res: Response): void => {
  const { mocks, targetFolderId } = req.body;

  if (!Array.isArray(mocks)) {
    res.status(400).json({ error: 'Invalid format: expected { mocks: [...] }' });
    return;
  }

  const fallbackFolderId = parseFolderId(targetFolderId);
  if (targetFolderId !== undefined && targetFolderId !== null && targetFolderId !== '' && fallbackFolderId === null) {
    res.status(400).json({ error: 'targetFolderId must be a positive integer or null' });
    return;
  }
  if (!folderBelongsToUser(fallbackFolderId, req.userId!)) {
    res.status(400).json({ error: 'Target folder not found' });
    return;
  }

  const db = getDb();
  let imported = 0;

  const insertRule = db.prepare(`
    INSERT INTO mock_rules
      (user_id, folder_id, name, url_pattern, match_type, method, is_public, delay_ms,
       condition_field_type, condition_field_key, condition_field_value, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `);

  const insertVersion = db.prepare(`
    INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `);

  const updateActiveVersion = db.prepare('UPDATE mock_rules SET active_version_id = ? WHERE id = ?');

  const doImport = db.transaction(() => {
    for (const mock of mocks) {
      const folderId = mock.folder_name
        ? findOrCreateUserFolder(req.userId!, mock.folder_name)
        : fallbackFolderId;
      const ruleResult = insertRule.run(
        req.userId!, folderId, mock.name || 'Imported Rule', mock.url_pattern || '/',
        mock.match_type || 'exact', mock.method || null, parseIsPublic(mock.is_public, 1), mock.delay_ms || 0,
        mock.condition_field_type || null, mock.condition_field_key || null, mock.condition_field_value || null,
      );
      const ruleId = Number(ruleResult.lastInsertRowid);

      let firstVersionId: number | null = null;
      let matchedActiveVersionId: number | null = null;
      if (Array.isArray(mock.versions)) {
        for (const v of mock.versions) {
          const vRes = insertVersion.run(
            ruleId, req.userId!, v.name || 'Imported Version',
            v.response_status || 200,
            typeof v.response_headers === 'object' && v.response_headers !== null
              ? JSON.stringify(v.response_headers)
              : (v.response_headers || '{"Content-Type":"application/json"}'),
            typeof v.response_body === 'string'
              ? v.response_body
              : JSON.stringify(v.response_body ?? {}),
          );
          const newVid = Number(vRes.lastInsertRowid);
          if (firstVersionId === null) firstVersionId = newVid;
          if (mock.active_version_id != null && v.id != null && Number(v.id) === Number(mock.active_version_id)) {
            matchedActiveVersionId = newVid;
          }
        }
      }

      const activeVid = matchedActiveVersionId ?? firstVersionId;
      if (activeVid !== null) {
        updateActiveVersion.run(activeVid, ruleId);
      }
      imported++;
    }
  });

  doImport();
  res.json({ imported });
});

// POST /api/mocks/from-shared - create mock from a shared request (no ownership check)
router.post('/from-shared', requireAuth, (req: AuthRequest, res: Response): void => {
  const { shareToken, name, versionName, folderId: folderIdValue, isActive } = req.body;

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
    INSERT INTO mock_rules (user_id, folder_id, name, url_pattern, match_type, method, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'wildcard', ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(req.userId!, folderId, name, urlPattern, log['method'] as string, isActive ? 1 : 0);

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

// ── MCP helpers: pattern-addressed operations ──────────────────────────────

function bad(res: Response, error: string): void {
  res.status(400).json({ error });
}

interface ParsedCondition {
  type: string;
  key: string;
  value: string;
}

function parseConditionInput(condition: unknown): { ok: true; value: ParsedCondition | null | undefined } | { ok: false; error: string } {
  if (condition === undefined) return { ok: true, value: undefined };
  if (condition === null) return { ok: true, value: null };
  const c = condition as Record<string, unknown>;
  const valid = typeof condition === 'object'
    && ['header', 'query', 'body'].includes(String(c.type).toLowerCase())
    && typeof c.key === 'string' && c.key.length > 0
    && c.value !== undefined && c.value !== null && String(c.value) !== '';
  if (!valid) return { ok: false, error: 'condition must be {type: "header"|"query"|"body", key, value}' };
  return {
    ok: true,
    value: { type: String(c.type).toLowerCase(), key: c.key as string, value: String(c.value) },
  };
}

function formatRuleCandidate(r: {
  id: number; name: string; url_pattern: string; method: string | null; match_type: string;
  condition_field_type: string | null; condition_field_key: string | null; condition_field_value: string | null;
}) {
  return {
    rule_id: r.id,
    name: r.name,
    url_pattern: r.url_pattern,
    method: r.method ?? 'ANY',
    match_type: r.match_type,
    condition: r.condition_field_type
      ? { type: r.condition_field_type, key: r.condition_field_key, value: r.condition_field_value }
      : null,
  };
}

function ruleSummary(ruleId: number | bigint) {
  const db = getDb();
  const rule = db.prepare('SELECT * FROM mock_rules WHERE id = ?').get(ruleId) as Record<string, unknown>;
  const versions = db.prepare(
    'SELECT id, name, response_status FROM mock_versions WHERE rule_id = ? ORDER BY created_at ASC, id ASC'
  ).all(ruleId);
  const activeVersion = rule['active_version_id']
    ? db.prepare('SELECT * FROM mock_versions WHERE id = ?').get(rule['active_version_id'])
    : null;
  return { ...rule, version_count: versions.length, versions, active_version: activeVersion };
}

// POST /api/mocks/upsert - create or update a mock by URL pattern (for MCP tooling)
router.post('/upsert', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    url_pattern, method, response_status, response_body, response_headers,
    match_type, name, version_name, delay_ms, enabled, activate,
    condition, from_request_id,
  } = req.body;

  if (!url_pattern || typeof url_pattern !== 'string') return bad(res, 'url_pattern is required');

  if (match_type !== undefined && !(MATCH_TYPES as readonly string[]).includes(match_type)) {
    return bad(res, `match_type must be one of: ${MATCH_TYPES.join(', ')}`);
  }
  if (response_status !== undefined && !(Number.isInteger(response_status) && response_status >= 100 && response_status <= 599)) {
    return bad(res, 'response_status must be an integer between 100 and 599');
  }
  let delay: number | undefined;
  if (delay_ms !== undefined) {
    const d = parseDelayMs(delay_ms);
    if (d === null) return bad(res, 'delay_ms must be between 0 and 60000');
    delay = d;
  }
  if (response_headers !== undefined && (typeof response_headers !== 'object' || response_headers === null || Array.isArray(response_headers))) {
    return bad(res, 'response_headers must be an object of header name -> value');
  }
  const parsedCondition = parseConditionInput(condition);
  if (!parsedCondition.ok) return bad(res, parsedCondition.error);

  const db = getDb();
  const userId = req.userId!;

  // Optionally seed the response from a captured request (real response shape).
  let seedStatus: number | undefined;
  let seedHeaders: Record<string, string> | undefined;
  let seedBody: string | undefined;
  if (from_request_id !== undefined && from_request_id !== null) {
    const log = db.prepare('SELECT * FROM request_logs WHERE id = ? AND user_id = ?')
      .get(Number(from_request_id), userId) as Record<string, unknown> | undefined;
    if (!log) {
      res.status(404).json({ error: `Request ${from_request_id} not found` });
      return;
    }
    seedStatus = Number(log['response_status']) || 200;
    seedHeaders = stripHopHeaders(parseHeaders(log['response_headers'] as string));
    seedBody = (log['response_body'] as string | null) ?? '';
  }

  const normalizedMethod: string | null = method ? String(method).toUpperCase() : null;
  const { pattern, hadParams } = normalizeUrlPattern(url_pattern, match_type);
  const normalizedMatchType: string = hadParams ? 'wildcard' : (match_type || 'wildcard');
  const cType: string | null = parsedCondition.value ? parsedCondition.value.type : null;
  const cKey: string | null = parsedCondition.value ? parsedCondition.value.key : null;
  const cValue: string | null = parsedCondition.value ? parsedCondition.value.value : null;

  const status: number = response_status ?? seedStatus ?? 200;

  let body: string;
  if (response_body !== undefined) {
    body = typeof response_body === 'string' ? response_body : JSON.stringify(response_body);
  } else {
    body = seedBody ?? '{}';
  }

  let headers: Record<string, string>;
  if (response_headers !== undefined) {
    headers = Object.fromEntries(Object.entries(response_headers).map(([k, v]) => [k, String(v)]));
  } else if (seedHeaders) {
    headers = seedHeaders;
  } else {
    // A bare non-JSON string body must not be labelled application/json.
    let looksJson = true;
    try { JSON.parse(body); } catch { looksJson = false; }
    headers = { 'Content-Type': looksJson ? 'application/json' : 'text/plain; charset=utf-8' };
  }
  const headersJson = JSON.stringify(headers);
  const isActive = enabled === false ? 0 : 1;
  const versionName: string = version_name || name || String(status);

  const result = db.transaction(() => {
    const existing = db.prepare(`
      SELECT * FROM mock_rules
      WHERE user_id = ? AND url_pattern = ? AND method IS ?
        AND condition_field_type IS ? AND condition_field_key IS ? AND condition_field_value IS ?
      ORDER BY id ASC LIMIT 1
    `).get(userId, pattern, normalizedMethod, cType, cKey, cValue) as Record<string, unknown> | undefined;

    let ruleId: number | bigint;
    if (!existing) {
      const r = db.prepare(`
        INSERT INTO mock_rules
          (user_id, name, url_pattern, match_type, method, is_active, delay_ms,
           condition_field_type, condition_field_key, condition_field_value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
      `).run(userId, name || pattern, pattern, normalizedMatchType, normalizedMethod, isActive, delay ?? 0, cType, cKey, cValue);
      ruleId = r.lastInsertRowid;
    } else {
      ruleId = existing['id'] as number;
      // Only touch fields the caller actually sent.
      db.prepare(`
        UPDATE mock_rules
        SET is_active = ?, name = ?, match_type = ?, delay_ms = ?, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).run(
        enabled === undefined ? existing['is_active'] : isActive,
        name ?? existing['name'],
        match_type !== undefined || hadParams ? normalizedMatchType : existing['match_type'],
        delay ?? existing['delay_ms'],
        ruleId,
      );
    }

    // Reuse an identical version instead of piling up duplicates.
    const dup = db.prepare(`
      SELECT id, name FROM mock_versions
      WHERE rule_id = ? AND response_status = ? AND response_headers = ? AND response_body = ?
      ORDER BY id DESC LIMIT 1
    `).get(ruleId, status, headersJson, body) as { id: number; name: string } | undefined;

    let versionId: number | bigint;
    let reused = false;
    if (dup) {
      versionId = dup.id;
      reused = true;
      if ((version_name || name) && dup.name !== versionName) {
        db.prepare("UPDATE mock_versions SET name = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?")
          .run(versionName, versionId);
      }
    } else {
      versionId = db.prepare(`
        INSERT INTO mock_versions (rule_id, user_id, name, response_status, response_headers, response_body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
      `).run(ruleId, userId, versionName, status, headersJson, body).lastInsertRowid;
    }

    // activate:false lets the caller stash an alternate scenario without switching to it
    // (a brand-new rule always needs an active version to be servable).
    const rule = db.prepare('SELECT active_version_id FROM mock_rules WHERE id = ?').get(ruleId) as { active_version_id: number | null };
    if (activate !== false || !rule.active_version_id) {
      db.prepare('UPDATE mock_rules SET active_version_id = ? WHERE id = ?').run(versionId, ruleId);
    }
    return { ruleId, versionId, created: !existing, reused };
  })();

  res.status(result.created ? 201 : 200).json({
    ...ruleSummary(result.ruleId),
    created: result.created,
    version_reused: result.reused,
    saved_version_id: Number(result.versionId),
  });
});

// POST /api/mocks/switch-version - activate a version of a rule, addressed by pattern (for MCP tooling)
router.post('/switch-version', requireAuth, (req: AuthRequest, res: Response): void => {
  const { url_pattern, method, version_id, version_name } = req.body;
  if (!url_pattern || (version_id === undefined && !version_name)) {
    return bad(res, 'url_pattern and one of version_id / version_name are required');
  }
  const rules = findRulesByPattern(req.userId!, url_pattern, method ? String(method).toUpperCase() : undefined);
  if (rules.length === 0) {
    res.status(404).json({ error: 'No mock rule found for this url_pattern/method. Call upsert_mock first.' });
    return;
  }
  if (rules.length > 1) {
    res.status(409).json({
      error: 'Multiple rules match; pass "method" (and use list_mocks to pick one).',
      candidates: rules.map((r) => ({ id: r.id, method: r.method, match_type: r.match_type })),
    });
    return;
  }
  const rule = rules[0];
  const db = getDb();
  const versions = db.prepare('SELECT id, name, response_status FROM mock_versions WHERE rule_id = ? ORDER BY id ASC')
    .all(rule.id) as { id: number; name: string; response_status: number }[];
  const target = version_id !== undefined
    ? versions.find((v) => v.id === Number(version_id))
    : versions.slice().reverse().find((v) => v.name === version_name);
  if (!target) {
    res.status(404).json({ error: 'Version not found', available_versions: versions });
    return;
  }
  db.prepare("UPDATE mock_rules SET active_version_id = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?")
    .run(target.id, rule.id);
  res.json({ ...ruleSummary(rule.id), switched_to: target });
});

// POST /api/mocks/delete-by-pattern - delete a single mock rule (or version), or all matching if delete_all=true
router.post('/delete-by-pattern', requireAuth, (req: AuthRequest, res: Response): void => {
  const {
    rule_id, url_pattern, method, condition, match_type, version_id, version_name, delete_all,
  } = req.body;

  if (rule_id !== undefined && rule_id !== null) {
    if (!Number.isInteger(Number(rule_id)) || Number(rule_id) <= 0) {
      return bad(res, 'rule_id must be a positive integer');
    }
  } else if (!url_pattern || typeof url_pattern !== 'string') {
    return bad(res, 'rule_id or url_pattern is required');
  }

  if (match_type !== undefined && !(MATCH_TYPES as readonly string[]).includes(match_type)) {
    return bad(res, `match_type must be one of: ${MATCH_TYPES.join(', ')}`);
  }
  const parsedCondition = parseConditionInput(condition);
  if (!parsedCondition.ok) return bad(res, parsedCondition.error);

  if (delete_all !== undefined && typeof delete_all !== 'boolean') {
    return bad(res, 'delete_all must be a boolean');
  }
  if (version_id !== undefined && (!Number.isInteger(Number(version_id)) || Number(version_id) <= 0)) {
    return bad(res, 'version_id must be a positive integer');
  }
  if (version_name !== undefined && (typeof version_name !== 'string' || !version_name)) {
    return bad(res, 'version_name must be a non-empty string');
  }
  const deletingVersion = version_id !== undefined || version_name !== undefined;
  if (delete_all && deletingVersion) {
    return bad(res, 'delete_all cannot be combined with version_id / version_name');
  }

  const db = getDb();
  const userId = req.userId!;
  let rules: RuleLookup[];

  if (rule_id !== undefined && rule_id !== null) {
    const row = db.prepare('SELECT * FROM mock_rules WHERE id = ? AND user_id = ?')
      .get(Number(rule_id), userId) as RuleLookup | undefined;
    rules = row ? [row] : [];
  } else {
    // Deletion is strict: an omitted method means "the rule with no method restriction", not "all".
    rules = findRulesByPattern(
      userId,
      url_pattern,
      method ? String(method).toUpperCase() : null,
      match_type,
    );
    if (parsedCondition.value === null) {
      rules = rules.filter((r) => (r.condition_field_type ?? null) === null);
    } else if (parsedCondition.value !== undefined) {
      const c = parsedCondition.value;
      rules = rules.filter((r) =>
        r.condition_field_type === c.type
        && r.condition_field_key === c.key
        && r.condition_field_value === c.value,
      );
    }
  }

  if (rules.length === 0) {
    res.status(404).json({ error: 'No matching mock rule found.' });
    return;
  }

  if (rules.length > 1 && !delete_all) {
    res.status(409).json({
      error: 'Multiple mock rules match; pass rule_id (from candidates or list_mocks), condition, match_type, or set delete_all=true to delete all of them.',
      candidates: rules.map(formatRuleCandidate),
    });
    return;
  }

  if (deletingVersion) {
    const rule = rules[0];
    const versions = db.prepare('SELECT id, name, response_status FROM mock_versions WHERE rule_id = ? ORDER BY id ASC')
      .all(rule.id) as { id: number; name: string; response_status: number }[];
    const target = version_id !== undefined
      ? versions.find((v) => v.id === Number(version_id))
      : versions.slice().reverse().find((v) => v.name === version_name);
    if (!target) {
      res.status(404).json({ error: 'Version not found', available_versions: versions });
      return;
    }
    db.transaction(() => {
      db.prepare('DELETE FROM mock_versions WHERE id = ? AND rule_id = ?').run(target.id, rule.id);
      if (Number(rule.active_version_id) === target.id) {
        db.prepare(`
          UPDATE mock_rules
          SET active_version_id = NULL, is_active = 0, updated_at = datetime('now', '+8 hours')
          WHERE id = ? AND user_id = ?
        `).run(rule.id, userId);
      }
    })();
    res.json({ success: true, ...ruleSummary(rule.id), deleted_version: target });
    return;
  }

  const del = db.prepare('DELETE FROM mock_rules WHERE id = ? AND user_id = ?');
  db.transaction(() => {
    for (const r of rules) del.run(r.id, userId);
  })();
  res.json({
    success: true,
    deleted: rules.map((r) => ({
      id: r.id,
      url_pattern: r.url_pattern,
      method: r.method,
      match_type: r.match_type,
      ...(r.condition_field_type
        ? { condition: { type: r.condition_field_type, key: r.condition_field_key, value: r.condition_field_value } }
        : {}),
    })),
  });
});

export default router;
