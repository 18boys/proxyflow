#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const PROXYFLOW_URL = process.env.PROXYFLOW_URL;
const PROXYFLOW_TOKEN = process.env.PROXYFLOW_TOKEN;

if (!PROXYFLOW_URL || !PROXYFLOW_TOKEN) {
  console.error(
    '[proxyflow-mcp] Missing required environment variables.\n' +
    '  PROXYFLOW_URL   — proxyflow backend URL, e.g. http://localhost:9000\n' +
    '  PROXYFLOW_TOKEN — API token generated from Settings → API Tokens (starts with "pf_")',
  );
  process.exit(1);
}

const baseUrl = PROXYFLOW_URL.replace(/\/+$/, '');

async function call(path: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXYFLOW_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { ok: res.ok, status: res.status, body };
}

function toResult(result: { ok: boolean; status: number; body: unknown }) {
  const text = JSON.stringify(result.body, null, 2);
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text' as const, text: `HTTP ${result.status}: ${text}` }] };
  }
  return { content: [{ type: 'text' as const, text }] };
}

const server = new McpServer({ name: 'proxyflow-mcp', version: '1.0.0' });

const responseHeadersSchema = z.record(z.string()).optional()
  .describe('Response headers, e.g. {"Content-Type": "application/json"}');
const responseBodySchema = z.union([z.string(), z.record(z.any()), z.array(z.any())]).optional()
  .describe('Response body — a JSON string or a JSON value');

server.tool(
  'upsert_mock',
  'Create or update a mock for an API endpoint, matched by URL pathname (+ optional method). ' +
  'If a mock already exists for the same pathname/method, adds a new version and makes it active instead of creating a duplicate rule. ' +
  'Use this right after creating a new backend endpoint during development so the frontend/mobile client can call it against a mock immediately.',
  {
    url_pattern: z.string().describe('Full URL or path of the endpoint, e.g. "/api/users/123" or "https://api.example.com/users/123". Only the pathname is used for matching.'),
    method: z.string().optional().describe('HTTP method, e.g. "GET", "POST". Omit to match any method.'),
    response_status: z.number().int().optional().describe('HTTP status code to return. Defaults to 200.'),
    response_body: responseBodySchema,
    response_headers: responseHeadersSchema,
    match_type: z.enum(['exact', 'wildcard']).optional().describe('Defaults to "wildcard".'),
    name: z.string().optional().describe('Human-readable name for the mock rule/version.'),
    delay_ms: z.number().int().min(0).max(60000).optional().describe('Artificial response delay in milliseconds.'),
    enabled: z.boolean().optional().describe('Whether the mock should be active. Defaults to true.'),
  },
  async (args) => toResult(await call('/api/mocks/upsert', { method: 'POST', body: JSON.stringify(args) })),
);

server.tool(
  'toggle_mock',
  'Enable or disable an existing mock, matched by URL pathname (+ optional method). ' +
  'Returns a 404-style error if no mock exists yet for that pathname/method — call upsert_mock first in that case.',
  {
    url_pattern: z.string().describe('Full URL or path of the endpoint. Only the pathname is used for matching.'),
    method: z.string().optional().describe('HTTP method. Omit to match the rule with no method restriction.'),
    enabled: z.boolean().describe('true to enable the mock, false to disable it (fall through to the real backend/proxy).'),
  },
  async (args) => toResult(await call('/api/rules/toggle-by-pattern', { method: 'PATCH', body: JSON.stringify(args) })),
);

server.tool(
  'list_mocks',
  'List all mock rules for the current user, including their versions and which version is active.',
  {
    search: z.string().optional().describe('Filter by rule name or URL pattern substring.'),
  },
  async ({ search }) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return toResult(await call(`/api/mocks${qs}`, { method: 'GET' }));
  },
);

server.tool(
  'wait_for_request',
  'Block until the next real HTTP request matching a URL pathname (+ optional method) passes through the proxy, then return its captured request/response. ' +
  'Useful for discovering the real shape of a new endpoint before writing its mock — disable/skip the mock first, trigger the call from the client, and use this tool to capture what actually happened.',
  {
    url_pattern: z.string().describe('Full URL or path of the endpoint. Only the pathname is used for matching.'),
    method: z.string().optional().describe('HTTP method to filter on. Omit to match any method.'),
    timeout_ms: z.number().int().min(1000).max(60000).optional().describe('Max time to wait, in milliseconds. Defaults to 30000, clamped to [1000, 60000].'),
  },
  async ({ url_pattern, method, timeout_ms }) => {
    const params = new URLSearchParams({ url_pattern });
    if (method) params.set('method', method);
    if (timeout_ms) params.set('timeout_ms', String(timeout_ms));
    return toResult(await call(`/api/requests/wait?${params.toString()}`, { method: 'GET' }));
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[proxyflow-mcp] connected — backend ${baseUrl}`);
}

main().catch((err) => {
  console.error('[proxyflow-mcp] fatal error', err);
  process.exit(1);
});
