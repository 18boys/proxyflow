import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { decodeToken } from './auth';
import { getDb } from './db';

interface DashboardClient {
  ws: WebSocket;
  userId: number;
}

interface DeviceClient {
  ws: WebSocket;
  sessionId: string;
  userId: number;
}

class WsManager {
  private wss!: WebSocketServer;
  // userId -> list of dashboard connections
  private dashboardClients: Map<number, WebSocket[]> = new Map();
  // sessionId -> device connection
  private deviceClients: Map<string, DeviceClient> = new Map();

  initialize(wss: WebSocketServer) {
    this.wss = wss;

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = req.url || '';

      if (url.startsWith('/ws/dashboard')) {
        this.handleDashboardConnection(ws, req);
      } else if (url.startsWith('/ws/device')) {
        this.handleDeviceConnection(ws, req);
      } else {
        ws.close(1008, 'Unknown path');
      }
    });
  }

  private handleDashboardConnection(ws: WebSocket, req: IncomingMessage) {
    // Auth via query param: /ws/dashboard?token=xxx
    const url = new URL(req.url!, `http://localhost`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Missing token');
      return;
    }

    const payload = decodeToken(token);
    if (!payload) {
      ws.close(1008, 'Invalid token');
      return;
    }

    const userId = Number(payload.sub);

    if (!this.dashboardClients.has(userId)) {
      this.dashboardClients.set(userId, []);
    }
    this.dashboardClients.get(userId)!.push(ws);

    ws.on('close', () => {
      const clients = this.dashboardClients.get(userId) || [];
      const idx = clients.indexOf(ws);
      if (idx !== -1) clients.splice(idx, 1);
    });

    ws.on('error', () => {
      const clients = this.dashboardClients.get(userId) || [];
      const idx = clients.indexOf(ws);
      if (idx !== -1) clients.splice(idx, 1);
    });

    // Send a ping to confirm connection
    ws.send(JSON.stringify({ type: 'connected', userId }));
  }

  private handleDeviceConnection(ws: WebSocket, req: IncomingMessage) {
    // Auth via query param: /ws/device?token=xxx
    const url = new URL(req.url!, `http://localhost`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Missing token');
      return;
    }

    // Validate pairing token against DB
    const db = getDb();
    const session = db.prepare(
      'SELECT * FROM device_sessions WHERE pairing_token = ?'
    ).get(token) as { session_id: string; user_id: number; id: number } | undefined;

    if (!session) {
      ws.close(1008, 'Invalid pairing token');
      return;
    }

    const { session_id: sessionId, user_id: userId } = session;

    // Mark session as online
    db.prepare(
      'UPDATE device_sessions SET is_online = 1, last_seen = datetime(\'now\', \'+8 hours\'), updated_at = datetime(\'now\', \'+8 hours\') WHERE session_id = ?'
    ).run(sessionId);

    this.deviceClients.set(sessionId, { ws, sessionId, userId });

    // Notify dashboard
    this.broadcastToUser(userId, {
      type: 'device_online',
      sessionId,
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleDeviceMessage(sessionId, userId, msg);
      } catch {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      this.deviceClients.delete(sessionId);
      db.prepare(
        'UPDATE device_sessions SET is_online = 0, last_seen = datetime(\'now\', \'+8 hours\'), updated_at = datetime(\'now\', \'+8 hours\') WHERE session_id = ?'
      ).run(sessionId);

      this.broadcastToUser(userId, {
        type: 'device_offline',
        sessionId,
      });
    });

    ws.on('error', () => {
      this.deviceClients.delete(sessionId);
    });

    ws.send(JSON.stringify({ type: 'paired', sessionId }));
  }

  private handleDeviceMessage(sessionId: string, userId: number, msg: Record<string, unknown>) {
    // Relay request logs from device to dashboard
    if (msg.type === 'request_log') {
      this.broadcastToUser(userId, { ...msg, sessionId });
    }
  }

  async broadcastToUser(userId: number, message: object) {
    const clients = this.dashboardClients.get(userId) || [];
    const json = JSON.stringify(message);
    const dead: WebSocket[] = [];

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
        } catch {
          dead.push(ws);
        }
      } else {
        dead.push(ws);
      }
    }

    // Clean up dead connections
    for (const ws of dead) {
      const idx = clients.indexOf(ws);
      if (idx !== -1) clients.splice(idx, 1);
    }
  }

  // Broadcast to ALL authenticated dashboard users (for anonymous proxy requests)
  async broadcastToAll(message: object) {
    const json = JSON.stringify(message);
    for (const [userId, clients] of this.dashboardClients.entries()) {
      const dead: WebSocket[] = [];
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(json);
          } catch {
            dead.push(ws);
          }
        } else {
          dead.push(ws);
        }
      }
      // Clean up dead connections
      for (const ws of dead) {
        const idx = clients.indexOf(ws);
        if (idx !== -1) clients.splice(idx, 1);
      }
      void userId; // suppress unused warning
    }
  }

  isDeviceOnline(sessionId: string): boolean {
    return this.deviceClients.has(sessionId) || this.simulatedOnline.has(sessionId);
  }

  // Simulated online devices set (for testing without a real RN SDK)
  private simulatedOnline: Set<string> = new Set();

  simulateDeviceOnline(sessionId: string): void {
    this.simulatedOnline.add(sessionId);

    // Lookup the user_id for this session so we can notify the dashboard
    const db = getDb();
    const session = db.prepare(
      'SELECT user_id FROM device_sessions WHERE session_id = ?'
    ).get(sessionId) as { user_id: number } | undefined;

    if (session) {
      this.broadcastToUser(session.user_id, { type: 'device_online', sessionId });
    }
  }
}

export const wsManager = new WsManager();
