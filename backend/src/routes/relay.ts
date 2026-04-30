import { Router, Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { getDb } from '../db';
import { findMatchingMock, saveRequestLog } from '../proxy';
import { wsManager } from '../websocket';

const router = Router();

/** 设置 CORS 头：保留原始 headers，只覆盖跨域相关字段 */
function applyCorsHeaders(
  req: Request,
  res: Response,
  originalHeaders: Record<string, string> = {}
) {
  const CORS_KEYS = new Set([
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
  ]);
  const SKIP_KEYS = new Set(['transfer-encoding', 'content-encoding', 'connection']);

  for (const [k, v] of Object.entries(originalHeaders)) {
    const lk = k.toLowerCase();
    if (!CORS_KEYS.has(lk) && !SKIP_KEYS.has(lk)) {
      res.setHeader(k, v);
    }
  }

  const origin = (req.headers['origin'] as string) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    (req.headers['access-control-request-headers'] as string) || '*'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// Handle CORS preflight
router.options('/', (req: Request, res: Response) => {
  applyCorsHeaders(req, res);
  res.status(204).send();
});

/**
 * POST /api/relay
 *
 * Mini-program SDK relay endpoint. Accepts a forwarded request from a mini-program,
 * applies mock rules if any match, otherwise proxies to the real target.
 *
 * Request body:
 *   {
 *     method: string,          // HTTP method (default: "GET")
 *     url: string,             // Full target URL (required)
 *     headers: object,         // Request headers (optional)
 *     body: string | null,     // Request body as string (optional)
 *     sessionId: string        // proxyflow session ID from pairing (required for tracking)
 *   }
 *
 * Response:
 *   {
 *     status: number,
 *     headers: object,
 *     body: string,
 *     isMocked: boolean,
 *     durationMs: number
 *   }
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const {
    method = 'GET',
    url,
    headers: reqHeaders = {},
    body: reqBody = null,
    sessionId,
  } = req.body as {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
    sessionId?: string;
  };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid url' });
    return;
  }

  const startTime = Date.now();

  // Identify user from sessionId
  let userId: number | null = null;
  let resolvedSessionId: string | null = null;

  if (sessionId) {
    const db = getDb();
    const session = db.prepare(
      'SELECT user_id FROM device_sessions WHERE session_id = ?'
    ).get(sessionId) as { user_id: number } | undefined;
    if (session) {
      userId = session.user_id;
      resolvedSessionId = sessionId;
      db.prepare('UPDATE device_sessions SET last_seen = datetime(\'now\', \'+8 hours\'), updated_at = datetime(\'now\', \'+8 hours\') WHERE session_id = ?').run(sessionId);
    }
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (typeof v === 'string') normalizedHeaders[k.toLowerCase()] = v;
  }

  // Check exclusion domains: if the target host is in the user's exclusion list, forward silently
  if (userId) {
    const db = getDb();
    const settings = db.prepare(
      'SELECT exclusion_domains FROM user_settings WHERE user_id = ?'
    ).get(userId) as { exclusion_domains: string } | undefined;
    if (settings) {
      const exclusions: string[] = JSON.parse(settings.exclusion_domains);
      const targetHost = targetUrl.hostname.toLowerCase();
      const isExcluded = exclusions.some(
        (domain) => targetHost === domain || targetHost.endsWith(`.${domain}`)
      );
      if (isExcluded) {
        // Forward the request silently without logging
        const isHttps = targetUrl.protocol === 'https:';
        const lib = isHttps ? https : http;
        const forwardHeaders: Record<string, string> = { ...normalizedHeaders, host: targetUrl.host };
        delete forwardHeaders['connection'];
        delete forwardHeaders['transfer-encoding'];

        const options: http.RequestOptions = {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: targetUrl.pathname + targetUrl.search,
          method: method.toUpperCase(),
          headers: forwardHeaders,
          timeout: 30000,
        };

        const proxyReq = lib.request(options, (proxyRes) => {
          applyCorsHeaders(req, res, proxyRes.headers as Record<string, string>);
          res.status(proxyRes.statusCode ?? 200);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err: Error) => {
          res.status(502).json({ error: `Upstream error: ${err.message}` });
        });

        if (reqBody) {
          proxyReq.write(reqBody);
        }
        proxyReq.end();
        return;
      }
    }
  }

  // Check for mock match
  const mockMatch = userId
    ? findMatchingMock(userId, method.toUpperCase(), url, normalizedHeaders, reqBody ?? null)
    : null;

  if (mockMatch) {
    if (mockMatch.rule.delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, mockMatch.rule.delay_ms));
    }

    const responseHeaders = JSON.parse(mockMatch.version.response_headers) as Record<string, string>;
    const durationMs = Date.now() - startTime;

    const logId = await saveRequestLog({
      userId,
      sessionId: resolvedSessionId,
      method: method.toUpperCase(),
      url,
      requestHeaders: normalizedHeaders,
      requestBody: reqBody ?? null,
      responseStatus: mockMatch.version.response_status,
      responseHeaders,
      responseBody: mockMatch.version.response_body,
      durationMs,
      isMocked: true,
      mockId: mockMatch.version.id,
    });

    const db2 = getDb();
    const log = db2.prepare('SELECT * FROM request_logs WHERE id = ?').get(logId);
    if (userId) {
      await wsManager.broadcastToUser(userId, { type: 'new_request', log });
    } else {
      await wsManager.broadcastToAll({ type: 'new_request', log });
    }

    applyCorsHeaders(req, res, responseHeaders);
    res.status(mockMatch.version.response_status).send(mockMatch.version.response_body);
    return;
  }

  // Forward to real target
  const isHttps = targetUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const requestStartTime = Date.now();
  let socketConnectedAt: number | undefined;
  let firstByteAt: number | undefined;

  const forwardHeaders: Record<string, string> = { ...normalizedHeaders, host: targetUrl.host };
  // Remove hop-by-hop headers
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];

  const options: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: method.toUpperCase(),
    headers: forwardHeaders,
    timeout: 30000,
  };

  await new Promise<void>((resolve) => {
    const proxyReq = lib.request(options, (proxyRes) => {
      firstByteAt = Date.now();

      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', async () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        const responseHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v) responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        delete responseHeaders['transfer-encoding'];

        const durationMs = Date.now() - startTime;
        const connectMs = socketConnectedAt != null ? socketConnectedAt - requestStartTime : undefined;
        const ttfbMs = firstByteAt != null ? firstByteAt - requestStartTime : undefined;

        const logId = await saveRequestLog({
          userId,
          sessionId: resolvedSessionId,
          method: method.toUpperCase(),
          url,
          requestHeaders: normalizedHeaders,
          requestBody: reqBody ?? null,
          responseStatus: proxyRes.statusCode ?? 200,
          responseHeaders,
          responseBody,
          durationMs,
          isMocked: false,
          mockId: null,
          connectMs,
          ttfbMs,
        });

        const db2 = getDb();
        const log = db2.prepare('SELECT * FROM request_logs WHERE id = ?').get(logId);
        if (userId) {
          await wsManager.broadcastToUser(userId, { type: 'new_request', log });
        } else {
          await wsManager.broadcastToAll({ type: 'new_request', log });
        }

        applyCorsHeaders(req, res, responseHeaders);
        res.status(proxyRes.statusCode ?? 200).send(responseBody);
        resolve();
      });

      proxyRes.on('error', async (err: Error) => {
        const durationMs = Date.now() - startTime;
        await saveRequestLog({
          userId,
          sessionId: resolvedSessionId,
          method: method.toUpperCase(),
          url,
          requestHeaders: normalizedHeaders,
          requestBody: reqBody ?? null,
          responseStatus: 502,
          responseHeaders: {},
          responseBody: err.message,
          durationMs,
          isMocked: false,
          mockId: null,
        });
        res.status(502).json({ error: `Upstream error: ${err.message}` });
        resolve();
      });
    });

    proxyReq.on('socket', (socket) => {
      socket.on('connect', () => {
        socketConnectedAt = Date.now();
      });
    });

    proxyReq.on('error', async (err: Error) => {
      const durationMs = Date.now() - startTime;
      await saveRequestLog({
        userId,
        sessionId: resolvedSessionId,
        method: method.toUpperCase(),
        url,
        requestHeaders: normalizedHeaders,
        requestBody: reqBody ?? null,
        responseStatus: 502,
        responseHeaders: {},
        responseBody: err.message,
        durationMs,
        isMocked: false,
        mockId: null,
      });
      res.status(502).json({ error: `Request failed: ${err.message}` });
      resolve();
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Request timeout' });
      resolve();
    });

    if (reqBody) {
      proxyReq.write(reqBody);
    }
    proxyReq.end();
  });
});

/**
 * POST /api/relay/log
 *
 * Log-only endpoint: records a request/response pair without forwarding.
 * Used by the SDK for requests it handles directly (e.g. FormData file uploads)
 * where the actual network request is done by the native stack, but we still
 * want visibility in the dashboard.
 *
 * Body: same shape as /api/relay but also accepts responseStatus / responseHeaders / responseBody.
 */
router.post('/log', async (req: Request, res: Response): Promise<void> => {
  const {
    method = 'GET',
    url,
    headers: reqHeaders = {},
    body: reqBody = null,
    sessionId,
    responseStatus = null,
    responseHeaders: resHeaders = {},
    responseBody: resBody = null,
    durationMs = null,
  } = req.body as {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
    sessionId?: string;
    responseStatus?: number | null;
    responseHeaders?: Record<string, string>;
    responseBody?: string | null;
    durationMs?: number | null;
  };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  let userId: number | null = null;
  let resolvedSessionId: string | null = null;

  if (sessionId) {
    const db = getDb();
    const session = db.prepare(
      'SELECT user_id FROM device_sessions WHERE session_id = ?'
    ).get(sessionId) as { user_id: number } | undefined;
    if (session) {
      userId = session.user_id;
      resolvedSessionId = sessionId;
      db.prepare('UPDATE device_sessions SET last_seen = datetime(\'now\', \'+8 hours\'), updated_at = datetime(\'now\', \'+8 hours\') WHERE session_id = ?').run(sessionId);
    }
  }

  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (typeof v === 'string') normalizedHeaders[k.toLowerCase()] = v;
  }

  const logId = await saveRequestLog({
    userId,
    sessionId: resolvedSessionId,
    method: method.toUpperCase(),
    url,
    requestHeaders: normalizedHeaders,
    requestBody: reqBody ?? null,
    responseStatus: responseStatus ?? null,
    responseHeaders: resHeaders,
    responseBody: resBody ?? null,
    durationMs: typeof durationMs === 'number' ? durationMs : null,
    isMocked: false,
    mockId: null,
  });

  const db2 = getDb();
  const log = db2.prepare('SELECT * FROM request_logs WHERE id = ?').get(logId);
  if (userId) {
    await wsManager.broadcastToUser(userId, { type: 'new_request', log });
  } else {
    await wsManager.broadcastToAll({ type: 'new_request', log });
  }

  res.json({ ok: true });
});

export default router;
