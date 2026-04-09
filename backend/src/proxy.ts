import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import { getDb } from './db';
import { wsManager } from './websocket';

interface MockRule {
  id: number;
  user_id: number;
  url_pattern: string;
  match_type: string;
  method: string | null;
  is_active: number;
  active_version_id: number | null;
  delay_ms: number;
  condition_field_type: string | null;
  condition_field_key: string | null;
  condition_field_value: string | null;
}

interface MockVersion {
  id: number;
  rule_id: number;
  response_status: number;
  response_headers: string;
  response_body: string;
}

function matchUrlPattern(pattern: string, url: string, matchType: string): boolean {
  // Extract just the pathname (and optional search) from the full URL
  // e.g. "http://example.com/api/users/123?foo=bar" -> "/api/users/123"
  let urlToMatch: string;
  try {
    const parsed = new URL(url);
    urlToMatch = parsed.pathname;
  } catch {
    urlToMatch = url.split('?')[0];
  }

  // Also support pattern as full URL (e.g. "http://example.com/api/users/*")
  let patternPath: string;
  try {
    const parsedPattern = new URL(pattern);
    patternPath = parsedPattern.pathname;
  } catch {
    patternPath = pattern.split('?')[0];
  }

  if (matchType === 'exact') {
    // Support both full URL match and path-only match
    return urlToMatch === patternPath || url === pattern;
  } else if (matchType === 'wildcard') {
    // Convert wildcard pattern to regex
    const regexStr = patternPath.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${regexStr}$`).test(urlToMatch);
  } else if (matchType === 'regex') {
    try {
      // Try matching against both full URL and path
      return new RegExp(pattern).test(url) || new RegExp(pattern).test(urlToMatch);
    } catch {
      return false;
    }
  }
  return false;
}

function checkCondition(
  rule: MockRule,
  requestHeaders: Record<string, string>,
  requestBody: string | null
): boolean {
  if (!rule.condition_field_type || !rule.condition_field_key || !rule.condition_field_value) {
    return true;
  }

  if (rule.condition_field_type === 'header') {
    const value = requestHeaders[rule.condition_field_key.toLowerCase()] || '';
    return value === rule.condition_field_value;
  } else if (rule.condition_field_type === 'body') {
    if (!requestBody) return false;
    try {
      const body = JSON.parse(requestBody);
      const value = body[rule.condition_field_key];
      return String(value) === rule.condition_field_value;
    } catch {
      return false;
    }
  }
  return true;
}

interface MockMatch {
  rule: MockRule;
  version: MockVersion;
}

export function findMatchingMock(
  userId: number,
  method: string,
  url: string,
  requestHeaders: Record<string, string>,
  requestBody: string | null
): MockMatch | null {
  const db = getDb();
  const rules = db.prepare(
    'SELECT * FROM mock_rules WHERE user_id = ? AND is_active = 1'
  ).all(userId) as MockRule[];

  for (const rule of rules) {
    if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
    if (!matchUrlPattern(rule.url_pattern, url, rule.match_type)) continue;
    if (!checkCondition(rule, requestHeaders, requestBody)) continue;

    // Get active version
    let version: MockVersion | undefined;
    if (rule.active_version_id) {
      version = db.prepare(
        'SELECT * FROM mock_versions WHERE id = ? AND rule_id = ?'
      ).get(rule.active_version_id, rule.id) as MockVersion | undefined;
    }
    if (!version) {
      version = db.prepare(
        'SELECT * FROM mock_versions WHERE rule_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(rule.id) as MockVersion | undefined;
    }

    if (version) {
      return { rule, version };
    }
  }

  return null;
}

export async function saveRequestLog(data: {
  userId: number | null;
  sessionId: string | null;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  durationMs: number | null;
  isMocked: boolean;
  mockId: number | null;
  dnsMs?: number;
  connectMs?: number;
  ttfbMs?: number;
}): Promise<number> {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO request_logs
      (user_id, session_id, method, url, path, request_headers, request_body,
       response_status, response_headers, response_body, duration_ms, is_mocked, mock_id,
       dns_ms, connect_ms, ttfb_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), datetime('now', '+8 hours'))
  `).run(
    data.userId,
    data.sessionId,
    data.method,
    data.url,
    new URL(data.url.startsWith('http') ? data.url : `http://x${data.url}`).pathname,
    JSON.stringify(data.requestHeaders),
    data.requestBody,
    data.responseStatus,
    JSON.stringify(data.responseHeaders),
    data.responseBody,
    data.durationMs,
    data.isMocked ? 1 : 0,
    data.mockId,
    data.dnsMs ?? null,
    data.connectMs ?? null,
    data.ttfbMs ?? null,
  );
  
  const lastInsertRowid = result.lastInsertRowid as number;

  try {
    // 1. 删除 1 小时前的数据
    if (data.userId) {
      db.prepare(`DELETE FROM request_logs WHERE user_id = ? AND created_at < datetime('now', '+8 hours', '-1 hour')`).run(data.userId);
    } else {
      db.prepare(`DELETE FROM request_logs WHERE user_id IS NULL AND created_at < datetime('now', '+8 hours', '-1 hour')`).run();
    }

    // 2. 每个用户最多保留 100 条请求
    if (data.userId) {
      db.prepare(`
        DELETE FROM request_logs 
        WHERE user_id = ? AND id NOT IN (
          SELECT id FROM request_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100
        )
      `).run(data.userId, data.userId);
    } else {
      db.prepare(`
        DELETE FROM request_logs 
        WHERE user_id IS NULL AND id NOT IN (
          SELECT id FROM request_logs WHERE user_id IS NULL ORDER BY id DESC LIMIT 100
        )
      `).run();
    }
  } catch (err) {
    console.error('[proxy] Error cleaning up old request logs:', err);
  }

  return lastInsertRowid;
}

export function createProxyServer(): http.Server {
  const proxyServer = http.createServer(async (clientReq, clientRes) => {
    const startTime = Date.now();

    // Parse the target URL from the request
    let targetUrl: URL;
    try {
      if (clientReq.url!.startsWith('http')) {
        targetUrl = new URL(clientReq.url!);
      } else {
        clientRes.writeHead(400);
        clientRes.end('Bad Request: URL must be absolute');
        return;
      }
    } catch {
      clientRes.writeHead(400);
      clientRes.end('Bad Request: Invalid URL');
      return;
    }

    // Collect request body
    const bodyChunks: Buffer[] = [];
    clientReq.on('data', (chunk) => bodyChunks.push(chunk));
    await new Promise<void>((resolve) => clientReq.on('end', resolve));
    const requestBody = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString('utf8') : null;

    const requestHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(clientReq.headers)) {
      if (val) requestHeaders[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
    }

    // Remove proxy-specific headers
    delete requestHeaders['proxy-connection'];
    delete requestHeaders['proxy-authorization'];

    // Try to identify the user by session or auth token
    let userId: number | null = null;
    let sessionId: string | null = null;

    const sessionHeader = requestHeaders['x-proxyflow-session'];
    if (sessionHeader) {
      const db = getDb();
      const session = db.prepare(
        'SELECT user_id FROM device_sessions WHERE session_id = ?'
      ).get(sessionHeader) as { user_id: number } | undefined;
      if (session) {
        userId = session.user_id;
        sessionId = sessionHeader;
      }
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
          // Forward the request as a transparent proxy without logging
          const libExcl = targetUrl.protocol === 'https:' ? https : http;
          const exclReq = libExcl.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: clientReq.method,
            headers: { ...requestHeaders, host: targetUrl.host },
          }, (exclRes) => {
            clientRes.writeHead(exclRes.statusCode || 200, exclRes.headers as Record<string, string>);
            exclRes.pipe(clientRes);
          });
          exclReq.on('error', () => { clientRes.writeHead(502); clientRes.end('Proxy Error'); });
          if (requestBody) exclReq.write(requestBody);
          exclReq.end();
          return;
        }
      }
    }

    // Check for mock match
    const mockMatch = userId ? findMatchingMock(
      userId,
      clientReq.method || 'GET',
      targetUrl.toString(),
      requestHeaders,
      requestBody
    ) : null;

    if (mockMatch) {
      // Apply delay
      if (mockMatch.rule.delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, mockMatch.rule.delay_ms));
      }

      const responseHeaders = JSON.parse(mockMatch.version.response_headers);
      clientRes.writeHead(mockMatch.version.response_status, responseHeaders);
      clientRes.end(mockMatch.version.response_body);

      const durationMs = Date.now() - startTime;
      const logId = await saveRequestLog({
        userId,
        sessionId,
        method: clientReq.method || 'GET',
        url: targetUrl.toString(),
        requestHeaders,
        requestBody,
        responseStatus: mockMatch.version.response_status,
        responseHeaders,
        responseBody: mockMatch.version.response_body,
        durationMs,
        isMocked: true,
        mockId: mockMatch.version.id,
      });

      {
        const db2 = getDb();
        const log = db2.prepare('SELECT * FROM request_logs WHERE id = ?').get(logId);
        if (userId) {
          await wsManager.broadcastToUser(userId, { type: 'new_request', log });
        } else {
          await wsManager.broadcastToAll({ type: 'new_request', log });
        }
      }
      return;
    }

    // Forward the request to the target
    const isHttps = targetUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const requestStartTime = Date.now();
    let socketConnectedAt: number | undefined;   // when TCP connection is established
    let firstByteAt: number | undefined;          // when first response byte arrives

    const options: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: clientReq.method,
      headers: { ...requestHeaders, host: targetUrl.host },
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      firstByteAt = Date.now();

      const responseChunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => responseChunks.push(chunk));
      proxyRes.on('end', async () => {
        const responseBody = Buffer.concat(responseChunks).toString('utf8');
        const responseHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val) responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
        }

        // Remove transfer-encoding since we buffer the whole body
        delete responseHeaders['transfer-encoding'];

        clientRes.writeHead(proxyRes.statusCode || 200, responseHeaders);
        clientRes.end(responseBody);

        const durationMs = Date.now() - startTime;
        // Compute timing metrics relative to request start
        const connectMs = socketConnectedAt != null ? socketConnectedAt - requestStartTime : undefined;
        const ttfbMs = firstByteAt != null ? firstByteAt - requestStartTime : undefined;

        const logId = await saveRequestLog({
          userId,
          sessionId,
          method: clientReq.method || 'GET',
          url: targetUrl.toString(),
          requestHeaders,
          requestBody,
          responseStatus: proxyRes.statusCode || 200,
          responseHeaders,
          responseBody,
          durationMs,
          isMocked: false,
          mockId: null,
          connectMs,
          ttfbMs,
        });

        {
          const db2 = getDb();
          const log = db2.prepare('SELECT * FROM request_logs WHERE id = ?').get(logId);
          if (userId) {
            // Broadcast to the specific authenticated user
            await wsManager.broadcastToUser(userId, { type: 'new_request', log });
          } else {
            // Anonymous request: broadcast to ALL authenticated dashboard users
            await wsManager.broadcastToAll({ type: 'new_request', log });
          }
        }
      });
    });

    // Capture TCP connection timestamp via socket 'connect' event
    proxyReq.on('socket', (socket) => {
      socket.on('connect', () => {
        socketConnectedAt = Date.now();
      });
    });

    proxyReq.on('error', async (err) => {
      clientRes.writeHead(502);
      clientRes.end(`Proxy Error: ${err.message}`);

      await saveRequestLog({
        userId,
        sessionId,
        method: clientReq.method || 'GET',
        url: targetUrl.toString(),
        requestHeaders,
        requestBody,
        responseStatus: 502,
        responseHeaders: {},
        responseBody: err.message,
        durationMs: Date.now() - startTime,
        isMocked: false,
        mockId: null,
      });
    });

    if (requestBody) {
      proxyReq.write(requestBody);
    }
    proxyReq.end();
  });

  // Handle CONNECT (for HTTPS tunneling)
  // We log the CONNECT tunnel itself; content is encrypted and cannot be inspected
  proxyServer.on('connect', async (req, clientSocket, head) => {
    const [host, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr) || 443;
    const tunnelUrl = `https://${host}${port !== 443 ? `:${port}` : ''}`;
    const connectStart = Date.now();

    // Identify user from request headers
    let userId: number | null = null;
    let sessionId: string | null = null;
    const sessionHeader = (req.headers['x-proxyflow-session'] as string) || '';
    if (sessionHeader) {
      const db = getDb();
      const session = db.prepare(
        'SELECT user_id FROM device_sessions WHERE session_id = ?'
      ).get(sessionHeader) as { user_id: number } | undefined;
      if (session) {
        userId = session.user_id;
        sessionId = sessionHeader;
      }
    }

    const serverSocket = net.connect(port, host, async () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('close', async () => {
      // Log the CONNECT tunnel as a HTTPS entry (body is encrypted / not available)
      const durationMs = Date.now() - connectStart;
      try {
        const requestHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (v) requestHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        const logId = await saveRequestLog({
          userId,
          sessionId,
          method: 'CONNECT',
          url: tunnelUrl,
          requestHeaders,
          requestBody: null,
          responseStatus: 200,
          responseHeaders: {},
          responseBody: '[HTTPS tunnel — content encrypted]',
          durationMs,
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
      } catch {
        // Non-critical: logging failure should not crash the proxy
      }
    });

    serverSocket.on('error', () => {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  });

  return proxyServer;
}
