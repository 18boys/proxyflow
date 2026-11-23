import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { requireAuth, AuthRequest } from '../auth';
import { getDb } from '../db';
import { wsManager } from '../websocket';

const router = Router();
const HOST = process.env.HOST || 'localhost';
const WS_PORT = process.env.PORT || '9000';

function resolveDeviceEndpoints(req: Request, pairingToken: string) {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : req.protocol;
  const host = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : req.get('host');

  const httpUrl = configured || (host ? `${forwardedProto}://${host}` : `http://${HOST}:${WS_PORT}`);
  const wsBase = httpUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  const wsUrl = `${wsBase}/ws/device?token=${pairingToken}`;
  const relayUrl = `${httpUrl}/api/relay`;
  return { httpUrl, wsUrl, relayUrl };
}

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

// POST /api/devices/ensure - idempotently get an existing device session or create a new one (for MCP/agent setup)
router.post('/ensure', requireAuth, (req: AuthRequest, res: Response): void => {
  const { name, create_new = false } = (req.body || {}) as {
    name?: string;
    create_new?: boolean;
  };
  const trimmedName = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  const db = getDb();

  let row: {
    session_id: string;
    name: string;
    pairing_token: string;
    last_seen: string | null;
    created_at: string;
  } | undefined;
  let created = false;

  if (!create_new) {
    if (trimmedName) {
      row = db.prepare(`
        SELECT session_id, name, pairing_token, last_seen, created_at
        FROM device_sessions
        WHERE user_id = ? AND name = ? COLLATE NOCASE
        ORDER BY last_seen DESC, id DESC
        LIMIT 1
      `).get(req.userId!, trimmedName) as typeof row;
    } else {
      row = db.prepare(`
        SELECT session_id, name, pairing_token, last_seen, created_at
        FROM device_sessions
        WHERE user_id = ?
        ORDER BY last_seen DESC, id DESC
        LIMIT 1
      `).get(req.userId!) as typeof row;
    }
  }

  if (!row) {
    const sessionId = uuidv4();
    const pairingToken = uuidv4();
    const finalName = trimmedName || 'MCP Device';
    db.prepare(
      'INSERT INTO device_sessions (session_id, user_id, name, pairing_token) VALUES (?, ?, ?, ?)'
    ).run(sessionId, req.userId!, finalName, pairingToken);
    row = db.prepare(
      'SELECT session_id, name, pairing_token, last_seen, created_at FROM device_sessions WHERE session_id = ?'
    ).get(sessionId) as NonNullable<typeof row>;
    created = true;
  }

  const { httpUrl, wsUrl, relayUrl } = resolveDeviceEndpoints(req, row.pairing_token);
  const isOnline = wsManager.isDeviceOnline(row.session_id);

  res.status(created ? 201 : 200).json({
    session_id: row.session_id,
    name: row.name,
    pairing_token: row.pairing_token,
    is_online: isOnline,
    last_seen: row.last_seen,
    created_at: row.created_at,
    created,
    http_url: httpUrl,
    relay_url: relayUrl,
    ws_url: wsUrl,
  });
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

  const { wsUrl, httpUrl } = resolveDeviceEndpoints(req, pairingToken);
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

  const { wsUrl, httpUrl } = resolveDeviceEndpoints(req, session.pairing_token);
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
