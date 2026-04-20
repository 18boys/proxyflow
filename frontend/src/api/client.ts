const BASE_URL = '/api';
const TOKEN_COOKIE = 'proxyflow_token';
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export function setTokenCookie(token: string) {
  document.cookie = `${TOKEN_COOKIE}=${token}; max-age=${TOKEN_MAX_AGE}; path=/; SameSite=Strict`;
}

export function clearTokenCookie() {
  document.cookie = `${TOKEN_COOKIE}=; max-age=0; path=/; SameSite=Strict`;
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
  register: (email: string, password: string) =>
    post<{ token: string; user: { id: number; email: string } }>('/auth/register', { email, password }),
  login: (email: string, password: string) =>
    post<{ token: string; user: { id: number; email: string } }>('/auth/login', { email, password }),
  me: () => get<{ id: number; email: string }>('/auth/me'),
  refresh: () => post<{ token: string; user: { id: number; email: string } }>('/auth/refresh'),
};

// ── Devices ───────────────────────────────────────────────────────────────
export const devicesApi = {
  list: () => get<import('../types').DeviceSession[]>('/devices'),
  pair: (name: string) =>
    post<{ sessionId: string; pairingToken: string; wsUrl: string; qrCode: string }>('/devices/pair', { name }),
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
      return r.json() as Promise<import('../types').RequestLog>;
    }),
};

// ── Stats ─────────────────────────────────────────────────────────────────
export const statsApi = {
  today: () => get<{ today_requests: number; today_online_users: number }>('/stats/today'),
};

// ── Mocks ─────────────────────────────────────────────────────────────────
export const mocksApi = {
  list: (search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return get<import('../types').MockRule[]>(`/mocks${qs}`);
  },
  create: (data: {
    name: string;
    url_pattern: string;
    match_type?: string;
    method?: string;
    delay_ms?: number;
    condition_field_type?: string;
    condition_field_key?: string;
    condition_field_value?: string;
  }) => post<import('../types').MockRule>('/mocks', data),
  update: (id: number, data: Partial<import('../types').MockRule>) =>
    put<import('../types').MockRule>(`/mocks/${id}`, data),
  delete: (id: number) => del(`/mocks/${id}`),
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
  deleteVersion: (id: number, vid: number) => del(`/mocks/${id}/versions/${vid}`),
  selectVersion: (id: number, vid: number) =>
    post(`/mocks/${id}/versions/${vid}/select`),
  export: () => get<{ mocks: import('../types').MockRule[] }>('/mocks/data/export'),
  import: (mocks: unknown[]) => post<{ imported: number }>('/mocks/data/import', { mocks }),
  fromRequest: (requestId: number, name: string, versionName?: string) =>
    post<import('../types').MockRule>('/mocks/from-request', { requestId, name, versionName }),
  fromShared: (shareToken: string, name: string, versionName?: string) =>
    post<import('../types').MockRule>('/mocks/from-shared', { shareToken, name, versionName }),
};

// ── Rules ─────────────────────────────────────────────────────────────────
export const rulesApi = {
  list: () => get<import('../types').MockRule[]>('/rules'),
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

// ── Settings ──────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => get<{ exclusion_domains: string[] }>('/settings'),
  updateExclusions: (domains: string[]) =>
    put<{ exclusion_domains: string[] }>('/settings/exclusions', { domains }),
};
