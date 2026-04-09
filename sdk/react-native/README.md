# proxyflow React Native SDK

通过拦截全局 `fetch`，将 React Native 应用的所有网络请求转发到 proxyflow 服务，实现请求录制和 Mock 功能。

---

## 工作原理

```
React Native fetch()
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

SDK 通过 `/api/relay` 端点中转所有请求，无需在手机上设置 HTTP 代理，与 RN 沙箱环境完全兼容。

---

## 快速接入

### 第一步：安装（开发阶段 npm link）

```bash
# 在 SDK 目录注册
cd path/to/proxyflow/sdk/react-native
npm link

# 在 RN 项目中链接
cd your-rn-project
npm link proxyflow-react-native
```

### 第二步：初始化

在 `app/_layout.tsx`（Expo Router）或 `index.js` 的**最顶层**初始化，确保先于任何 `fetch` 调用：

```typescript
import proxyflow from 'proxyflow-react-native';

if (__DEV__) {
  proxyflow.init({
    serverUrl: 'http://192.168.1.100:9000',  // proxyflow 服务器地址（局域网 IP）
    sessionId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // 设备配对 sessionId
    debug: true,      // 开发阶段建议开启
    autoPatch: true,  // 自动拦截全局 fetch
  });
}
```

### 第三步：查看效果

初始化后，所有通过 `fetch` 发起的请求都会经过 proxyflow，在控制台实时可见。

---

## 使用方式

### 方式一：autoPatch（推荐）

`autoPatch: true` 后，业务代码无需任何修改，所有 `fetch` 调用自动经过 proxyflow：

```typescript
// 你的业务代码无需改动
const res = await fetch('https://api.example.com/users');
const data = await res.json();

// 响应头中携带 proxyflow 附加信息
const isMocked = res.headers.get('x-proxyflow-is-mocked');   // 'true' | 'false'
const duration = res.headers.get('x-proxyflow-duration-ms'); // 耗时毫秒
```

### 方式二：手动调用 proxyflow.fetch

无需 `autoPatch`，直接用 `proxyflow.fetch` 替代原生 `fetch`：

```typescript
import proxyflow from 'proxyflow-react-native';

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
| `serverUrl` | string | ✅ | proxyflow 后端地址，如 `http://192.168.1.100:9000` |
| `sessionId` | string | ✅ | 设备 session ID，从控制台配对页面获取 |
| `enabled` | boolean | | 是否启用 SDK，默认 `true` |
| `timeout` | number | | 请求超时毫秒，默认 `30000` |
| `debug` | boolean | | 打印调试日志，默认 `false` |
| `autoPatch` | boolean | | 初始化时自动 patch `fetch`，默认 `false` |

---

## API 参考

### `proxyflow.init(config)`
初始化 SDK。必须在任何 `fetch` 调用前执行（建议放在 `app/_layout.tsx` 的顶层）。

### `proxyflow.fetch(input, init?)`
发送经过 proxyflow relay 的请求，与原生 `fetch` 签名完全兼容，返回 `Promise<Response>`。

### `proxyflow.patch()`
拦截 `global.fetch`。调用后，所有 fetch 请求自动经过 proxyflow。

### `proxyflow.unpatch()`
恢复原始 `fetch`，停止拦截。

### `proxyflow.enable()` / `proxyflow.disable()`
动态启用或禁用 SDK（不影响 patch 状态，只控制是否转发）。

### `proxyflow.getConfig()`
返回当前配置的副本，用于调试。

---

## 注意事项

- **FormData 上传**：`fetch` body 为 `FormData` 时，SDK 自动降级为直接请求（不经 relay），避免序列化问题。
- **只在开发环境启用**：用 `if (__DEV__)` 包裹初始化代码，确保生产包不受影响。
- **网络要求**：RN 设备和 proxyflow 服务器需在同一局域网，或服务器有公网地址。Android 模拟器使用 `10.0.2.2` 访问宿主机，iOS 模拟器使用 `localhost`。

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

**Q: Android 模拟器连不上 proxyflow 服务器？**

Android 模拟器不能用 `localhost` 或 `127.0.0.1` 访问宿主机，改用 `10.0.2.2`：

```javascript
proxyflow.init({
  serverUrl: 'http://10.0.2.2:9000',
  sessionId: 'your-session-id',
});
```

**Q: 多人开发时如何隔离数据？**

每个开发者在控制台创建独立账号，并用各自的 `sessionId` 初始化 SDK，请求日志和 Mock 规则互相隔离。

---

## 文件说明

```
sdk/react-native/
├── proxyflow-rn-sdk.js     # SDK 主文件
├── proxyflow-rn-sdk.d.ts   # TypeScript 类型定义
├── package.json
└── README.md              # 本文档
```
