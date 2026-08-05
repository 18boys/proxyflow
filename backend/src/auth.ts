import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';

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

export function verifyApiToken(token: string): { id: number; email: string } | null {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;

  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.email, t.id AS token_id
    FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL
  `).get(hashApiToken(token)) as { id: number; email: string; token_id: number } | undefined;

  if (!row) return null;

  db.prepare(
    "UPDATE api_tokens SET last_used_at = datetime('now', '+8 hours') WHERE id = ?"
  ).run(row.token_id);

  return { id: row.id, email: row.email };
}

function resolveUser(token: string): { id: number; email: string } | null {
  const payload = decodeToken(token);
  if (payload) {
    const db = getDb();
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(payload.sub)) as { id: number; email: string } | undefined;
    return user || null;
  }
  return verifyApiToken(token);
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
  }
  next();
}
