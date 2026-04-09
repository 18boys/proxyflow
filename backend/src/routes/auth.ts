import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { hashPassword, verifyPassword, createToken, requireAuth, AuthRequest } from '../auth';

const router = Router();

// POST /api/auth/register
router.post('/register', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const hashed = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (email, hashed_password) VALUES (?, ?)'
  ).run(email, hashed);

  const userId = result.lastInsertRowid as number;
  const token = createToken(userId, email);

  res.status(201).json({ token, user: { id: userId, email } });
});

// POST /api/auth/login
router.post('/login', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | { id: number; email: string; hashed_password: string }
    | undefined;

  if (!user || !verifyPassword(password, user.hashed_password)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = createToken(user.id, user.email);
  res.json({ token, user: { id: user.id, email: user.email } });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: AuthRequest, res: Response): void => {
  res.json({ id: req.userId, email: req.userEmail });
});

export default router;
