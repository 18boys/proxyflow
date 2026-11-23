const BASE_URL = '/api';
const TOKEN_COOKIE = 'proxyflow_token';
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export function setTokenCookie(token: string) {
  document.cookie = `${TOKEN_COOKIE}=${token}; max-age=${TOKEN_MAX_AGE}; path=/; SameSite=Strict`;
}

export function clearTokenCookie() {
  document.cookie = `${TOKEN_COOKIE}=; max-age=0; path=/; SameSite=Strict`;
}

// 统一的 401 监听机制：允许注册回调，或者触发全局 CustomEvent
type UnauthorizedListener = () => void;
const unauthorizedListeners: Set<UnauthorizedListener> = new Set();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

let isHandling401 = false;
function triggerUnauthorized() {
  clearTokenCookie();
  if (isHandling401) return;
  isHandling401 = true;

  // 广播 401 未授权通知
  unauthorizedListeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('proxyflow:unauthorized'));
  }

  // 1 秒防抖，避免瞬间几十个接口同时抛 401 导致疯狂重复弹窗
  setTimeout(() => {
    isHandling401 = false;
  }, 1000);
}

function getToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register') && !path.startsWith('/auth/continue')) {
      triggerUnauthorized();
    }
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

function get<T>(path: string) {
  return request<T>(path, { method: 'GET' });
}

function post<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function put<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function patch<T>(path: string, body?: unknown) {
  return request<T>(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function del<T>(path: string) {
  return request<T>(path, { method: 'DELETE' });
}

// ── Auth ──────────────────────────────────────────────────────────────────
export const authApi = {
  continueAuth: (email: string, password: string) =>
    post<{ token: string; user: { id: number; email: string }; isNewUser: boolean }>('/auth/continue', { email, password }),
  register: (email: string, password: string) =>
    post<{ token: string; user: { id: number; email: string } }>('/auth/register', { email, password }),
  login: (email: string, password: string) =>
    post<{ token: string; user: { id: number; email: string } }>('/auth/login', { email, password }),
  me: () => get<{ id: number; email: string }>('/auth/me'),
  refresh: () => post<{ token: string; user: { id: number; email: string } }>('/auth/refresh'),
};

export const devicesApi = {
  list: () => get<import('../types').DeviceSession[]>('/devices'),
  pair: (name: string) =>
    post<{ sessionId: string; pairingToken: string; wsUrl: string; httpUrl: string; qrCode: string }>('/devices/pair', { name }),
  getPairInfo: (sessionId: string) =>
    get<{ sessionId: string; pairingToken: string; wsUrl: string; httpUrl: string; qrCode: string }>(`/devices/${sessionId}/pair-info`),
  disconnect: (sessionId: string) => del(`/devices/${sessionId}`),
  rename: (sessionId: string, name: string) => patch(`/devices/${sessionId}/name`, { name }),
  simulateOnline: (sessionId: string) =>
    post<{ success: boolean; is_online: boolean }>(`/devices/${sessionId}/simulate-online`),
};

// ── Requests ──────────────────────────────────────────────────────────────
export const requestsApi = {
  list: (params?: {
    url?: string;
    method?: string;
    status?: string;
    sessionId?: string;
    startTime?: string;
    endTime?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = params
      ? '?' + new URLSearchParams(
          Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
          )
        ).toString()
      : '';
    return get<{ logs: import('../types').RequestLog[]; total: number }>(`/requests${qs}`);
  },
  get: (id: number) => get<import('../types').RequestLog>(`/requests/${id}`),
  clear: () => del('/requests'),
  getCurl: (id: number) => get<{ curl: string }>(`/requests/${id}/curl`),
  share: (id: number) => post<{ share_token: string }>(`/requests/${id}/share`),
  getShared: (token: string) =>
    fetch(`${BASE_URL}/shared/${token}`).then((r) => {
      if (!r.ok) throw new Error('Shared request not found');
      return r.json() as Promise<import('../types').SharedRequest>;
    }),
  getSharedCurl: (token: string) =>
    fetch(`${BASE_URL}/shared/${token}/curl`).then((r) => {
      if (!r.ok) throw new Error('Shared request not found');
      return r.json() as Promise<{ curl: string }>;
    }),
  replay: (id: number) =>
    post<{
      success: boolean;
      log: import('../types').RequestLog;
      statusCode: number;
      headers: Record<string, string>;
      body: string;
      durationMs: number;
    }>(`/requests/${id}/replay`),
  sendCustom: (data: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string | null;
  }) =>
    post<{
      success: boolean;
      log: import('../types').RequestLog;
      statusCode: number;
      headers: Record<string, string>;
      body: string;
      durationMs: number;
    }>('/requests/send-custom', data),
  disableMock: (id: number) =>
    post<{
      success: boolean;
      rule: import('../types').MockRule;
    }>(`/requests/${id}/disable-mock`),
};

// ── Stats ─────────────────────────────────────────────────────────────────
export const statsApi = {
  today: () => get<{ today_requests: number; today_online_users: number }>('/stats/today'),
  overview: (days = 30) => get<import('../types').StatsOverview>(`/stats/overview?days=${days}`),
};

// ── Mocks ─────────────────────────────────────────────────────────────────
export const mocksApi = {
  list: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return get<import('../types').MockRule[]>(`/mocks${qs}`);
  },
  match: (params: {
    url: string;
    method?: string;
    search?: string;
    scope?: 'all' | 'mine' | 'others';
  }) => {
    const searchParams = new URLSearchParams({ url: params.url });
    if (params.method) searchParams.set('method', params.method);
    if (params.search) searchParams.set('search', params.search);
    if (params.scope) searchParams.set('scope', params.scope);
    return get<import('../types').MatchedMocksResponse>(`/mocks/match?${searchParams.toString()}`);
  },
  listTeam: (params?: {
    search?: string;
    ownerId?: number | null;
    folderId?: 'all' | 'unfiled' | number | null;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.ownerId) searchParams.set('ownerId', String(params.ownerId));
    if (params?.folderId !== undefined && params?.folderId !== null && params?.folderId !== 'all') {
      searchParams.set('folderId', String(params.folderId));
    }
    const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return get<import('../types').TeamMocksResponse>(`/mocks/team${qs}`);
  },
  create: (data: {
    name: string;
    url_pattern: string;
    folder_id?: number | null;
    match_type?: string;
    method?: string;
    is_public?: boolean | number;
    delay_ms?: number;
    condition_field_type?: string;
    condition_field_key?: string;
    condition_field_value?: string;
  }) => post<import('../types').MockRule>('/mocks', data),
  update: (id: number, data: Partial<import('../types').MockRule>) =>
    put<import('../types').MockRule>(`/mocks/${id}`, data),
  setVisibility: (id: number, isPublic: boolean) =>
    patch<import('../types').MockRule>(`/mocks/${id}/visibility`, { is_public: isPublic }),
  delete: (id: number) => del(`/mocks/${id}`),
  fork: (data: {
    sourceRuleId: number;
    versionId?: number;
    folderId?: number | null;
    preserveFolderName?: boolean;
    activate?: boolean;
    disableConflicting?: boolean;
    targetUrl?: string;
    targetMethod?: string;
    name?: string;
  }) => post<import('../types').MockRule>('/mocks/fork', data),
  forkFolder: (data: {
    sourceFolderId: number | 'unfiled';
    sourceOwnerId?: number;
    targetFolderId?: number | null;
    targetFolderName?: string;
    activate?: boolean;
  }) => post<{ folder: import('../types').MockFolder | null; cloned_rules: number }>('/mocks/fork-folder', data),
  listVersions: (id: number) =>
    get<import('../types').MockVersion[]>(`/mocks/${id}/versions`),
  createVersion: (id: number, data: {
    name: string;
    response_status?: number;
    response_headers?: string;
    response_body?: string;
  }) => post<import('../types').MockVersion>(`/mocks/${id}/versions`, data),
  updateVersion: (id: number, vid: number, data: Partial<import('../types').MockVersion>) =>
    put<import('../types').MockVersion>(`/mocks/${id}/versions/${vid}`, data),
  deleteVersion: (id: number, vid: number) =>
    del<{ success: boolean; rule: import('../types').MockRule }>(`/mocks/${id}/versions/${vid}`),
  selectVersion: (id: number, vid: number) =>
    post(`/mocks/${id}/versions/${vid}/select`),
  export: (folderId?: 'all' | 'unfiled' | number) => {
    const qs = folderId && folderId !== 'all' ? `?folderId=${encodeURIComponent(String(folderId))}` : '';
    return get<{
      version?: string;
      scope?: 'all' | 'unfiled' | 'folder';
      folder_name?: string | null;
      filename?: string;
      folders: import('../types').MockFolder[];
      mocks: import('../types').MockRule[];
    }>(`/mocks/data/export${qs}`);
  },
  import: (mocks: unknown[], targetFolderId?: number | null) =>
    post<{ imported: number }>('/mocks/data/import', {
      mocks,
      ...(targetFolderId !== undefined ? { targetFolderId } : {}),
    }),
  fromRequest: (requestId: number, name: string, versionName?: string, folderId?: number | null) =>
    post<import('../types').MockRule>('/mocks/from-request', { requestId, name, versionName, folderId }),
  fromShared: (shareToken: string, name: string, versionName?: string, folderId?: number | null, isActive?: boolean) =>
    post<import('../types').MockRule>('/mocks/from-shared', { shareToken, name, versionName, folderId, isActive }),
  listFolders: () => get<import('../types').MockFolder[]>('/mocks/folders'),
  createFolder: (name: string, isPublic = true) =>
    post<import('../types').MockFolder>('/mocks/folders', { name, is_public: isPublic }),
  updateFolder: (id: number, name: string) => put<import('../types').MockFolder>(`/mocks/folders/${id}`, { name }),
  setFolderVisibility: (id: number, isPublic: boolean) =>
    patch<import('../types').MockFolder>(`/mocks/folders/${id}/visibility`, { is_public: isPublic }),
  deleteFolder: (id: number) => del(`/mocks/folders/${id}`),
};

// ── Rules ─────────────────────────────────────────────────────────────────
export const rulesApi = {
  setGlobal: (mode: 'mock' | 'proxy') => post('/rules/global', { mode }),
  toggle: (id: number) => patch<{ is_active: number }>(`/rules/${id}/toggle`),
  setVersion: (id: number, versionId: number) => patch(`/rules/${id}/version`, { versionId }),
};

// ── AI ────────────────────────────────────────────────────────────────────
export function streamAiRequest(
  endpoint: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void,
  onError: (msg: string) => void
): () => void {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();

  fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      onError(`HTTP ${res.status}`);
      return;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'chunk') {
              fullText += data.text;
              onChunk(data.text);
            } else if (data.type === 'done') {
              onDone(data.fullText || fullText);
            } else if (data.type === 'error') {
              onError(data.message);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onError(err.message);
    }
  });

  return () => controller.abort();
}

// ── API Tokens (MCP) ────────────────────────────────────────────────────────
export const tokensApi = {
  list: () => get<import('../types').ApiToken[]>('/tokens'),
  create: (name: string) =>
    post<import('../types').ApiToken & { token: string }>('/tokens', { name }),
  revoke: (id: number) => del<{ success: boolean }>(`/tokens/${id}`),
};

// ── Settings ──────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => get<{ exclusion_domains: string[] }>('/settings'),
  getExclusions: () => get<{ exclusion_domains: string[] }>('/settings'),
  updateExclusions: (domains: string[]) =>
    put<{ exclusion_domains: string[] }>('/settings/exclusions', { domains }),
  getAi: () => get<import('../types').AiSettings>('/settings/ai'),
  updateAi: (data: {
    enabled: boolean;
    protocol: import('../types').AiProtocol;
    endpoint: string;
    model: string;
    api_key?: string | null;
  }) => put<import('../types').AiSettings>('/settings/ai', data),
  testAi: (data: {
    protocol: import('../types').AiProtocol;
    endpoint: string;
    model: string;
    api_key?: string | null;
  }) => post<{ success: boolean; message: string }>('/settings/ai/test', data),
};
