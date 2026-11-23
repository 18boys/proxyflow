import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface SavedServerCredential {
  token: string;
  email?: string;
  token_prefix?: string;
  token_name?: string;
  saved_at: string;
}

export interface PendingAuthRecord {
  request_id: string;
  poll_secret: string;
  user_code: string;
  auth_url: string;
  expires_at: string;
}

interface CredentialsFile {
  version: 1;
  servers: Record<string, SavedServerCredential>;
  pending?: Record<string, PendingAuthRecord>;
}

export type EnsureAuthResult =
  | {
      ok: true;
      token: string;
      source: 'env' | 'credentials';
      email?: string;
      token_prefix?: string;
      token_name?: string;
      just_authorized?: boolean;
      default_session?: { session_id: string; name: string } | null;
      credentials_path: string;
    }
  | {
      ok: false;
      status: 'pending' | 'denied' | 'expired' | 'unreachable' | 'error';
      auth_url?: string;
      user_code?: string;
      request_id?: string;
      expires_at?: string;
      browser_opened?: boolean;
      credentials_path: string;
      message: string;
    };

export function getCredentialsPath(): string {
  const custom = (process.env.PROXYFLOW_CREDENTIALS_PATH || '').trim();
  if (custom) return custom;
  return path.join(os.homedir(), '.proxyflow', 'credentials.json');
}

function readStore(): CredentialsFile {
  const filePath = getCredentialsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
    return {
      version: 1,
      servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {},
      pending: parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : {},
    };
  } catch {
    return { version: 1, servers: {}, pending: {} };
  }
}

function writeStore(store: CredentialsFile): void {
  const filePath = getCredentialsPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows / restricted FS
  }
}

export function getSavedCredential(baseUrl: string): SavedServerCredential | null {
  const store = readStore();
  return store.servers[baseUrl] || null;
}

export function saveCredential(baseUrl: string, cred: SavedServerCredential): void {
  const store = readStore();
  store.servers[baseUrl] = cred;
  if (store.pending) delete store.pending[baseUrl];
  writeStore(store);
}

export function clearSavedCredential(baseUrl: string): boolean {
  const store = readStore();
  const existed = Boolean(store.servers[baseUrl]);
  delete store.servers[baseUrl];
  if (store.pending) delete store.pending[baseUrl];
  writeStore(store);
  return existed;
}

export function getPendingAuth(baseUrl: string): PendingAuthRecord | null {
  const store = readStore();
  const rec = store.pending?.[baseUrl];
  if (!rec) return null;
  if (Date.parse(rec.expires_at) <= Date.now()) {
    clearPendingAuth(baseUrl);
    return null;
  }
  return rec;
}

export function savePendingAuth(baseUrl: string, rec: PendingAuthRecord): void {
  const store = readStore();
  if (!store.pending) store.pending = {};
  store.pending[baseUrl] = rec;
  writeStore(store);
}

export function clearPendingAuth(baseUrl: string): void {
  const store = readStore();
  if (store.pending && store.pending[baseUrl]) {
    delete store.pending[baseUrl];
    writeStore(store);
  }
}

export function openInBrowser(url: string): boolean {
  if (process.env.PROXYFLOW_NO_BROWSER === '1' || process.env.PROXYFLOW_NO_BROWSER === 'true') {
    return false;
  }
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url: string, body: unknown, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed: any = raw;
    try { parsed = JSON.parse(raw); } catch { /* keep text */ }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason = e.name === 'TimeoutError'
      ? `no response within ${Math.round(timeoutMs / 1000)}s`
      : (e.cause?.code || e.message);
    return { ok: false, status: 0, body: { error: `Cannot reach proxyflow backend (${reason})` } };
  }
}

export class McpAuthManager {
  private readonly baseUrl: string;
  private readonly webBaseUrl: string;
  private readonly envToken: string | null;
  private inFlight: Promise<EnsureAuthResult> | null = null;

  constructor(opts: { baseUrl: string; webBaseUrl?: string; envToken?: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.webBaseUrl = (opts.webBaseUrl || '').replace(/\/+$/, '');
    this.envToken = opts.envToken?.trim() ? opts.envToken.trim() : null;
  }

  hasEnvToken(): boolean {
    return this.envToken !== null;
  }

  getActiveToken(): { token: string; source: 'env' | 'credentials'; saved?: SavedServerCredential } | null {
    if (this.envToken) return { token: this.envToken, source: 'env' };
    const saved = getSavedCredential(this.baseUrl);
    if (saved?.token) return { token: saved.token, source: 'credentials', saved };
    return null;
  }

  private buildAuthUrl(authPath: string, backendAuthUrl?: unknown): string {
    if (this.webBaseUrl) return `${this.webBaseUrl}${authPath}`;
    if (typeof backendAuthUrl === 'string' && /^https?:\/\//i.test(backendAuthUrl)) {
      return backendAuthUrl;
    }
    return `${this.baseUrl}${authPath}`;
  }

  private async pollOnce(pending: PendingAuthRecord): Promise<
    | { state: 'approved'; result: EnsureAuthResult }
    | { state: 'pending' }
    | { state: 'denied' | 'expired' | 'gone' }
    | { state: 'unreachable'; error: string }
  > {
    const res = await postJson(`${this.baseUrl}/api/auth/mcp/poll`, {
      request_id: pending.request_id,
      poll_secret: pending.poll_secret,
    }, 10_000);

    if (res.status === 0) {
      return { state: 'unreachable', error: res.body?.error || 'Backend unreachable' };
    }
    if (res.status === 404 || res.status === 403) {
      clearPendingAuth(this.baseUrl);
      return { state: 'gone' };
    }
    const status = res.body?.status;
    if (status === 'approved' && typeof res.body?.token === 'string') {
      const cred: SavedServerCredential = {
        token: res.body.token,
        email: res.body.user?.email || undefined,
        token_prefix: res.body.token_prefix || res.body.token.slice(0, 12),
        token_name: res.body.token_name || undefined,
        saved_at: new Date().toISOString(),
      };
      saveCredential(this.baseUrl, cred);
      console.error(`[proxyflow-mcp] authorized as ${cred.email || 'user'} (${cred.token_prefix}...)`);
      return {
        state: 'approved',
        result: {
          ok: true,
          token: cred.token,
          source: 'credentials',
          email: cred.email,
          token_prefix: cred.token_prefix,
          token_name: cred.token_name,
          just_authorized: true,
          default_session: res.body.default_session || null,
          credentials_path: getCredentialsPath(),
        },
      };
    }
    if (status === 'denied') {
      clearPendingAuth(this.baseUrl);
      return { state: 'denied' };
    }
    if (status === 'expired' || status === 'claimed') {
      clearPendingAuth(this.baseUrl);
      return { state: 'expired' };
    }
    return { state: 'pending' };
  }

  async ensureAuthorized(opts: {
    force?: boolean;
    waitMs?: number;
    openBrowser?: boolean;
  } = {}): Promise<EnsureAuthResult> {
    const credentialsPath = getCredentialsPath();

    if (!opts.force) {
      if (this.envToken) {
        return { ok: true, token: this.envToken, source: 'env', credentials_path: credentialsPath };
      }
      const saved = getSavedCredential(this.baseUrl);
      if (saved?.token) {
        return {
          ok: true,
          token: saved.token,
          source: 'credentials',
          email: saved.email,
          token_prefix: saved.token_prefix,
          token_name: saved.token_name,
          credentials_path: credentialsPath,
        };
      }
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runAuthFlow(opts).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runAuthFlow(opts: {
    force?: boolean;
    waitMs?: number;
    openBrowser?: boolean;
  }): Promise<EnsureAuthResult> {
    const credentialsPath = getCredentialsPath();
    const waitMs = Math.max(0, Math.min(120_000, opts.waitMs ?? 45_000));
    const shouldOpenBrowser = opts.openBrowser !== false;

    let pending: PendingAuthRecord | null = opts.force ? null : getPendingAuth(this.baseUrl);
    let browserOpened = false;

    // 1. If we already have a pending auth request, poll it once right away!
    if (pending) {
      const check = await this.pollOnce(pending);
      if (check.state === 'approved') return check.result;
      if (check.state === 'unreachable') {
        return {
          ok: false,
          status: 'unreachable',
          credentials_path: credentialsPath,
          message: `Cannot reach proxyflow backend at ${this.baseUrl} (${check.error}).`,
        };
      }
      if (check.state === 'denied' || check.state === 'expired' || check.state === 'gone') {
        pending = null;
      }
    }

    // 2. No active pending request -> create one and open browser
    if (!pending) {
      const startRes = await postJson(`${this.baseUrl}/api/auth/mcp/start`, {
        client_name: 'ProxyFlow MCP',
        hostname: os.hostname(),
      });
      if (!startRes.ok) {
        return {
          ok: false,
          status: startRes.status === 0 ? 'unreachable' : 'error',
          credentials_path: credentialsPath,
          message: typeof startRes.body === 'string'
            ? startRes.body
            : (startRes.body?.error || `Failed to start authorization (HTTP ${startRes.status})`),
        };
      }

      const authPath = String(startRes.body.auth_path || `/mcp-auth?request_id=${encodeURIComponent(startRes.body.request_id)}`);
      const authUrl = this.buildAuthUrl(authPath, startRes.body.auth_url);

      pending = {
        request_id: String(startRes.body.request_id),
        poll_secret: String(startRes.body.poll_secret),
        user_code: String(startRes.body.user_code || ''),
        auth_url: authUrl,
        expires_at: String(startRes.body.expires_at),
      };
      savePendingAuth(this.baseUrl, pending);

      if (shouldOpenBrowser) {
        browserOpened = openInBrowser(pending.auth_url);
      }
      console.error(`[proxyflow-mcp] waiting for browser authorization: ${pending.auth_url} (code: ${pending.user_code})`);
    } else if (shouldOpenBrowser && opts.force) {
      browserOpened = openInBrowser(pending.auth_url);
    }

    // 3. Poll until approved / denied / expired / waitMs timeout
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(Math.min(1500, Math.max(200, deadline - Date.now())));
      const poll = await this.pollOnce(pending);
      if (poll.state === 'approved') return poll.result;
      if (poll.state === 'denied') {
        return {
          ok: false,
          status: 'denied',
          credentials_path: credentialsPath,
          message: '授权请求已在浏览器中被拒绝。如需重试请再次调用 authorize 或任意工具。',
        };
      }
      if (poll.state === 'expired' || poll.state === 'gone') {
        return {
          ok: false,
          status: 'expired',
          credentials_path: credentialsPath,
          message: '授权链接已过期，请再次调用以生成新的授权链接。',
        };
      }
      if (poll.state === 'unreachable') {
        return {
          ok: false,
          status: 'unreachable',
          credentials_path: credentialsPath,
          message: `Cannot reach proxyflow backend at ${this.baseUrl} (${poll.error}).`,
        };
      }
    }

    return {
      ok: false,
      status: 'pending',
      auth_url: pending.auth_url,
      user_code: pending.user_code,
      request_id: pending.request_id,
      expires_at: pending.expires_at,
      browser_opened: browserOpened,
      credentials_path: credentialsPath,
      message: browserOpened
        ? `已在浏览器打开 ProxyFlow 授权页（验证码 ${pending.user_code}）。请在浏览器中登录并点击「确认授权」，完成后直接继续操作即可，Token 将自动保存至 ${credentialsPath}。如浏览器未自动弹出，请手动打开：${pending.auth_url}`
        : `请打开以下链接完成 ProxyFlow 登录并点击「确认授权」（验证码 ${pending.user_code}）：${pending.auth_url} 。完成授权后直接重试即可，Token 将自动保存至 ${credentialsPath}。`,
    };
  }
}
