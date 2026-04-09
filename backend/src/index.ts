import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { initializeDb } from './db';
import { wsManager } from './websocket';
import { createProxyServer } from './proxy';

import authRouter from './routes/auth';
import devicesRouter from './routes/devices';
import requestsRouter from './routes/requests';
import mocksRouter from './routes/mocks';
import rulesRouter from './routes/rules';
import aiRouter from './routes/ai';
import settingsRouter from './routes/settings';
import relayRouter from './routes/relay';

const API_PORT = parseInt(process.env.PORT || '9000');
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '9001');

// ── Initialize database & sync schema ────────────────────────────────────
initializeDb();

// ── Express API server ───────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Allow dashboard origins and mini-program / SDK clients (which may have no origin)
    const allowed = ['http://localhost:3100', 'http://127.0.0.1:3100'];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      // Allow all origins for the relay endpoint (mini-programs, SDK clients)
      callback(null, true);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// ── API Routes ───────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/mocks', mocksRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/relay', relayRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── HTTP Server + WebSocket ──────────────────────────────────────────────
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

// Patch the wss to accept paths /ws/dashboard and /ws/device by routing the upgrade
const wssAll = new WebSocketServer({ noServer: true });
wsManager.initialize(wssAll);

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/ws/dashboard') || url.startsWith('/ws/device')) {
    wssAll.handleUpgrade(req, socket as import('net').Socket, head, (ws) => {
      wssAll.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Close the unused wss
wss.close();

server.listen(API_PORT, () => {
  console.log(`✅ proxyflow API server running at http://localhost:${API_PORT}`);
  console.log(`   WebSocket dashboard: ws://localhost:${API_PORT}/ws/dashboard?token=<jwt>`);
  console.log(`   WebSocket device:    ws://localhost:${API_PORT}/ws/device?token=<pairing_token>`);
});

// ── HTTP Proxy server ────────────────────────────────────────────────────
const proxyServer = createProxyServer();
proxyServer.listen(PROXY_PORT, () => {
  console.log(`✅ proxyflow Proxy server running at http://localhost:${PROXY_PORT}`);
  console.log(`   Usage: curl -x http://localhost:${PROXY_PORT} https://httpbin.org/get`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close();
  proxyServer.close();
  process.exit(0);
});
