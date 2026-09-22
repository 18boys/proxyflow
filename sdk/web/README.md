# proxyflow Web SDK

通过拦截全局 `fetch`，将浏览器应用的所有网络请求转发到 proxyflow 服务，实现请求录制和 Mock 功能。

支持通过 `<script>` 标签直接引入，也支持 npm / ESM 方式。

---

## 工作原理

```
浏览器 fetch()
       │
       ▼ (SDK 拦截)
proxyflow SDK
       │  POST /api/relay
       ▼
proxyflow 后端 (9000 端口)
       │
       ├── 命中 Mock 规则 → 直接返回 Mock 数据 ──────┐
       │                                              │
       └── 未命中 → 转发到真实服务器 → 返回真实响应 ──┘
                                                      │
                                              实时推送到控制台 Dashboard
```

SDK 通过 `/api/relay` 端点中转所有请求，无需在浏览器或系统层面设置代理。

---

## 快速接入

### 方式一：script 标签（零构建）

```html
<!-- 在 </body> 前引入，确保先于业务代码执行 -->
<script src="path/to/proxyflow-web-sdk.js"></script>
<script>
  proxyflow.init({
    serverUrl: 'http://localhost:9000',
    sessionId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    debug: true,
    autoPatch: true,  // 自动拦截全局 fetch
  });
</script>
```

### 方式二：npm / ESM

在应用入口文件（如 `main.ts` / `index.js`）的**最顶层**初始化：

```typescript
import proxyflow from '@proxyflow/web-sdk';

if (process.env.NODE_ENV === 'development') {
  proxyflow.init({
    serverUrl: 'http://localhost:9000',
    sessionId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    debug: true,
    autoPatch: true,
  });
}
```

---

## 使用方式

### 方式一：autoPatch（推荐）

`autoPatch: true` 后，业务代码无需任何修改，所有 `fetch` 调用自动经过 proxyflow：

```typescript
// 你的业务代码无需改动
const res = await fetch('https://api.example.com/users');
const data = await res.json();
```

响应头中会携带：
- `x-proxyflow-is-mocked`: `'true'` 或 `'false'`，表示是否命中了 Mock 规则
- `x-proxyflow-duration-ms`: 请求耗时（毫秒）

### 方式二：手动调用 proxyflow.fetch

无需 `autoPatch`，直接用 `proxyflow.fetch` 替代原生 `fetch`：

```typescript
import proxyflow from 'proxyflow-web-sdk';

// 与原生 fetch 签名完全兼容
const res = await proxyflow.fetch('https://api.example.com/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'test', password: '123' }),
});
const data = await res.json();
```

---

### 方式三：Dev Server / BFF 代理模式（强烈推荐用于现代 Web 工程）

如果你的 Web 工程在本地开发时依赖代理做环境切换（如动态切 `dev` / `qa` 环境），或者业务依赖 **HttpOnly Cookie** 鉴权，强烈推荐直接在工程的 Dev Server / BFF 代理层接入 Proxyflow。

**核心优势**：
- **零业务代码侵入**：前端项目无需引入 SDK，业务代码直接调用相对路径（如 `/api/user`）；
- **Cookie 完整保留**：浏览器发往同源 Dev Server 会自动带上所有 Cookie（包括 HttpOnly），由 Node.js 服务端透传给 Proxyflow；
- **环境切换无缝保留**：目标环境域名（如 `https://qa.example.com`）由工程配置动态拼接，域名与环境信息丝毫不丢失。

---

#### 核心转发工具：`proxyflow-relay.mjs`

在你的项目中新建 `proxyflow-relay.mjs`（或直接从 `@proxyflow/web-sdk/relay` 引入）：

```javascript
// proxyflow-relay.mjs
export async function relayToProxyflow(
  req,
  res,
  {
    targetEnv,
    sessionId = process.env.PROXYFLOW_SESSION_ID,
    proxyflowUrl = process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  } = {}
) {
  if (!sessionId) {
    console.warn('[Proxyflow Relay] 警告: 未提供 sessionId，且 process.env.PROXYFLOW_SESSION_ID 为空。请在 .env.local 中配置 PROXYFLOW_SESSION_ID 或显式传入。');
  }
  const targetUrl = new URL(req.url, targetEnv).toString();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null;

  try {
    const relayRes = await fetch(`${proxyflowUrl.replace(/\/$/, '')}/api/relay`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: req.method,
        url: targetUrl,
        headers: req.headers, // 完整携带浏览器带过来的 Cookie 和所有请求头
        body,
        sessionId,
      }),
    });

    res.statusCode = relayRes.status;
    relayRes.headers.forEach((val, key) => {
      if (key !== 'transfer-encoding' && key !== 'content-encoding') res.setHeader(key, val);
    });
    const data = await relayRes.arrayBuffer();
    res.end(Buffer.from(data));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Proxyflow relay failed: ${err.message}` }));
  }
}

// Vite 插件辅助函数
export function proxyflowPlugin({
  targetEnv,
  sessionId = process.env.PROXYFLOW_SESSION_ID,
  proxyflowUrl = process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  prefix = '/api',
} = {}) {
  return {
    name: 'vite-plugin-proxyflow',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith(prefix)) {
          relayToProxyflow(req, res, { targetEnv, sessionId, proxyflowUrl });
        } else {
          next();
        }
      });
    },
  };
}
```

---

#### 💡 团队协作最佳实践：通过 `.env.local` 配置各自的 Session ID

在多人协作的项目中，每个人配对的 Proxyflow 设备 Session ID 都不一样。**强烈建议将 Session ID 存放在本地私有环境变量文件 `.env.local` 中**：

1. 在项目根目录创建 `.env.local`（确认已在 `.gitignore` 中，避免提交到 Git）：
   ```ini
   # .env.local (各开发者本地私有配置，不提交 Git)
   PROXYFLOW_SESSION_ID=你的-SESSION-ID
   # 可选：覆盖 Proxyflow 服务地址（默认即为 http://172.31.0.8:9000）
   # PROXYFLOW_URL=http://172.31.0.8:9000
   # 可选：切换目标环境
   # API_ENV=qa
   ```
2. 每位开发者只需在自己本地的 `.env.local` 中填入自己的 `PROXYFLOW_SESSION_ID`，互不干扰、互不覆盖。
3. `relayToProxyflow` 与 `proxyflowPlugin` **内置自动读取** `process.env.PROXYFLOW_SESSION_ID` 和 `process.env.PROXYFLOW_URL`，在代码中甚至可以完全省略这两个参数！

---

#### 各场景极简接入示例

##### 1. Vite 工程 (`vite.config.ts`) —— 仅需引入插件

```typescript
import { defineConfig, loadEnv } from 'vite';
import { proxyflowPlugin } from '@proxyflow/web-sdk/relay'; // 或 './proxyflow-relay.mjs'

export default defineConfig(({ mode }) => {
  // 加载本地 .env.local
  const env = loadEnv(mode, process.cwd(), '');
  const TARGET_ENV = env.API_ENV === 'dev' ? 'https://dev.example.com' : 'https://qa.example.com';

  return {
    server: {
      plugins: [
        proxyflowPlugin({
          targetEnv: TARGET_ENV,
          sessionId: env.PROXYFLOW_SESSION_ID, // 自动从 .env.local 读取，团队成员各配各的
          proxyflowUrl: env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
        }),
      ],
    },
  };
});
```

##### 2. Next.js 工程

Next.js 原生自动加载根目录的 `.env.local` 到 `process.env`，无需任何配置。

###### App Router (`app/api/[...path]/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';

const TARGET_ENV = process.env.API_ENV === 'dev' ? 'https://dev.example.com' : 'https://qa.example.com';
const PROXYFLOW_URL = process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000';
const PROXYFLOW_SESSION_ID = process.env.PROXYFLOW_SESSION_ID; // 自动读取本地 .env.local

async function handleRelay(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = '/' + (params.path || []).join('/');
  const targetUrl = `${TARGET_ENV}/api${path}${request.nextUrl.search}`;
  const body = request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : null;

  const headers: Record<string, string> = {};
  request.headers.forEach((val, key) => { headers[key.toLowerCase()] = val; });

  try {
    const relayRes = await fetch(`${PROXYFLOW_URL}/api/relay`, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: request.method, url: targetUrl, headers, body, sessionId: PROXYFLOW_SESSION_ID }),
    });
    const resHeaders = new Headers();
    relayRes.headers.forEach((val, key) => {
      if (key !== 'transfer-encoding' && key !== 'content-encoding') resHeaders.set(key, val);
    });
    return new NextResponse(await relayRes.arrayBuffer(), { status: relayRes.status, headers: resHeaders });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export const GET = handleRelay;
export const POST = handleRelay;
export const PUT = handleRelay;
export const DELETE = handleRelay;
export const PATCH = handleRelay;
```

###### Pages Router (`pages/api/[...path].ts`) —— 仅 3 行

```typescript
import { relayToProxyflow } from '@proxyflow/web-sdk/relay'; // 或 '../../proxyflow-relay.mjs'

export const config = { api: { bodyParser: false } };
export default (req: any, res: any) =>
  relayToProxyflow(req, res, {
    targetEnv: process.env.API_ENV === 'dev' ? 'https://dev.example.com' : 'https://qa.example.com',
    sessionId: process.env.PROXYFLOW_SESSION_ID, // 自动从 .env.local 读取
    proxyflowUrl: process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  });
```

##### 3. Nuxt.js / Nuxt 3 (`server/routes/api/[...path].ts`) —— 仅 3 行

Nuxt 3 原生自动加载 `.env` / `.env.local` 到 `process.env`：

```typescript
import { relayToProxyflow } from '@proxyflow/web-sdk/relay'; // 或 '~/proxyflow-relay.mjs'

export default defineEventHandler((event) =>
  relayToProxyflow(event.node.req, event.node.res, {
    targetEnv: process.env.API_ENV === 'dev' ? 'https://dev.example.com' : 'https://qa.example.com',
    sessionId: process.env.PROXYFLOW_SESSION_ID, // 自动从 .env.local 读取
    proxyflowUrl: process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  })
);
```

##### 4. Webpack / Vue CLI (`vue.config.js` / `webpack.config.js`) —— 仅 3 行

> Vue CLI 默认原生加载 `.env.local`。如果是原生 Webpack，可先执行 `npm i -D dotenv` 并在配置首行加入 `require('dotenv').config({ path: '.env.local' });`。

```javascript
// 原生 Webpack 如果未加载环境变量，可解开下行注释：
// require('dotenv').config({ path: '.env.local' });

const { relayToProxyflow } = require('@proxyflow/web-sdk/relay'); // 或 './proxyflow-relay.cjs'

const TARGET_ENV = process.env.API_ENV === 'dev' ? 'https://dev.example.com' : 'https://qa.example.com';

module.exports = {
  devServer: {
    setupMiddlewares: (middlewares, devServer) => {
      devServer.app.use((req, res, next) => {
        if (req.url.startsWith('/api/')) {
          relayToProxyflow(req, res, {
            targetEnv: TARGET_ENV,
            sessionId: process.env.PROXYFLOW_SESSION_ID, // 自动从本地 .env.local 获取，团队成员各配各的
            proxyflowUrl: process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
          });
        } else {
          next();
        }
      });
      return middlewares;
    },
  },
};
```

##### 5. Turborepo (Turbo Monorepo)

在 Monorepo 根目录下创建 `.env.local` 统一管理本地私有环境变量：

```ini
API_ENV=qa
PROXYFLOW_URL=http://172.31.0.8:9000
PROXYFLOW_SESSION_ID=你的-SESSION-ID
```

并在 `turbo.json` 的 `globalEnv` 中声明：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["API_ENV", "PROXYFLOW_URL", "PROXYFLOW_SESSION_ID"],
  "tasks": {
    "dev": { "cache": false, "persistent": true }
  }
}
```

---

---

## 初始化参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `serverUrl` | string | ✅ | proxyflow 后端地址，如 `http://localhost:9000` |
| `sessionId` | string | ✅ | 设备 session ID，从控制台配对页面获取 |
| `enabled` | boolean | | 是否启用 SDK，默认 `true` |
| `timeout` | number | | 请求超时毫秒，默认 `30000` |
| `debug` | boolean | | 打印调试日志，默认 `false` |
| `autoPatch` | boolean | | 初始化时自动 patch `fetch`，默认 `false` |

---

## API 参考

### `proxyflow.init(config)`
初始化 SDK。必须在任何 `fetch` 调用前执行（建议放在应用入口的最顶层）。

### `proxyflow.fetch(input, init?)`
发送经过 proxyflow relay 的请求，与原生 `fetch` 签名完全兼容，返回 `Promise<Response>`。

### `proxyflow.patch()`
拦截 `window.fetch`（`globalThis.fetch`）。调用后，所有 fetch 请求自动经过 proxyflow。

### `proxyflow.unpatch()`
恢复原始 `fetch`，停止拦截。

### `proxyflow.enable()` / `proxyflow.disable()`
动态启用或禁用 SDK（不影响 patch 状态，只控制是否转发）。

### `proxyflow.getConfig()`
返回当前配置的副本，用于调试。

---

## CORS 配置

proxyflow 后端需要允许来自浏览器的跨域请求。确保后端响应头包含：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

proxyflow 服务默认已配置 CORS，开发阶段无需额外设置。

---

## 注意事项

- **FormData / Blob 上传**：body 为 `FormData` 或 `Blob` 时，SDK 自动降级为直接请求（不经 relay），避免序列化问题。
- **只在开发环境启用**：用 `process.env.NODE_ENV === 'development'` 或其他环境变量包裹初始化代码，确保生产包不受影响。
- **网络要求**：浏览器和 proxyflow 服务器需在同一局域网，或服务器有公网地址。
- **HTTPS 页面**：若页面为 HTTPS，relay 地址也需为 HTTPS（或通过 localhost 访问），否则浏览器会阻止混合内容请求。

---

## 在控制台配置 Mock 规则

接入 SDK 后，所有请求都会出现在 proxyflow 控制台的**请求列表**中。

1. 在控制台找到你想 Mock 的请求
2. 点击该请求 → **创建 Mock 规则**
3. 配置返回的状态码、响应体、延迟时间等
4. 开启规则后，下次发出该请求时将直接返回 Mock 数据

---

## 常见问题

**Q: 如何只 Mock 部分接口，其他接口还走真实网络？**

在 proxyflow 控制台只为需要 Mock 的接口创建规则并开启，未匹配规则的请求会自动转发到真实服务器。

**Q: 如何临时关闭 proxyflow 而不删除代码？**

```javascript
proxyflow.disable();  // 暂停转发，fetch 走原始逻辑
proxyflow.enable();   // 重新启用
```

**Q: 多人开发时如何隔离数据？**

每个开发者在控制台创建独立账号，并用各自的 `sessionId` 初始化 SDK，请求日志和 Mock 规则互相隔离。

**Q: 我的项目用 axios，需要换成 fetch 吗？**

不需要。axios 在浏览器中底层使用 `XMLHttpRequest`，不经过 `fetch`，因此 patch fetch 对 axios 无效。
推荐使用 `proxyflow.fetch` 作为请求客户端，或在 axios 中配置 adapter 进行集成。

---

## 文件说明

```
sdk/web/
├── proxyflow-web-sdk.js    # SDK 主文件（UMD，支持 script 标签和 require）
├── proxyflow-web-sdk.d.ts  # TypeScript 类型定义
├── package.json
└── README.md              # 本文档
```
