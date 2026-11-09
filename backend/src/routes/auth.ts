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

// POST /api/auth/continue (智能合并登录与注册：已存在则验证登录，未注册则自动建号)
router.post('/continue', (req: Request, res: Response): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: '请输入邮箱和密码' });
    return;
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
    res.status(400).json({ error: '请输入有效的邮箱地址' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: '密码长度至少为 6 位' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail) as
    | { id: number; email: string; hashed_password: string }
    | undefined;

  // 1. 用户已存在 -> 校验密码登录
  if (user) {
    if (!verifyPassword(password, user.hashed_password)) {
      res.status(401).json({ error: '密码错误，请重新输入' });
      return;
    }
    const token = createToken(user.id, user.email);
    res.json({ token, user: { id: user.id, email: user.email }, isNewUser: false });
    return;
  }

  // 2. 用户不存在 -> 自动注册创建并登录
  const hashed = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (email, hashed_password) VALUES (?, ?)'
  ).run(trimmedEmail, hashed);

  const userId = result.lastInsertRowid as number;
  const token = createToken(userId, trimmedEmail);

  res.status(201).json({ token, user: { id: userId, email: trimmedEmail }, isNewUser: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req: AuthRequest, res: Response): void => {
  res.json({ id: req.userId, email: req.userEmail });
});

// POST /api/auth/refresh - issue a new token (resets expiry)
router.post('/refresh', requireAuth, (req: AuthRequest, res: Response): void => {
  const token = createToken(req.userId!, req.userEmail!);
  res.json({ token, user: { id: req.userId!, email: req.userEmail! } });
});

export default router;
