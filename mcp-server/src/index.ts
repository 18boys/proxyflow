#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  clearSavedCredential,
  getCredentialsPath,
  McpAuthManager,
  type EnsureAuthResult,
} from './auth.js';
import { DEFAULT_MAX_BODY_CHARS, condenseRule, detailLog, summariseLog } from './format.js';

const PROXYFLOW_URL = process.env.PROXYFLOW_URL;
const PROXYFLOW_TOKEN = process.env.PROXYFLOW_TOKEN;
const PROXYFLOW_WEB_URL = process.env.PROXYFLOW_WEB_URL;
const DEFAULT_AUTH_WAIT_MS = (() => {
  const raw = process.env.PROXYFLOW_AUTH_WAIT_MS;
  if (raw === undefined || raw === '') return 45_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 45_000;
})();

if (!PROXYFLOW_URL) {
  console.error(
    '[proxyflow-mcp] Missing required environment variable.\n' +
    '  PROXYFLOW_URL   — proxyflow server URL, e.g. https://proxyflow.example.com or http://localhost:3100\n' +
    '  PROXYFLOW_TOKEN — (optional) API token; if omitted, browser authorization triggers automatically on first use.',
  );
  process.exit(1);
}

const baseUrl = PROXYFLOW_URL.replace(/\/+$/, '');
const webBaseUrl = PROXYFLOW_WEB_URL ? PROXYFLOW_WEB_URL.replace(/\/+$/, '') : '';
const authManager = new McpAuthManager({
  baseUrl,
  webBaseUrl,
  envToken: PROXYFLOW_TOKEN,
});

function buildShareUrl(shareToken: string, backendShareUrl?: unknown): string {
  if (webBaseUrl) return `${webBaseUrl}/share/${shareToken}`;
  if (typeof backendShareUrl === 'string' && /^https?:\/\//i.test(backendShareUrl)) {
    return backendShareUrl;
  }
  return `${baseUrl}/share/${shareToken}`;
}

function extractShareToken(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/share\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : trimmed;
}

const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

// ── HTTP plumbing ─────────────────────────────────────────────────────────

interface ApiResult {
  ok: boolean;
  status: number;
  body: unknown;
  authPrompt?: Extract<EnsureAuthResult, { ok: false }>;
}

async function rawFetch(pathname: string, token: string, init: RequestInit, timeoutMs = 15_000): Promise<ApiResult> {
  try {
    const res = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    const raw = await res.text();
    let body: unknown = raw;
    try { body = JSON.parse(raw); } catch { /* non-JSON body, keep text */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason = e.name === 'TimeoutError'
      ? `no response within ${Math.round(timeoutMs / 1000)}s`
      : (e.cause?.code || e.message);
    return {
      ok: false,
      status: 0,
      body: { error: `Cannot reach proxyflow backend at ${baseUrl} (${reason}). Check that the backend is running and PROXYFLOW_URL is correct.` },
    };
  }
}

async function call(pathname: string, init: RequestInit, timeoutMs = 15_000): Promise<ApiResult> {
  const authRes = await authManager.ensureAuthorized({
    waitMs: DEFAULT_AUTH_WAIT_MS,
    openBrowser: true,
  });

  if (!authRes.ok) {
    return {
      ok: false,
      status: authRes.status === 'unreachable' ? 0 : 401,
      body: {
        auth_required: true,
        status: authRes.status,
        ...(authRes.auth_url ? { auth_url: authRes.auth_url } : {}),
        ...(authRes.user_code ? { user_code: authRes.user_code } : {}),
        ...(authRes.request_id ? { request_id: authRes.request_id } : {}),
        ...(authRes.expires_at ? { expires_at: authRes.expires_at } : {}),
        ...(authRes.browser_opened !== undefined ? { browser_opened: authRes.browser_opened } : {}),
        message: authRes.message,
      },
      authPrompt: authRes,
    };
  }

  const result = await rawFetch(pathname, authRes.token, init, timeoutMs);

  // If a locally cached (auto-generated) token was revoked, clear it and re-trigger browser auth once.
  if (result.status === 401 && authRes.source === 'credentials') {
    clearSavedCredential(baseUrl);
    const reauth = await authManager.ensureAuthorized({
      force: true,
      waitMs: DEFAULT_AUTH_WAIT_MS,
      openBrowser: true,
    });
    if (reauth.ok) {
      return rawFetch(pathname, reauth.token, init, timeoutMs);
    }
    return {
      ok: false,
      status: reauth.status === 'unreachable' ? 0 : 401,
      body: {
        auth_required: true,
        status: reauth.status,
        ...(reauth.auth_url ? { auth_url: reauth.auth_url } : {}),
        ...(reauth.user_code ? { user_code: reauth.user_code } : {}),
        ...(reauth.request_id ? { request_id: reauth.request_id } : {}),
        ...(reauth.expires_at ? { expires_at: reauth.expires_at } : {}),
        ...(reauth.browser_opened !== undefined ? { browser_opened: reauth.browser_opened } : {}),
        message: `之前保存的凭证已失效，已重新发起授权。${reauth.message}`,
      },
      authPrompt: reauth,
    };
  }

  return result;
}

type Content = { content: { type: 'text'; text: string }[]; isError?: true };

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fail(result: ApiResult): Content {
  if (result.authPrompt) {
    return { isError: true, content: [{ type: 'text', text: text(result.body) }] };
  }
  const detail = text(result.body);
  let hint = '';
  if (result.status === 401) {
    hint = authManager.hasEnvToken()
      ? '\nHint: PROXYFLOW_TOKEN was rejected — it may be revoked or mistyped. Generate a new one in the proxyflow console (Settings → API Tokens), or remove PROXYFLOW_TOKEN from MCP config to use automatic browser authorization.'
      : '\nHint: Call the `authorize` tool to sign in via browser and automatically generate a new token.';
  }
  return { isError: true, content: [{ type: 'text', text: (result.status ? `HTTP ${result.status}: ` : '') + detail + hint }] };
}

/** Send `result` back to the model, optionally reshaping a successful body. */
function respond(result: ApiResult, shape?: (body: any) => unknown): Content {
  if (!result.ok) return fail(result);
  return { content: [{ type: 'text', text: text(shape ? shape(result.body) : result.body) }] };
}

// ── Server & tools ────────────────────────────────────────────────────────

const server = new McpServer(
  { name: 'proxyflow-mcp', version: VERSION },
  {
    instructions:
      'proxyflow mocks HTTP APIs for a mobile/mini-program/web client. Auth is automatic: if no PROXYFLOW_TOKEN is set, the first tool call ' +
      '(or calling `authorize`) opens the browser for one-click approval and persists the token locally. ' +
      'To wire a client project / SDK / .env.local / debug backdoor to proxyflow, call `get_or_create_session` (or `list_sessions`) to automatically obtain ' +
      'or create a `session_id` and server URLs. Typical API development loop: ' +
      '(1) upsert_mock to serve a fake response immediately; (2) once the real backend exists, toggle_mock enabled=false, ' +
      'ask the user to trigger the call in the app, then wait_for_request (or list_recent_requests if it already fired) to see the real shape; ' +
      '(3) upsert_mock with from_request_id to save the exact real response, or adjust the mock; (4) share_request to archive a verified real request ' +
      'as a permanent share link (survives log cleanup; retrieve later with list_shared_requests / get_shared_request); (5) switch_mock_version to flip between ' +
      'scenarios (success / empty / error) and delete_mock to clean up. Only requests routed through a paired proxyflow device/session are mocked or captured.',
  },
);

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const urlPatternField = z.string().min(1).describe(
  'Full URL or path of the endpoint, e.g. "/api/users/123" or "https://api.example.com/users/123". ' +
  'Only the pathname is used (host and query string are ignored). Use "*" as a wildcard and ":id" or "{id}" for path parameters, e.g. "/api/users/:id".',
);
const methodField = z.string().optional().describe('HTTP method, e.g. "GET", "POST" (case-insensitive). Omit to not restrict by method.');
const conditionField = z.object({
  type: z.enum(['header', 'query', 'body']),
  key: z.string().min(1),
  value: z.string().min(1),
}).optional().describe('Only serve/match this mock when the request has header/query param/JSON body field `key` equal to `value`.');
const maxBodyField = z.number().int().min(200).max(100000).optional()
  .describe(`Max characters of each body to return (default ${DEFAULT_MAX_BODY_CHARS}). Larger bodies are truncated.`);

server.registerTool(
  'upsert_mock',
  {
    title: 'Create or update a mock',
    description:
      'Create or update a mock for an API endpoint, matched by URL pathname (+ optional method). ' +
      'Idempotent: an existing rule for the same pathname/method/condition is updated in place, and a new response is stored as a new version and activated ' +
      '(an identical response reuses the existing version, so repeated calls never pile up duplicates). ' +
      'Use it right after designing/creating an endpoint so the client can call it against a mock immediately, or with from_request_id to freeze a real captured response as the mock.',
    inputSchema: {
      url_pattern: urlPatternField,
      method: methodField,
      response_status: z.number().int().min(100).max(599).optional().describe('HTTP status code to return. Defaults to 200.'),
      response_body: z.union([z.string(), z.record(z.any()), z.array(z.any())]).optional()
        .describe('Response body. An object/array is serialised as JSON; a string is sent verbatim. Defaults to {} (or the captured body when from_request_id is set).'),
      response_headers: z.record(z.string()).optional()
        .describe('Response headers, e.g. {"Content-Type": "application/json"}. Defaults to JSON (text/plain for a non-JSON string body).'),
      match_type: z.enum(['exact', 'wildcard', 'regex']).optional()
        .describe('Defaults to "wildcard" on create; left unchanged on update. Path parameters (":id") force wildcard.'),
      name: z.string().optional().describe('Human-readable name of the rule (defaults to the pathname).'),
      version_name: z.string().optional()
        .describe('Name of this response scenario, e.g. "success", "empty-list", "server-error". Used by switch_mock_version. Defaults to name or the status code.'),
      delay_ms: z.number().int().min(0).max(60000).optional().describe('Artificial response delay in milliseconds (kept as-is on update when omitted).'),
      enabled: z.boolean().optional().describe('Whether the mock is active. Defaults to true on create; unchanged on update when omitted.'),
      activate: z.boolean().optional()
        .describe('Set false to store this response as an alternate version WITHOUT making it the active one. Defaults to true.'),
      condition: conditionField,
      from_request_id: z.number().int().optional()
        .describe('Copy status, headers and body from a captured request (request log id from wait_for_request / list_recent_requests). Explicit response_* fields still override.'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async (args) => respond(
    await call('/api/mocks/upsert', { method: 'POST', body: JSON.stringify(args) }),
    (b) => ({
      ...condenseRule(b),
      created: b.created,
      saved_version_id: b.saved_version_id,
      version_reused: b.version_reused,
      tip: b.is_active
        ? 'Live: requests through a paired proxyflow device matching this rule now receive the active version.'
        : 'Rule is DISABLED — requests go to the real backend until toggle_mock enabled=true.',
    }),
  ),
);

server.registerTool(
  'toggle_mock',
  {
    title: 'Enable or disable a mock',
    description:
      'Enable or disable existing mock(s), matched by URL pathname (+ optional method). ' +
      'Without `method`, every rule for that pathname is toggled; with it, only that method\'s rule. ' +
      'Returns an error if nothing matches — call upsert_mock first in that case. ' +
      'Disable a mock (enabled=false) so the next call falls through to the real backend.',
    inputSchema: {
      url_pattern: urlPatternField,
      method: methodField,
      enabled: z.boolean().describe('true to enable the mock, false to disable it (fall through to the real backend).'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async (args) => respond(await call('/api/rules/toggle-by-pattern', { method: 'PATCH', body: JSON.stringify(args) })),
);

server.registerTool(
  'list_mocks',
  {
    title: 'List mocks',
    description:
      'List the current user\'s mock rules with their versions and which one is active. ' +
      'Compact by default; set include_body to also see each active response body.',
    inputSchema: {
      search: z.string().optional().describe('Filter by rule name or URL pattern substring.'),
      include_body: z.boolean().optional().describe('Include the active version\'s response body (truncated). Default false.'),
      max_body_chars: maxBodyField,
    },
    annotations: READ_ONLY,
  },
  async ({ search, include_body, max_body_chars }) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return respond(await call(`/api/mocks${qs}`, { method: 'GET' }), (rules: any[]) => ({
      count: rules.length,
      mocks: rules.map((r) => condenseRule(r, { includeBody: include_body, maxBodyChars: max_body_chars })),
    }));
  },
);

server.registerTool(
  'wait_for_request',
  {
    title: 'Wait for a real request',
    description:
      'Block until a request matching a URL pathname (+ optional method) passes through proxyflow, then return its captured request and response ' +
      '(sensitive headers such as Authorization/Cookie are redacted; large bodies are truncated). ' +
      'Use it to discover the real shape of an endpoint: disable the mock first (toggle_mock enabled=false), ask the user to trigger the call in the app, then call this. ' +
      'If the request may already have fired, set lookback_ms to include recent history. Check `source`: MOCK means the answer came from a mock, not the real backend.',
    inputSchema: {
      url_pattern: urlPatternField,
      method: z.string().optional().describe('HTTP method to filter on. Omit to match any method.'),
      timeout_ms: z.number().int().min(1000).max(60000).optional().describe('Max time to wait, in milliseconds. Defaults to 30000.'),
      lookback_ms: z.number().int().min(0).max(300000).optional()
        .describe('Also accept a matching request captured up to this many ms ago (returns the most recent). Default 0 = only future requests.'),
      only_real: z.boolean().optional().describe('Ignore requests that were answered by a mock. Default false.'),
      max_body_chars: maxBodyField,
    },
    annotations: READ_ONLY,
  },
  async ({ url_pattern, method, timeout_ms, lookback_ms, only_real, max_body_chars }) => {
    const params = new URLSearchParams({ url_pattern });
    if (method) params.set('method', method);
    if (timeout_ms) params.set('timeout_ms', String(timeout_ms));
    if (lookback_ms) params.set('lookback_ms', String(lookback_ms));
    if (only_real) params.set('only_real', 'true');
    const result = await call(`/api/requests/wait?${params}`, { method: 'GET' }, (timeout_ms ?? 30_000) + 10_000);
    return respond(result, (b) => b.matched
      ? { matched: true, waited_ms: b.waited_ms, ...detailLog(b.request, max_body_chars ?? DEFAULT_MAX_BODY_CHARS) }
      : {
          matched: false,
          waited_ms: b.waited_ms,
          hint: 'No matching request arrived. Make sure the client is paired to proxyflow (Devices page) and actually sends this call; ' +
                'try lookback_ms if it already fired, or list_recent_requests to see what did pass through.',
        });
  },
);

server.registerTool(
  'list_recent_requests',
  {
    title: 'List recent captured requests',
    description:
      'List the most recent requests captured by proxyflow (newest first) as compact summaries: id, time, method, url, status and whether it was MOCK or REAL. ' +
      'Each row\'s `id` is a REQUEST LOG id — pass it to get_request / upsert_mock from_request_id. It is NOT a mock rule_id or version id (those come from list_mocks). ' +
      'MOCK rows also carry `mock_id` (the rule that answered). ' +
      'Use it to see what the client actually called or to find failing calls (status="4xx"/"5xx"), then get_request for full details.',
    inputSchema: {
      url_contains: z.string().optional().describe('Substring the URL must contain, e.g. "/api/orders".'),
      method: z.string().optional().describe('HTTP method filter.'),
      status: z.string().optional().describe('Exact status ("404") or a class ("4xx", "5xx").'),
      only_real: z.boolean().optional().describe('Exclude requests answered by a mock.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max rows to return. Default 10.'),
    },
    annotations: READ_ONLY,
  },
  async ({ url_contains, method, status, only_real, limit }) => {
    const want = limit ?? 10;
    const params = new URLSearchParams({ limit: String(only_real ? Math.min(want * 4, 200) : want) });
    if (url_contains) params.set('url', url_contains);
    if (method) params.set('method', method);
    if (status) params.set('status', status);
    return respond(await call(`/api/requests?${params}`, { method: 'GET' }), (b) => {
      const logs = (b.logs as any[]).filter((l) => l.method !== 'CONNECT' && (!only_real || !l.is_mocked)).slice(0, want);
      return { returned: logs.length, requests: logs.map(summariseLog) };
    });
  },
);

server.registerTool(
  'get_request',
  {
    title: 'Get one captured request',
    description:
      'Full details of one captured request by its request log id (the `id` field from list_recent_requests or wait_for_request): request/response headers (sensitive ones redacted) and bodies (truncated if large). ' +
      'Do NOT pass a mock rule_id or version id from list_mocks — those are different ids and will 404 or return an unrelated request.',
    inputSchema: {
      id: z.number().int().describe('Request log id — the `id` from list_recent_requests / wait_for_request (NOT a mock rule_id or version id from list_mocks).'),
      max_body_chars: maxBodyField,
    },
    annotations: READ_ONLY,
  },
  async ({ id, max_body_chars }) => respond(
    await call(`/api/requests/${id}`, { method: 'GET' }),
    (log) => detailLog(log, max_body_chars ?? DEFAULT_MAX_BODY_CHARS),
  ),
);

server.registerTool(
  'switch_mock_version',
  {
    title: 'Switch the active mock version',
    description:
      'Make a different stored response ("version"/scenario) the active one for a mock — e.g. flip between success, empty list and server error to test client handling. ' +
      'Identify the version by version_name (as set via upsert_mock version_name) or version_id (from list_mocks). Errors list the available versions.',
    inputSchema: {
      url_pattern: urlPatternField,
      method: methodField,
      version_name: z.string().optional().describe('Name of the version to activate (the newest one with that name wins).'),
      version_id: z.number().int().optional().describe('Id of the version to activate.'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async (args) => respond(
    await call('/api/mocks/switch-version', { method: 'POST', body: JSON.stringify(args) }),
    (b) => ({ ...condenseRule(b), switched_to: b.switched_to }),
  ),
);

server.registerTool(
  'delete_mock',
  {
    title: 'Delete a mock rule or version',
    description:
      'Permanently delete a mock rule (or a single stored version if version_id/version_name is given). ' +
      'Target by rule_id (from list_mocks / upsert_mock) OR by url_pattern (+ optional method, condition, match_type). ' +
      'Deletion is strict and guarded: an omitted method means the rule with no method restriction, not every method; ' +
      'if multiple rules match (e.g. different conditions or match_types), it returns a 409 conflict listing candidates instead of wiping them all unless delete_all=true. ' +
      'To merely stop mocking, use toggle_mock enabled=false instead.',
    inputSchema: {
      rule_id: z.number().int().positive().optional()
        .describe('Exact mock rule_id (from list_mocks or upsert_mock). Preferred when multiple rules share a path.'),
      url_pattern: urlPatternField.optional(),
      method: methodField,
      condition: conditionField,
      match_type: z.enum(['exact', 'wildcard', 'regex']).optional()
        .describe('Filter by match_type when multiple rules share the same url_pattern.'),
      version_name: z.string().min(1).optional()
        .describe('Delete ONLY this stored version/scenario from the matched rule instead of deleting the entire rule.'),
      version_id: z.number().int().positive().optional()
        .describe('Delete ONLY this version id from the matched rule instead of deleting the entire rule.'),
      delete_all: z.boolean().optional()
        .describe('Set true to delete ALL matching rules when multiple rules match url_pattern (+ method). Defaults to false (returns 409 conflict instead).'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (args) => {
    if (args.rule_id === undefined && !args.url_pattern) {
      return { isError: true, content: [{ type: 'text', text: 'Provide either rule_id or url_pattern.' }] };
    }
    return respond(
      await call('/api/mocks/delete-by-pattern', { method: 'POST', body: JSON.stringify(args) }),
      (b) => (b?.deleted_version ? { ...condenseRule(b), deleted_version: b.deleted_version } : b),
    );
  },
);

server.registerTool(
  'share_request',
  {
    title: 'Archive a request as a permanent share link',
    description:
      'Create (or update) a permanent, read-only share link snapshot for a captured request log id (from wait_for_request or list_recent_requests). ' +
      'Snapshots are persisted in a permanent archive table and survive the 7-day / 1000-row request log cleanup, making them ideal for archiving real backend ' +
      'request/response examples agreed during integration. Sensitive auth headers (Authorization, Cookie, tokens, secrets) are redacted by default.',
    inputSchema: {
      request_id: z.number().int().positive().describe('Request log id (from wait_for_request / list_recent_requests).'),
      title: z.string().max(160).optional().describe('Optional short title describing the archived requirement or API scenario.'),
      note: z.string().max(2000).optional().describe('Optional notes (e.g., requirement context, backend field agreements).'),
      redact_sensitive: z.boolean().optional()
        .describe('Redact sensitive request/response headers (Authorization, Cookie, tokens) before storing the permanent public snapshot. Defaults to true.'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async ({ request_id, title, note, redact_sensitive }) => {
    const payload: Record<string, unknown> = {
      redact_sensitive: redact_sensitive ?? true,
    };
    if (title !== undefined) payload['title'] = title;
    if (note !== undefined) payload['note'] = note;

    return respond(
      await call(`/api/requests/${request_id}/share`, { method: 'POST', body: JSON.stringify(payload) }),
      (b) => ({
        share_token: b.share_token,
        share_url: buildShareUrl(b.share_token, b.share_url),
        share_path: b.share_path || `/share/${b.share_token}`,
        title: b.title ?? null,
        note: b.note ?? null,
        redacted: Boolean(b.redacted),
        created: Boolean(b.created),
        created_at: b.created_at,
        tip: 'Permanent snapshot saved: this link remains valid even after captured request logs are cleared or rotated. Anyone with the link can inspect it or convert it into a mock.',
      }),
    );
  },
);

server.registerTool(
  'list_shared_requests',
  {
    title: 'List permanently archived share links',
    description:
      'List your permanently archived request share links (newest first), optionally filtered by keyword matching title, note, URL, or method. ' +
      'Use get_shared_request with a returned share_token to inspect the full archived request and response.',
    inputSchema: {
      search: z.string().optional().describe('Filter by title, note, URL, or HTTP method substring.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max archived entries to return. Default 20.'),
    },
    annotations: READ_ONLY,
  },
  async ({ search, limit }) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';

    return respond(
      await call(`/api/shared/mine/list${qs}`, { method: 'GET' }),
      (b) => ({
        count: b.count ?? (Array.isArray(b.items) ? b.items.length : 0),
        shared_requests: (Array.isArray(b.items) ? b.items : []).map((item: any) => ({
          share_token: item.share_token,
          share_url: buildShareUrl(item.share_token),
          title: item.title ?? null,
          note: item.note ?? null,
          method: item.method,
          url: item.url,
          status: item.response_status,
          source: item.is_mocked ? 'MOCK' : 'REAL',
          redacted: Boolean(item.redacted),
          created_at: item.created_at,
        })),
      }),
    );
  },
);

server.registerTool(
  'get_shared_request',
  {
    title: 'Read a permanently archived shared request',
    description:
      'Fetch the full request/response details of a permanently archived share link by its share_token (or full /share/<token> URL). ' +
      'Sensitive headers are redacted and large bodies are truncated.',
    inputSchema: {
      share_token: z.string().min(1).describe('Share token UUID or full /share/<token> URL.'),
      max_body_chars: maxBodyField,
    },
    annotations: READ_ONLY,
  },
  async ({ share_token, max_body_chars }) => {
    const token = extractShareToken(share_token);
    return respond(
      await call(`/api/shared/${encodeURIComponent(token)}`, { method: 'GET' }),
      (log) => ({
        share_token: log.share_token || token,
        share_url: buildShareUrl(log.share_token || token),
        title: log.title ?? null,
        note: log.note ?? null,
        archived_at: log.archived_at ?? log.created_at,
        ...detailLog(log, max_body_chars ?? DEFAULT_MAX_BODY_CHARS),
      }),
    );
  },
);

server.registerTool(
  'authorize',
  {
    title: 'Authorize or check ProxyFlow MCP login',
    description:
      'Check ProxyFlow authorization status, initiate one-click browser authorization to automatically generate & save an API token locally ' +
      '(no manual PROXYFLOW_TOKEN configuration needed), re-authorize as another account, or log out locally.',
    inputSchema: {
      mode: z.enum(['ensure', 'status', 'reauth', 'logout']).optional()
        .describe('"ensure" (default): verify current token or trigger browser authorization; "status": check current login without opening browser; "reauth": force a fresh browser authorization; "logout": remove saved local token.'),
      wait_seconds: z.number().int().min(0).max(120).optional()
        .describe('Seconds to wait for browser approval when starting authorization (default 45; set 0 to return the auth_url immediately).'),
      open_browser: z.boolean().optional()
        .describe('Attempt to open the authorization URL in the local browser automatically. Defaults to true.'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async ({ mode = 'ensure', wait_seconds, open_browser }) => {
    const credentialsPath = getCredentialsPath();

    if (mode === 'logout') {
      const removed = clearSavedCredential(baseUrl);
      return {
        content: [{
          type: 'text',
          text: text({
            logged_out: true,
            removed_local_credential: removed,
            env_token_still_set: authManager.hasEnvToken(),
            credentials_path: credentialsPath,
          }),
        }],
      };
    }

    if (mode === 'status') {
      const active = authManager.getActiveToken();
      if (!active) {
        return {
          content: [{
            type: 'text',
            text: text({
              authorized: false,
              server_url: baseUrl,
              credentials_path: credentialsPath,
              tip: 'Not authorized yet. Call `authorize` (or any proxyflow tool) to trigger automatic browser authorization.',
            }),
          }],
        };
      }
      const me = await rawFetch('/api/auth/me', active.token, { method: 'GET' }, 8_000);
      if (me.ok) {
        return {
          content: [{
            type: 'text',
            text: text({
              authorized: true,
              source: active.source,
              user: me.body,
              token_prefix: active.saved?.token_prefix || active.token.slice(0, 12),
              server_url: baseUrl,
              credentials_path: credentialsPath,
            }),
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: text({
            authorized: false,
            source: active.source,
            status: me.status,
            error: me.body,
            tip: 'Current token is invalid or revoked. Call `authorize` with mode="reauth" to generate a new token via browser.',
          }),
        }],
      };
    }

    if (mode === 'reauth') {
      clearSavedCredential(baseUrl);
    }

    const waitMs = wait_seconds !== undefined ? wait_seconds * 1000 : DEFAULT_AUTH_WAIT_MS;
    const authRes = await authManager.ensureAuthorized({
      force: mode === 'reauth',
      waitMs,
      openBrowser: open_browser !== false,
    });

    if (!authRes.ok) {
      return {
        content: [{
          type: 'text',
          text: text({
            authorized: false,
            status: authRes.status,
            ...(authRes.auth_url ? { auth_url: authRes.auth_url } : {}),
            ...(authRes.user_code ? { user_code: authRes.user_code } : {}),
            ...(authRes.request_id ? { request_id: authRes.request_id } : {}),
            ...(authRes.expires_at ? { expires_at: authRes.expires_at } : {}),
            ...(authRes.browser_opened !== undefined ? { browser_opened: authRes.browser_opened } : {}),
            message: authRes.message,
          }),
        }],
      };
    }

    const me = await rawFetch('/api/auth/me', authRes.token, { method: 'GET' }, 8_000);
    if (!me.ok && authRes.source === 'credentials') {
      clearSavedCredential(baseUrl);
      const retry = await authManager.ensureAuthorized({
        force: true,
        waitMs,
        openBrowser: open_browser !== false,
      });
      if (!retry.ok) {
        return { content: [{ type: 'text', text: text({ authorized: false, ...retry }) }] };
      }
      const me2 = await rawFetch('/api/auth/me', retry.token, { method: 'GET' }, 8_000);
      return {
        content: [{
          type: 'text',
          text: text({
            authorized: me2.ok,
            source: retry.source,
            user: me2.ok ? me2.body : { email: retry.email },
            token_prefix: retry.token_prefix,
            default_session: retry.default_session ?? null,
            credentials_path: retry.credentials_path,
          }),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: text({
          authorized: me.ok,
          source: authRes.source,
          just_authorized: Boolean(authRes.just_authorized),
          user: me.ok ? me.body : { email: authRes.email },
          token_prefix: authRes.token_prefix || authRes.token.slice(0, 12),
          ...(authRes.default_session !== undefined ? { default_session: authRes.default_session } : {}),
          credentials_path: authRes.credentials_path,
          tip: 'Authorized! Call `get_or_create_session` if you also need a session_id to configure your project SDK or debug backdoor.',
        }),
      }],
    };
  },
);

server.registerTool(
  'list_sessions',
  {
    title: 'List paired device sessions',
    description:
      'List all ProxyFlow device sessions for the current user (with session_id, name, online status, and last_seen). ' +
      'Use `get_or_create_session` to automatically obtain or create a session_id ready to configure in a project or debug backdoor.',
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => respond(await call('/api/devices', { method: 'GET' }), (devices: any[]) => ({
    count: Array.isArray(devices) ? devices.length : 0,
    server_url: baseUrl,
    relay_url: `${baseUrl}/api/relay`,
    sessions: (Array.isArray(devices) ? devices : []).map((d) => ({
      session_id: d.session_id,
      name: d.name,
      is_online: Boolean(d.is_online),
      last_seen: d.last_seen ?? null,
      created_at: d.created_at,
    })),
  })),
);

server.registerTool(
  'get_or_create_session',
  {
    title: 'Get or create a device session ID',
    description:
      'Retrieve an existing ProxyFlow device session_id or automatically create a new one, returning the session_id together with ready-to-use ' +
      'server_url, relay_url, ws_url, and .env.local snippet so an agent can automatically inject it into a project SDK, dev server proxy, or debug backdoor. ' +
      'Idempotent by default: if `name` is provided, reuses an existing session with that name (or creates one); if omitted, reuses the most recently active session (or creates one if none exist).',
    inputSchema: {
      name: z.string().max(80).optional()
        .describe('Optional device or project name (e.g. "web-admin", "ios-dev"). Reuses an existing session with the same name if present, otherwise creates one.'),
      create_new: z.boolean().optional()
        .describe('Set true to always create a brand-new device session instead of reusing an existing one. Defaults to false.'),
    },
    annotations: WRITE_IDEMPOTENT,
  },
  async ({ name, create_new }) => {
    const effectiveName = name?.trim() || (create_new ? `${os.hostname() || 'MCP'} Device` : undefined);
    return respond(
      await call('/api/devices/ensure', {
        method: 'POST',
        body: JSON.stringify({
          ...(effectiveName ? { name: effectiveName } : {}),
          create_new: Boolean(create_new),
        }),
      }),
      (b) => {
        const serverUrl = baseUrl;
        const relayUrl = `${serverUrl}/api/relay`;
        const wsBase = serverUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
        const wsUrl = `${wsBase}/ws/device?token=${b.pairing_token}`;
        return {
          session_id: b.session_id,
          name: b.name,
          created: Boolean(b.created),
          is_online: Boolean(b.is_online),
          last_seen: b.last_seen ?? null,
          pairing_token: b.pairing_token,
          server_url: serverUrl,
          relay_url: relayUrl,
          ws_url: wsUrl,
          env_snippet: `PROXYFLOW_URL=${serverUrl}\nPROXYFLOW_SESSION_ID=${b.session_id}`,
          tip: 'Inject `session_id` (and `server_url`) into your SDK init, `.env.local`, or app debug backdoor so requests route to your ProxyFlow account.',
        };
      },
    );
  },
);

// ── Startup ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[proxyflow-mcp] v${VERSION} connected — server ${baseUrl}`);

  // Non-fatal preflight so misconfiguration shows up in the client's MCP logs right away.
  const active = authManager.getActiveToken();
  if (!active) {
    console.error(`[proxyflow-mcp] no token yet — will automatically open browser authorization on first tool call (credentials file: ${getCredentialsPath()})`);
    return;
  }
  const me = await rawFetch('/api/auth/me', active.token, { method: 'GET' }, 5_000);
  if (me.ok) {
    const email = (me.body as { email?: string })?.email;
    console.error(`[proxyflow-mcp] token OK (${active.source}${email ? `, ${email}` : ''})`);
  } else if (me.status === 401) {
    if (active.source === 'credentials') {
      console.error('[proxyflow-mcp] saved token expired/revoked — will automatically re-authorize on next tool call.');
    } else {
      console.error('[proxyflow-mcp] WARNING: PROXYFLOW_TOKEN was rejected by the backend (invalid or revoked).');
    }
  } else {
    console.error(`[proxyflow-mcp] WARNING: ${text(me.body)}`);
  }
}

main().catch((err) => {
  console.error('[proxyflow-mcp] fatal error', err);
  process.exit(1);
});
