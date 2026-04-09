# proxyflow 小程序 SDK

通过拦截平台的 `request` 方法，将小程序的所有网络请求转发到 proxyflow 服务，实现请求录制和 Mock 功能。

支持微信、支付宝、抖音/字节跳动、百度等主流小程序平台。

---

## 工作原理

```
小程序 wx.request()
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

SDK 通过 `/api/relay` 端点中转所有请求，无需在手机上设置 HTTP 代理，与小程序沙箱环境完全兼容。

---

## 快速接入（微信小程序）

### 第一步：配置 proxyflow 服务器

1. 确保 proxyflow 后端服务在运行（默认端口 `9000`）
2. 进入 proxyflow 控制台 → **设备管理** → **添加设备**
3. 填写设备名称（如"开发机-微信"），点击**生成配对码**
4. 记录返回的 `sessionId`

> **网络要求**：小程序和 proxyflow 服务器需在同一局域网，或服务器有公网地址。

### 第二步：配置域名白名单

在微信小程序后台（[mp.weixin.qq.com](https://mp.weixin.qq.com)）：
- **开发** → **开发设置** → **服务器域名** → **request 合法域名**
- 添加你的 proxyflow 服务器地址（生产环境必须为 HTTPS）

开发阶段可在微信开发者工具中勾选 **"不校验合法域名"**（仅限调试）。

### 第三步：引入 SDK

将 `proxyflow-sdk.js` 复制到小程序项目的 `utils/` 目录：

```
miniprogram/
  utils/
    proxyflow-sdk.js    ← 复制到这里
  app.js
  pages/
    ...
```

### 第四步：初始化

在 `app.js` 的 `onLaunch` 中初始化，确保先于任何 `wx.request` 调用：

```javascript
// app.js
const proxyflow = require('./utils/proxyflow-sdk');

App({
  onLaunch() {
    proxyflow.init({
      serverUrl: 'http://192.168.1.100:9000',  // proxyflow 服务器地址
      sessionId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // 设备配对 sessionId
      debug: true,      // 开发阶段建议开启
      autoPatch: true,  // 自动拦截 wx.request
    });
  },
});
```

---

## 使用方式

### 方式一：autoPatch（推荐）

`autoPatch: true` 后，业务代码无需任何修改，所有 `wx.request` 调用自动经过 proxyflow：

```javascript
// 你的页面代码无需修改，wx.request 已被 SDK 接管
wx.request({
  url: 'https://api.example.com/users',
  method: 'GET',
  success(res) {
    console.log(res.data);
    console.log(res.statusCode);
  },
});
```

### 方式二：手动调用 proxyflow.request

无需 `autoPatch`，直接用 `proxyflow.request` 替代 `wx.request`：

```javascript
const proxyflow = require('../../utils/proxyflow-sdk');

proxyflow.request({
  url: 'https://api.example.com/login',
  method: 'POST',
  header: { 'content-type': 'application/json' },
  data: { username: 'test', password: '123' },
  success(res) {
    console.log(res.statusCode, res.data);
  },
  fail(err) {
    console.error(err.errMsg);
  },
});
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
| `autoPatch` | boolean | | 初始化时自动拦截 `wx.request`，默认 `false` |

---

## API 参考

### `proxyflow.init(config)`
初始化 SDK。必须在任何 `request` 调用前执行（建议放在 `app.js` 的 `onLaunch`）。

### `proxyflow.request(options)`
发送 HTTP 请求，与 `wx.request` / `my.request` 接口完全兼容。返回包含 `abort()` 方法的 task 对象。

### `proxyflow.patch()`
拦截平台全局 request 方法（`wx.request` / `my.request` 等）。调用后，所有请求自动经过 proxyflow。

### `proxyflow.unpatch()`
恢复平台原始 request 方法，停止拦截。

### `proxyflow.enable()` / `proxyflow.disable()`
动态启用或禁用 SDK（不影响 patch 状态，只控制是否转发）。

### `proxyflow.getPlatform()`
返回检测到的平台：`'wechat'` | `'alipay'` | `'bytedance'` | `'baidu'` | `'unknown'`

### `proxyflow.getConfig()`
返回当前配置的副本，用于调试。

---

## 支持的平台

| 平台 | 全局对象 | 支持状态 |
|------|----------|----------|
| 微信小程序 | `wx` | ✅ 完全支持 |
| 支付宝小程序 | `my` | ✅ 完全支持 |
| 抖音/字节跳动小程序 | `tt` | ✅ 完全支持 |
| 百度小程序 | `swan` | ✅ 完全支持 |

SDK 自动检测当前运行平台，无需手动配置。

---

## 支付宝小程序接入差异

支付宝小程序使用 `my.request`，请求头字段为 `headers`（而非 `header`）。SDK 已兼容两种写法：

```javascript
// app.js（支付宝）
const proxyflow = require('./utils/proxyflow-sdk');

App({
  onLaunch() {
    proxyflow.init({
      serverUrl: 'http://192.168.1.100:9000',
      sessionId: 'your-session-id',
      autoPatch: true,  // 自动拦截 my.request
    });
  },
});
```

---

## 生产环境建议

```javascript
// app.js
const proxyflow = require('./utils/proxyflow-sdk');
// 微信：非正式版才启用
const isDev = __wxConfig.envVersion !== 'release';

App({
  onLaunch() {
    if (isDev) {
      proxyflow.init({
        serverUrl: 'http://192.168.1.100:9000',
        sessionId: 'your-session-id',
        autoPatch: true,
      });
    }
  },
});
```

---

## 在控制台配置 Mock 规则

接入 SDK 后，所有请求都会出现在 proxyflow 控制台的**请求列表**中。

1. 在控制台找到你想 Mock 的请求
2. 点击该请求 → **创建 Mock 规则**
3. 配置返回的状态码、响应体、延迟时间等
4. 开启规则后，小程序下次发出该请求时将直接返回 Mock 数据

---

## 常见问题

**Q: request 请求域名未在 appid 对应的 request 合法域名列表中**

开发阶段在微信开发者工具中勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。生产部署需要给 proxyflow 配置 HTTPS 并加入白名单。

**Q: 如何只 Mock 部分接口，其他接口还走真实网络？**

在 proxyflow 控制台只为需要 Mock 的接口创建规则并开启，未匹配规则的请求会自动转发到真实服务器。

**Q: 如何临时关闭 proxyflow 而不删除代码？**

```javascript
proxyflow.disable();  // 暂停转发，wx.request 走原始逻辑
proxyflow.enable();   // 重新启用
```

**Q: 多人开发时如何隔离数据？**

每个开发者在控制台创建独立账号，并用各自的 `sessionId` 初始化 SDK，请求日志和 Mock 规则互相隔离。

---

## 文件说明

```
sdk/miniprogram/
├── proxyflow-sdk.js          # SDK 主文件（复制到小程序项目使用）
├── proxyflow-sdk.d.ts        # TypeScript 类型定义
├── package.json
├── README.md                # 本文档
└── examples/
    └── wechat/              # 微信小程序示例
        └── miniprogram/
            ├── app.js       # 初始化示例
            └── pages/index/index.js
```
