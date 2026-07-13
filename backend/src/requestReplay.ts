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
