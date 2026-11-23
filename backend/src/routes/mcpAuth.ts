import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest, generateApiToken, hashApiToken } from '../auth';
import { getDb } from '../db';

const router = Router();

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateUserCode(): string {
  const bytes = crypto.randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `PF-${suffix}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeHashEqual(expectedHex: string, candidateRaw: string): boolean {
  const actualBuf = Buffer.from(sha256Hex(candidateRaw), 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function resolveBaseOrigin(req: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : '';
  if (origin) return origin;

  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : req.protocol;
  const host = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : req.get('host');

  return host ? `${forwardedProto}://${host}` : '';
}

function cleanupExpiredRequests(): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE mcp_auth_requests
    SET status = 'expired', issued_token = NULL, updated_at = datetime('now', '+8 hours')
    WHERE status = 'pending' AND expires_at <= ?
  `).run(nowIso);

  // Prune completed/expired rows older than 24 hours
  db.prepare(`
    DELETE FROM mcp_auth_requests
    WHERE created_at < datetime('now', '+8 hours', '-1 day')
  `).run();
}

interface McpAuthRow {
  id: number;
  request_id: string;
  poll_secret_hash: string;
  user_code: string;
  client_name: string;
  hostname: string;
  status: string;
  user_id: number | null;
  api_token_id: number | null;
  issued_token: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// POST /api/auth/mcp/start - unauthenticated MCP client initiates a browser authorization request
router.post('/start', (req: Request, res: Response): void => {
  cleanupExpiredRequests();

  const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};
  const clientName = typeof body['client_name'] === 'string' && body['client_name'].trim()
    ? body['client_name'].trim().slice(0, 80)
    : 'ProxyFlow MCP';
  const hostname = typeof body['hostname'] === 'string'
    ? body['hostname'].trim().slice(0, 80)
    : '';

  const requestId = crypto.randomBytes(24).toString('base64url');
  const pollSecret = crypto.randomBytes(32).toString('base64url');
  const pollSecretHash = sha256Hex(pollSecret);
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + AUTH_TTL_MS).toISOString();

  const db = getDb();
  db.prepare(`
    INSERT INTO mcp_auth_requests
      (request_id, poll_secret_hash, user_code, client_name, hostname, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(requestId, pollSecretHash, userCode, clientName, hostname, expiresAt);

  const authPath = `/mcp-auth?request_id=${encodeURIComponent(requestId)}`;
  const baseOrigin = resolveBaseOrigin(req);

  res.status(201).json({
    request_id: requestId,
    poll_secret: pollSecret,
    user_code: userCode,
    auth_path: authPath,
    auth_url: baseOrigin ? `${baseOrigin}${authPath}` : authPath,
    expires_in_seconds: Math.round(AUTH_TTL_MS / 1000),
    expires_at: expiresAt,
  });
});

// GET /api/auth/mcp/request/:requestId - authenticated browser user inspects the consent request
router.get('/request/:requestId', requireAuth, (req: AuthRequest, res: Response): void => {
  cleanupExpiredRequests();

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM mcp_auth_requests WHERE request_id = ?'
  ).get(req.params['requestId']) as McpAuthRow | undefined;

  if (!row) {
    res.status(404).json({ error: '授权请求不存在或已过期，请在 AI 编辑器中重新触发授权。' });
    return;
  }

  let status = row.status;
  if (status === 'pending' && Date.parse(row.expires_at) <= Date.now()) {
    status = 'expired';
    db.prepare(`
      UPDATE mcp_auth_requests
      SET status = 'expired', issued_token = NULL, updated_at = datetime('now', '+8 hours')
      WHERE id = ?
    `).run(row.id);
  }

  const sessionsCount = (db.prepare(
    'SELECT COUNT(*) AS c FROM device_sessions WHERE user_id = ?'
  ).get(req.userId!) as { c: number }).c;

  res.json({
    request_id: row.request_id,
    user_code: row.user_code,
    client_name: row.client_name,
    hostname: row.hostname,
    status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    user_email: req.userEmail,
    has_device_session: sessionsCount > 0,
  });
});

// POST /api/auth/mcp/approve - authenticated browser user approves MCP access & generates an API token
router.post('/approve', requireAuth, (req: AuthRequest, res: Response): void => {
  const { request_id, token_name, ensure_session = true } = (req.body || {}) as {
    request_id?: string;
    token_name?: string;
    ensure_session?: boolean;
  };

  if (!request_id || typeof request_id !== 'string') {
    res.status(400).json({ error: 'request_id is required' });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM mcp_auth_requests WHERE request_id = ?'
  ).get(request_id) as McpAuthRow | undefined;

  if (!row) {
    res.status(404).json({ error: '授权请求不存在' });
    return;
  }

  if (row.status === 'pending' && Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`
      UPDATE mcp_auth_requests
      SET status = 'expired', issued_token = NULL, updated_at = datetime('now', '+8 hours')
      WHERE id = ?
    `).run(row.id);
    res.status(410).json({ error: '授权请求已过期，请重新发起授权' });
    return;
  }

  if (row.status !== 'pending') {
    res.status(409).json({ error: `该授权请求当前状态为 ${row.status}，无法重复授权` });
    return;
  }

  const defaultName = row.hostname
    ? `${row.client_name} (${row.hostname})`
    : `${row.client_name} (Auto)`;
  const finalTokenName = typeof token_name === 'string' && token_name.trim()
    ? token_name.trim().slice(0, 80)
    : defaultName.slice(0, 80);

  const token = generateApiToken();
  const tokenHash = hashApiToken(token);
  const tokenPrefix = token.slice(0, 12);

  let createdSessionId: string | null = null;

  const approved = db.transaction(() => {
    const tokenRes = db.prepare(
      'INSERT INTO api_tokens (user_id, name, token_prefix, token_hash) VALUES (?, ?, ?, ?)'
    ).run(req.userId!, finalTokenName, tokenPrefix, tokenHash);

    const updateRes = db.prepare(`
      UPDATE mcp_auth_requests
      SET status = 'approved',
          user_id = ?,
          api_token_id = ?,
          issued_token = ?,
          updated_at = datetime('now', '+8 hours')
      WHERE id = ? AND status = 'pending'
    `).run(req.userId!, tokenRes.lastInsertRowid, token, row.id);

    if (updateRes.changes === 0) {
      throw new Error('CONFLICT');
    }

    // Optionally create a default device session if the user has none yet
    if (ensure_session) {
      const existingSession = db.prepare(
        'SELECT session_id FROM device_sessions WHERE user_id = ? LIMIT 1'
      ).get(req.userId!) as { session_id: string } | undefined;
      if (!existingSession) {
        const sid = uuidv4();
        const pairingToken = uuidv4();
        const deviceName = row.hostname ? `${row.hostname} (MCP)` : 'MCP Default Device';
        db.prepare(
          'INSERT INTO device_sessions (session_id, user_id, name, pairing_token) VALUES (?, ?, ?, ?)'
        ).run(sid, req.userId!, deviceName, pairingToken);
        createdSessionId = sid;
      }
    }
    return true;
  });

  try {
    approved();
  } catch (err) {
    if (err instanceof Error && err.message === 'CONFLICT') {
      res.status(409).json({ error: '该授权请求已被处理' });
      return;
    }
    throw err;
  }

  res.json({
    success: true,
    status: 'approved',
    token_name: finalTokenName,
    token_prefix: tokenPrefix,
    user_email: req.userEmail,
    created_session_id: createdSessionId,
  });
});

// POST /api/auth/mcp/deny - authenticated browser user denies the authorization request
router.post('/deny', requireAuth, (req: AuthRequest, res: Response): void => {
  const { request_id } = (req.body || {}) as { request_id?: string };
  if (!request_id || typeof request_id !== 'string') {
    res.status(400).json({ error: 'request_id is required' });
    return;
  }

  const db = getDb();
  const result = db.prepare(`
    UPDATE mcp_auth_requests
    SET status = 'denied', issued_token = NULL, user_id = ?, updated_at = datetime('now', '+8 hours')
    WHERE request_id = ? AND status = 'pending'
  `).run(req.userId!, request_id);

  if (result.changes === 0) {
    res.status(404).json({ error: '授权请求不存在或已结束' });
    return;
  }

  res.json({ success: true, status: 'denied' });
});

// POST /api/auth/mcp/poll - MCP process polls with (request_id, poll_secret) to claim the one-time token
router.post('/poll', (req: Request, res: Response): void => {
  const { request_id, poll_secret } = (req.body || {}) as {
    request_id?: string;
    poll_secret?: string;
  };

  if (!request_id || !poll_secret || typeof request_id !== 'string' || typeof poll_secret !== 'string') {
    res.status(400).json({ error: 'request_id and poll_secret are required' });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM mcp_auth_requests WHERE request_id = ?'
  ).get(request_id) as McpAuthRow | undefined;

  if (!row) {
    res.status(404).json({ status: 'not_found', error: 'Authorization request not found' });
    return;
  }

  if (!safeHashEqual(row.poll_secret_hash, poll_secret)) {
    res.status(403).json({ error: 'Invalid poll secret' });
    return;
  }

  if (row.status === 'pending') {
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare(`
        UPDATE mcp_auth_requests
        SET status = 'expired', issued_token = NULL, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).run(row.id);
      res.json({ status: 'expired' });
      return;
    }
    res.json({ status: 'pending', expires_at: row.expires_at });
    return;
  }

  if (row.status === 'denied' || row.status === 'expired' || row.status === 'claimed') {
    res.json({ status: row.status });
    return;
  }

  if (row.status === 'approved' && row.issued_token && row.user_id) {
    const claimed = db.transaction(() => {
      const fresh = db.prepare(
        'SELECT issued_token, api_token_id, user_id FROM mcp_auth_requests WHERE id = ? AND status = \'approved\' AND issued_token IS NOT NULL'
      ).get(row.id) as { issued_token: string; api_token_id: number | null; user_id: number } | undefined;

      if (!fresh) return null;

      db.prepare(`
        UPDATE mcp_auth_requests
        SET status = 'claimed', issued_token = NULL, updated_at = datetime('now', '+8 hours')
        WHERE id = ?
      `).run(row.id);

      const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(fresh.user_id) as
        | { id: number; email: string }
        | undefined;
      const tokenMeta = fresh.api_token_id
        ? (db.prepare('SELECT id, name, token_prefix FROM api_tokens WHERE id = ?').get(fresh.api_token_id) as
            | { id: number; name: string; token_prefix: string }
            | undefined)
        : undefined;
      const defaultSession = db.prepare(
        'SELECT session_id, name FROM device_sessions WHERE user_id = ? ORDER BY last_seen DESC, created_at DESC LIMIT 1'
      ).get(fresh.user_id) as { session_id: string; name: string } | undefined;

      return {
        token: fresh.issued_token,
        user: user || { id: fresh.user_id, email: '' },
        token_name: tokenMeta?.name || '',
        token_prefix: tokenMeta?.token_prefix || fresh.issued_token.slice(0, 12),
        default_session: defaultSession || null,
      };
    })();

    if (!claimed) {
      res.json({ status: 'claimed' });
      return;
    }

    res.json({
      status: 'approved',
      token: claimed.token,
      token_name: claimed.token_name,
      token_prefix: claimed.token_prefix,
      user: claimed.user,
      default_session: claimed.default_session,
    });
    return;
  }

  res.json({ status: row.status });
});

export default router;
