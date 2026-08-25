import http from 'http';
import https from 'https';
import { URL } from 'url';

const OMITTED_REPLAY_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
]);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCurl(log: Record<string, unknown>): string {
  let headers: Record<string, unknown> = {};
  try {
    const rawHeaders = log['request_headers'];
    headers = typeof rawHeaders === 'string'
      ? JSON.parse(rawHeaders || '{}') as Record<string, unknown>
      : (rawHeaders as Record<string, unknown> | null) || {};
  } catch {
    headers = {};
  }

  const parts = [
    `curl -X ${String(log['method'] || 'GET').toUpperCase()} ${shellQuote(String(log['url'] || ''))}`,
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (!OMITTED_REPLAY_HEADERS.has(key.toLowerCase())) {
      parts.push(`  -H ${shellQuote(`${key}: ${String(value)}`)}`);
    }
  }

  if (log['request_body'] !== null && log['request_body'] !== undefined && log['request_body'] !== '') {
    parts.push(`  --data-raw ${shellQuote(String(log['request_body']))}`);
  }

  return parts.join(' \\\n');
}

export async function executeReplayRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | null
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}> {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const forwardHeaders: Record<string, string> = { ...headers, host: parsedUrl.host };
  delete forwardHeaders['connection'];
  delete forwardHeaders['transfer-encoding'];
  delete forwardHeaders['content-length'];

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method.toUpperCase(),
        headers: forwardHeaders,
        timeout: 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const durationMs = Date.now() - startTime;
          const resBody = Buffer.concat(chunks).toString('utf8');
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) resHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          resolve({
            statusCode: res.statusCode || 200,
            headers: resHeaders,
            body: resBody,
            durationMs,
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout (30s)'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
