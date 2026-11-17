import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getDb, recordMcpCallStats } from './db';

const SECRET_KEY = process.env.JWT_SECRET || 'proxyflow-secret-key-change-in-production-2024';
const TOKEN_EXPIRY = '30d';
const API_TOKEN_PREFIX = 'pf_';

export interface JwtPayload {
  sub: string;  // user id as string
  email: string;
}

export interface AuthRequest extends Request {
  userId?: number;
  userEmail?: string;
  apiTokenId?: number;
  apiTokenName?: string;
}

export interface ResolvedUser {
  id: number;
  email: string;
  tokenId?: number;
  tokenName?: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(plain: string, hashed: string): boolean {
  return bcrypt.compareSync(plain, hashed);
}

export function createToken(userId: number, email: string): string {
  const payload: JwtPayload = { sub: String(userId), email };
  return jwt.sign(payload, SECRET_KEY, { expiresIn: TOKEN_EXPIRY });
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, SECRET_KEY) as JwtPayload;
  } catch {
    return null;
  }
}

export function generateApiToken(): string {
  return API_TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
}

export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyApiToken(token: string): ResolvedUser | null {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;

  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.email, t.id AS token_id, t.name AS token_name
    FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL
  `).get(hashApiToken(token)) as { id: number; email: string; token_id: number; token_name: string } | undefined;

  if (!row) return null;

  db.prepare(
    "UPDATE api_tokens SET last_used_at = datetime('now', '+8 hours') WHERE id = ?"
  ).run(row.token_id);

  return {
    id: row.id,
    email: row.email,
    tokenId: row.token_id,
    tokenName: row.token_name,
  };
}

function resolveUser(token: string): ResolvedUser | null {
  const payload = decodeToken(token);
  if (payload) {
    const db = getDb();
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(payload.sub)) as { id: number; email: string } | undefined;
    return user || null;
  }
  return verifyApiToken(token);
}

function cleanTargetEndpoint(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return u.pathname || '/';
    } catch {
      // fall through
    }
  }
  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  return withoutQuery.startsWith('/') || withoutQuery === '*' ? withoutQuery : `/${withoutQuery}`;
}

function cleanTargetMethod(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'ANY';
  return raw.trim().toUpperCase();
}

function resolveMcpCallInfo(req: Request, userId: number): {
  toolName: string;
  targetEndpoint: string;
  targetMethod: string;
} | null {
  const fullPath = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const method = (req.method || 'GET').toUpperCase();

  // Skip preflight health check (/api/auth/me) or stats query itself
  if (fullPath === '/api/auth/me' || fullPath.startsWith('/api/stats')) {
    return null;
  }

  const headerTool = typeof req.headers['x-mcp-tool'] === 'string' ? req.headers['x-mcp-tool'].trim() : '';
  const body = (req.body && typeof req.body === 'object') ? (req.body as Record<string, unknown>) : {};
  const query = (req.query || {}) as Record<string, unknown>;
  const db = getDb();

  if (method === 'POST' && fullPath === '/api/mocks/upsert') {
    let endpoint = cleanTargetEndpoint(body['url_pattern']);
    let targetMethod = cleanTargetMethod(body['method']);
    if (!endpoint && typeof body['from_request_id'] === 'number') {
      const log = db.prepare('SELECT path, url, method FROM request_logs WHERE id = ?').get(body['from_request_id']) as
        | { path: string; url: string; method: string }
        | undefined;
      if (log) {
        endpoint = cleanTargetEndpoint(log.path || log.url);
        if (targetMethod === 'ANY') targetMethod = cleanTargetMethod(log.method);
      }
    }
    return {
      toolName: headerTool || 'upsert_mock',
      targetEndpoint: endpoint,
      targetMethod,
    };
  }

  if (method === 'PATCH' && fullPath === '/api/rules/toggle-by-pattern') {
    return {
      toolName: headerTool || 'toggle_mock',
      targetEndpoint: cleanTargetEndpoint(body['url_pattern']),
      targetMethod: cleanTargetMethod(body['method']),
    };
  }

  if (method === 'POST' && fullPath === '/api/mocks/switch-version') {
    return {
      toolName: headerTool || 'switch_mock_version',
      targetEndpoint: cleanTargetEndpoint(body['url_pattern']),
      targetMethod: cleanTargetMethod(body['method']),
    };
  }

  if (method === 'POST' && fullPath === '/api/mocks/delete-by-pattern') {
    let endpoint = cleanTargetEndpoint(body['url_pattern']);
    let targetMethod = cleanTargetMethod(body['method']);
    if (!endpoint && body['rule_id'] != null) {
      const rule = db.prepare('SELECT url_pattern, method FROM mock_rules WHERE id = ? AND user_id = ?').get(
        Number(body['rule_id']),
        userId
      ) as { url_pattern: string; method: string | null } | undefined;
      if (rule) {
        endpoint = cleanTargetEndpoint(rule.url_pattern);
        if (targetMethod === 'ANY' && rule.method) targetMethod = cleanTargetMethod(rule.method);
      }
    }
    return {
      toolName: headerTool || 'delete_mock',
      targetEndpoint: endpoint,
      targetMethod,
    };
  }

  if (method === 'GET' && fullPath === '/api/mocks') {
    return {
      toolName: headerTool || 'list_mocks',
      targetEndpoint: query['search'] ? String(query['search']).trim() : '*',
      targetMethod: 'ANY',
    };
  }

  if (method === 'GET' && fullPath === '/api/requests/wait') {
    return {
      toolName: headerTool || 'wait_for_request',
      targetEndpoint: cleanTargetEndpoint(query['url_pattern']),
      targetMethod: cleanTargetMethod(query['method']),
    };
  }

  if (method === 'GET' && fullPath === '/api/requests') {
    return {
      toolName: headerTool || 'list_recent_requests',
      targetEndpoint: query['url'] ? cleanTargetEndpoint(query['url']) : '*',
      targetMethod: cleanTargetMethod(query['method']),
    };
  }

  const reqDetailMatch = fullPath.match(/^\/api\/requests\/(\d+)$/);
  if (method === 'GET' && reqDetailMatch) {
    const reqId = Number(reqDetailMatch[1]);
    const log = db.prepare('SELECT path, url, method FROM request_logs WHERE id = ?').get(reqId) as
      | { path: string; url: string; method: string }
      | undefined;
    return {
      toolName: headerTool || 'get_request',
      targetEndpoint: log ? cleanTargetEndpoint(log.path || log.url) : `#${reqId}`,
      targetMethod: log ? cleanTargetMethod(log.method) : 'GET',
    };
  }

  return {
    toolName: headerTool || `${method.toLowerCase()}_${fullPath.replace(/^\/api\//, '').replace(/\//g, '_')}`,
    targetEndpoint: cleanTargetEndpoint(body['url_pattern'] || query['url_pattern'] || fullPath),
    targetMethod: cleanTargetMethod(body['method'] || query['method'] || method),
  };
}

function attachMcpTrackerIfNeeded(req: AuthRequest, res: Response, user: ResolvedUser): void {
  if (!user.tokenId) return;
  const startedAt = Date.now();
  const callInfo = resolveMcpCallInfo(req, user.id);
  if (!callInfo) return;

  res.once('finish', () => {
    recordMcpCallStats({
      userId: user.id,
      tokenId: user.tokenId ?? null,
      tokenName: user.tokenName ?? '',
      toolName: callInfo.toolName,
      targetEndpoint: callInfo.targetEndpoint,
      targetMethod: callInfo.targetMethod,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const user = resolveUser(authHeader.slice(7));
  if (!user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.apiTokenId = user.tokenId;
  req.apiTokenName = user.tokenName;
  attachMcpTrackerIfNeeded(req, res, user);
  next();
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const user = resolveUser(authHeader.slice(7));
  if (user) {
    req.userId = user.id;
    req.userEmail = user.email;
    req.apiTokenId = user.tokenId;
    req.apiTokenName = user.tokenName;
    attachMcpTrackerIfNeeded(req, res, user);
  }
  next();
}
