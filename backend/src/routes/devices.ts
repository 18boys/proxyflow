import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { wsManager } from '../websocket';

const router = Router();
const HOST = process.env.HOST || 'localhost';
const WS_PORT = process.env.PORT || '9000';

// GET /api/devices
router.get('/', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const devices = db.prepare(
    'SELECT * FROM device_sessions WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.userId!);

  // Sync online status with WS manager
  const enriched = (devices as Record<string, unknown>[]).map((d) => ({
    ...d,
    is_online: wsManager.isDeviceOnline(d['session_id'] as string) ? 1 : 0,
  }));

  res.json(enriched);
});

// POST /api/devices/pair - generate QR code for pairing
router.post('/pair', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body;
  const db = getDb();

  const sessionId = uuidv4();
  const pairingToken = uuidv4();

  db.prepare(
    'INSERT INTO device_sessions (session_id, user_id, name, pairing_token) VALUES (?, ?, ?, ?)'
  ).run(sessionId, req.userId!, name || 'My Device', pairingToken);

  const wsUrl = `ws://${HOST}:${WS_PORT}/ws/device?token=${pairingToken}`;
  const httpUrl = `http://${HOST}:${WS_PORT}`;
  const qrData = JSON.stringify({ wsUrl, httpUrl, sessionId, pairingToken });
  const qrDataUrl = await QRCode.toDataURL(qrData, { width: 256, margin: 2 });

  res.json({ sessionId, pairingToken, wsUrl, httpUrl, qrCode: qrDataUrl });
});

// DELETE /api/devices/:sessionId - disconnect device
router.delete('/:sessionId', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const session = db.prepare(
    'SELECT * FROM device_sessions WHERE session_id = ? AND user_id = ?'
  ).get(req.params['sessionId'], req.userId!);

  if (!session) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  db.prepare(
    'DELETE FROM device_sessions WHERE session_id = ? AND user_id = ?'
  ).run(req.params['sessionId'], req.userId!);

  res.json({ success: true });
});

// GET /api/devices/:sessionId/pair-info - get QR code for an existing device
router.get('/:sessionId/pair-info', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const db = getDb();
  const session = db.prepare(
    'SELECT * FROM device_sessions WHERE session_id = ? AND user_id = ?'
  ).get(req.params['sessionId'], req.userId!) as { session_id: string; pairing_token: string } | undefined;

  if (!session) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  const wsUrl = `ws://${HOST}:${WS_PORT}/ws/device?token=${session.pairing_token}`;
  const httpUrl = `http://${HOST}:${WS_PORT}`;
  const qrData = JSON.stringify({ wsUrl, httpUrl, sessionId: session.session_id, pairingToken: session.pairing_token });
  const qrDataUrl = await QRCode.toDataURL(qrData, { width: 256, margin: 2 });

  res.json({ sessionId: session.session_id, pairingToken: session.pairing_token, wsUrl, httpUrl, qrCode: qrDataUrl });
});

// POST /api/devices/:sessionId/simulate-online - mark device as online for testing (no real RN SDK needed)
router.post('/:sessionId/simulate-online', requireAuth, (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const session = db.prepare(
    'SELECT * FROM device_sessions WHERE session_id = ? AND user_id = ?'
  ).get(req.params['sessionId'], req.userId!) as { session_id: string } | undefined;

  if (!session) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  // Mark the device as online in the WS manager so the devices list reflects it
  wsManager.simulateDeviceOnline(session.session_id);

  // Also update last_seen in the DB
  db.prepare(
    `UPDATE device_sessions SET last_seen = datetime('now', '+8 hours'), updated_at = datetime('now', '+8 hours')
     WHERE session_id = ? AND user_id = ?`
  ).run(req.params['sessionId'], req.userId!);

  res.json({ success: true, session_id: session.session_id, is_online: true });
});

// PATCH /api/devices/:sessionId/name - rename device
router.patch('/:sessionId/name', requireAuth, (req: AuthRequest, res: Response): void => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  const db = getDb();
  const result = db.prepare(
    'UPDATE device_sessions SET name = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE session_id = ? AND user_id = ?'
  ).run(name, req.params['sessionId'], req.userId!);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Device not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
