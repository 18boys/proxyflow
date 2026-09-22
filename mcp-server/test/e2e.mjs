#!/usr/bin/env node
/**
 * End-to-end test for the proxyflow MCP server.
 *
 * Spawns dist/index.js over stdio (exactly like an MCP client) against a running proxyflow backend
 * and exercises every tool, including the failure modes that used to be bugs.
 *
 * ⚠️  It registers a throw-away user and creates mocks — run it against a TEST backend, not your real one:
 *
 *   PORT=19000 PROXY_PORT=19001 bun backend/src/index.ts     # (in a scratch copy / temp DB)
 *   PROXYFLOW_URL=http://localhost:19000 npm run test:e2e
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = (process.env.PROXYFLOW_URL || 'http://localhost:19000').replace(/\/+$/, '');
const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── bootstrap a throw-away user, API token and device session ─────────────
const post = async (p, body, headers = {}) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
})).json();

const email = `e2e-${Date.now()}@example.com`;
const { token: jwt } = await post('/api/auth/register', { email, password: 'e2e-pass-1234' });
const { token: apiToken } = await post('/api/tokens', { name: 'e2e' }, { authorization: `Bearer ${jwt}` });
const { sessionId } = await post('/api/devices/pair', { name: 'e2e-phone' }, { authorization: `Bearer ${jwt}` });

async function connect(env) {
  const c = new Client({ name: 'e2e', version: '1' });
  await c.connect(new StdioClientTransport({ command: 'node', args: [ENTRY], env: { ...process.env, ...env }, stderr: 'pipe' }));
  return c;
}
const client = await connect({ PROXYFLOW_URL: BASE, PROXYFLOW_TOKEN: apiToken });

/** Call an MCP tool; returns {err, data, raw}. */
async function tool(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const raw = r.content?.[0]?.text ?? '';
  let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return { err: !!r.isError, data, raw };
}
/** Simulate the mobile SDK sending a request through proxyflow's relay. */
async function relay(method, url, { headers = {}, body = null } = {}) {
  const r = await fetch(`${BASE}/api/relay`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, url, headers, body, sessionId }),
  });
  const t = await r.text();
  return { status: r.status, text: t, json: (() => { try { return JSON.parse(t); } catch { return undefined; } })() };
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra !== undefined ? '\n     ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 300) : ''}`); }
}
const section = (t) => console.log(`\n${t}`);
const API = 'https://api.example.com';

// ── 1. tool surface ───────────────────────────────────────────────────────
section('1. Tool surface');
const names = (await client.listTools()).tools.map((t) => t.name).sort();
check('exposes 8 tools', names.length === 8, names);
check('has the new tools', ['delete_mock', 'get_request', 'list_recent_requests', 'switch_mock_version'].every((n) => names.includes(n)));

// ── 2. upsert basics ──────────────────────────────────────────────────────
section('2. upsert_mock');
let r = await tool('upsert_mock', { url_pattern: `${API}/api/users/1?x=1`, method: 'get', response_body: { id: 1, name: 'Tom' } });
check('creates a rule', !r.err && r.data.created === true && r.data.method === 'GET' && r.data.url_pattern === '/api/users/1', r.raw);
check('output is condensed (no raw body blobs)', r.raw.length < 700, r.raw.length);
check('relay is answered by the mock', (await relay('GET', `${API}/api/users/1`)).json?.name === 'Tom');

r = await tool('upsert_mock', { url_pattern: '/api/users/1', method: 'GET', response_body: { id: 1, name: 'Tom' } });
check('identical re-upsert reuses the version (no duplicates)', r.data.version_reused === true && r.data.versions.length === 1, r.raw);

r = await tool('upsert_mock', { url_pattern: '/api/users/1', method: 'GET', response_body: { id: 1, name: 'Jerry' }, delay_ms: 150, match_type: 'exact', name: 'User by id', version_name: 'jerry' });
check('update applies delay_ms / match_type / name', r.data.delay_ms === 150 && r.data.match_type === 'exact' && r.data.name === 'User by id', r.raw);
check('changed body becomes a 2nd version and is active', r.data.versions.length === 2 && r.data.active_version.name === 'jerry', r.raw);
let t0 = Date.now(); const delayed = await relay('GET', `${API}/api/users/1`);
check('delay is honoured and new body served', Date.now() - t0 >= 140 && delayed.json?.name === 'Jerry', delayed.text);

r = await tool('upsert_mock', { url_pattern: '/api/users/1', method: 'GET', response_body: { id: 1, name: 'Tom' }, activate: false, version_name: 'tom-alt' });
check('activate:false stores a version without switching', r.data.active_version.name === 'jerry', r.raw);

// Layer 1: the MCP input schema stops it before it ever reaches the backend.
const schemaRejected = await tool('upsert_mock', { url_pattern: '/api/bad', response_status: 99999, response_body: {} })
  .then((x) => x.err && /599/.test(x.raw), (e) => /599/.test(String(e)));
check('MCP schema rejects out-of-range status', schemaRejected);
// Layer 2: the backend enforces it too (any other client of the API). This used to crash the process.
const direct = await fetch(`${BASE}/api/mocks/upsert`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
  body: JSON.stringify({ url_pattern: '/api/bad', response_status: 99999 }),
});
check('backend rejects out-of-range status with 400', direct.status === 400, direct.status);
const delayRejected = await tool('upsert_mock', { url_pattern: '/api/bad', delay_ms: 999999 }).then((x) => x.err, () => true);
check('rejects out-of-range delay_ms instead of silently zeroing', delayRejected);
r = await tool('upsert_mock', { url_pattern: '/api/text', response_body: 'plain text', response_status: 201 });
const text = await relay('GET', `${API}/api/text`);
check('bare string body gets text/plain and custom status', text.status === 201 && text.text === 'plain text', text);

// ── 3. matching semantics ─────────────────────────────────────────────────
section('3. Matching');
await tool('upsert_mock', { url_pattern: '/api/orders/*', response_body: { who: 'wildcard' } });
await tool('upsert_mock', { url_pattern: '/api/orders/42', match_type: 'exact', response_body: { who: 'exact' } });
check('exact rule beats an earlier wildcard rule', (await relay('GET', `${API}/api/orders/42`)).json?.who === 'exact');
check('wildcard still serves other ids', (await relay('GET', `${API}/api/orders/43`)).json?.who === 'wildcard');

r = await tool('upsert_mock', { url_pattern: '/api/items/:id/detail', response_body: { who: 'param' } });
check(':id is stored as a wildcard', r.data.url_pattern === '/api/items/*/detail' && r.data.match_type === 'wildcard', r.raw);
check(':id pattern matches a concrete path', (await relay('GET', `${API}/api/items/7/detail`)).json?.who === 'param');

await tool('upsert_mock', { url_pattern: '/api/search', response_body: { hit: 'default' } });
r = await tool('upsert_mock', { url_pattern: '/api/search', response_body: { hit: 'vip' }, condition: { type: 'query', key: 'tier', value: 'vip' } });
check('condition creates a separate rule', r.data.created === true && r.data.condition?.value === 'vip', r.raw);
check('conditioned rule wins when it matches', (await relay('GET', `${API}/api/search?tier=vip`)).json?.hit === 'vip');
check('falls back to the default rule otherwise', (await relay('GET', `${API}/api/search?tier=free`)).json?.hit === 'default');
r = await tool('upsert_mock', { url_pattern: '/api/search', condition: { type: 'query', key: 'tier', value: 'vip' }, response_body: { hit: 'vip2' } });
check('re-upsert with same condition updates that rule (no dup)', r.data.created === false, r.raw);

// ── 4. toggle ─────────────────────────────────────────────────────────────
section('4. toggle_mock');
r = await tool('toggle_mock', { url_pattern: '/api/users/1', enabled: false });
check('works without method on a GET rule (used to 404)', !r.err && r.data.updated.length === 1, r.raw);
r = await tool('toggle_mock', { url_pattern: '/api/users/1', method: 'POST', enabled: true });
check('wrong method → clear error', r.err && /upsert_mock/.test(r.raw), r.raw);
r = await tool('toggle_mock', { url_pattern: '/api/never-created', enabled: true });
check('unknown pattern → clear error', r.err && /upsert_mock/.test(r.raw), r.raw);
await tool('toggle_mock', { url_pattern: '/api/users/1', method: 'GET', enabled: true });

// ── 5. versions ───────────────────────────────────────────────────────────
section('5. switch_mock_version / list_mocks');
r = await tool('switch_mock_version', { url_pattern: '/api/users/1', method: 'GET', version_name: 'tom-alt' });
check('switches version by name', !r.err && r.data.active_version.name === 'tom-alt', r.raw);
check('and the client now sees it', (await relay('GET', `${API}/api/users/1`)).json?.name === 'Tom');
r = await tool('switch_mock_version', { url_pattern: '/api/users/1', method: 'GET', version_name: 'nope' });
check('unknown version → error listing what exists', r.err && /available_versions/.test(r.raw) && /jerry/.test(r.raw), r.raw);
r = await tool('list_mocks', { search: '/api/users' });
check('list_mocks is compact and flags the active version', r.data.count === 1 && r.data.mocks[0].versions.some((v) => v.active) && !('active_body' in r.data.mocks[0]), r.raw);
r = await tool('list_mocks', { search: '/api/users', include_body: true });
check('include_body adds the active body', r.data.mocks[0].active_body?.name === 'Tom', r.raw);

// ── 6. capture: wait_for_request & friends ────────────────────────────────
section('6. wait_for_request');
await tool('upsert_mock', { url_pattern: '/health', method: 'GET', response_body: { status: 'MOCKED' } });

// 6a. live wait, mock on -> returns, flagged as MOCK, secrets redacted
let waiting = tool('wait_for_request', { url_pattern: '/health', method: 'GET', timeout_ms: 5000 });
await sleep(400);
await relay('GET', `${BASE}/health`, { headers: { authorization: 'Bearer SUPER-SECRET', cookie: 'sid=abc', 'x-trace': 'ok' } });
r = await waiting;
check('live wait returns the request', r.data.matched === true && r.data.method === 'GET', r.raw);
check('flags MOCK source and explains it', r.data.source === 'MOCK' && r.data.notes?.some((n) => /MOCK/.test(n)), r.raw);
check('redacts Authorization / Cookie (no secret reaches the LLM)', !r.raw.includes('SUPER-SECRET') && !r.raw.includes('sid=abc') && r.data.request.headers.authorization === '[REDACTED]', r.raw);
check('keeps harmless headers and parses them into objects', r.data.request.headers['x-trace'] === 'ok');

// 6b. only_real skips mocked, then real capture after disabling the mock
await tool('toggle_mock', { url_pattern: '/health', method: 'GET', enabled: false });
waiting = tool('wait_for_request', { url_pattern: '/health', only_real: true, timeout_ms: 5000 });
await sleep(400);
await tool('toggle_mock', { url_pattern: '/health', method: 'GET', enabled: true });
await relay('GET', `${BASE}/health`);                      // mocked → must be ignored
await sleep(300);
await tool('toggle_mock', { url_pattern: '/health', method: 'GET', enabled: false });
await relay('GET', `${BASE}/health`);                      // real → matches
r = await waiting;
check('only_real ignores mocked hits and returns the real one', r.data.matched && r.data.source === 'REAL' && r.data.response.body?.status === 'ok', r.raw);

// 6c. lookback finds a request that already fired
await relay('POST', `${API}/api/already/fired`, { body: JSON.stringify({ a: 1 }), headers: { 'content-type': 'application/json' } });
r = await tool('wait_for_request', { url_pattern: '/api/already/*', lookback_ms: 60000, timeout_ms: 1500 });
check('lookback_ms catches an already-fired request', r.data.matched === true && r.data.request.body?.a === 1, r.raw);

// 6d. timeout → helpful hint, and it does return promptly
t0 = Date.now();
r = await tool('wait_for_request', { url_pattern: '/api/never', timeout_ms: 1200 });
check('timeout returns matched:false + hint', r.data.matched === false && /paired/.test(r.data.hint), r.raw);
check('timeout is prompt', Date.now() - t0 < 2500, Date.now() - t0);

// 6e. wait accepts :id style patterns
waiting = tool('wait_for_request', { url_pattern: '/api/things/:id', timeout_ms: 4000 });
await sleep(400);
await relay('GET', `${API}/api/things/99`);
r = await waiting;
check('wait_for_request understands :id patterns', r.data.matched === true, r.raw);

// ── 7. big body: truncation + from_request_id ─────────────────────────────
section('7. Large bodies & from_request_id');
const big = JSON.stringify({ items: Array.from({ length: 4000 }, (_, i) => ({ i, v: 'x'.repeat(20) })) });
await tool('upsert_mock', { url_pattern: '/api/big', response_body: big });
await relay('GET', `${API}/api/big`);
r = await tool('wait_for_request', { url_pattern: '/api/big', lookback_ms: 60000, timeout_ms: 1500 });
check('large body is truncated and says so', r.data.response.truncated === true && r.raw.length < 20000, r.raw.length);
const bigId = r.data.id;
check('tells the model to use from_request_id', r.data.notes?.some((n) => /from_request_id/.test(n)), r.raw);
r = await tool('upsert_mock', { url_pattern: '/api/big-copy', from_request_id: bigId });
const copy = await relay('GET', `${API}/api/big-copy`);
check('from_request_id copies the exact original body', copy.text === big, `${copy.text.length} vs ${big.length}`);
r = await tool('upsert_mock', { url_pattern: '/api/nonexistent-src', from_request_id: 99999999 });
check('unknown from_request_id → clear error', r.err && /not found/i.test(r.raw), r.raw);

// ── 8. list_recent_requests / get_request ─────────────────────────────────
section('8. list_recent_requests / get_request');
await tool('upsert_mock', { url_pattern: '/api/boom', response_status: 503, response_body: { error: 'down' } });
await relay('GET', `${API}/api/boom`, { headers: { authorization: 'Bearer TOP-SECRET' } });
r = await tool('list_recent_requests', { status: '5xx', limit: 5 });
check('filters by status class', r.data.returned >= 1 && r.data.requests.every((x) => x.status >= 500), r.raw);
check('summaries are compact', r.raw.length < 1500, r.raw.length);
const boomId = r.data.requests.find((x) => x.url.includes('/api/boom'))?.id;
r = await tool('get_request', { id: boomId });
check('get_request returns details, redacted', r.data.response.body?.error === 'down' && !r.raw.includes('TOP-SECRET'), r.raw);
r = await tool('list_recent_requests', { only_real: true, limit: 30 });
check('only_real excludes mocked entries', r.data.requests.every((x) => x.source === 'REAL'), r.raw);
r = await tool('get_request', { id: 99999999 });
check('unknown request id → error', r.err, r.raw);

// ── 9. delete ─────────────────────────────────────────────────────────────
section('9. delete_mock');
r = await tool('delete_mock', { url_pattern: '/api/users/1' });
check('delete is strict: method omitted ≠ any method', r.err, r.raw);
r = await tool('delete_mock', { url_pattern: '/api/users/1', method: 'GET' });
check('deletes the rule', !r.err && r.data.deleted.length === 1, r.raw);
r = await tool('list_mocks', { search: '/api/users/1' });
check('and it is gone', r.data.count === 0, r.raw);

// ── 10. resilience ────────────────────────────────────────────────────────
section('10. Resilience');
check('backend still alive after all of the above', (await fetch(`${BASE}/health`)).ok);
const down = await connect({ PROXYFLOW_URL: 'http://127.0.0.1:1', PROXYFLOW_TOKEN: apiToken });
r = await (async () => { const x = await down.callTool({ name: 'list_mocks', arguments: {} }); return { err: !!x.isError, raw: x.content[0].text }; })();
check('unreachable backend → actionable error (no stack trace / hang)', r.err && /Cannot reach proxyflow backend/.test(r.raw), r.raw);
await down.close();
const badTok = await connect({ PROXYFLOW_URL: BASE, PROXYFLOW_TOKEN: 'pf_definitely-not-valid' });
r = await (async () => { const x = await badTok.callTool({ name: 'list_mocks', arguments: {} }); return { err: !!x.isError, raw: x.content[0].text }; })();
check('bad token → 401 with a fix-it hint', r.err && /HTTP 401/.test(r.raw) && /Settings/.test(r.raw), r.raw);
await badTok.close();

await client.close();
console.log(`\n${fail === 0 ? '🎉' : '💥'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
