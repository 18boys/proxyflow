import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';
import { getDb } from './db';

const SECRET_KEY = process.env.JWT_SECRET || 'proxyflow-secret-key-change-in-production-2024';
const TOKEN_EXPIRY = '7d';

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

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = decodeToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(payload.sub)) as { id: number; email: string } | undefined;
  if (!user) {
    res.status(401).json({ error: 'User not found' });
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

  const token = authHeader.slice(7);
  const payload = decodeToken(token);
  if (payload) {
    req.userId = Number(payload.sub);
    req.userEmail = payload.email;
  }
  next();
}
