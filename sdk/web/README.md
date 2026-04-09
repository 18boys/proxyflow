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

```bash
# 开发阶段 npm link
cd path/to/proxyflow/sdk/web
npm link

cd your-web-project
npm link proxyflow-web-sdk
```

在应用入口文件（如 `main.ts` / `index.js`）的**最顶层**初始化：

```typescript
import proxyflow from 'proxyflow-web-sdk';

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
