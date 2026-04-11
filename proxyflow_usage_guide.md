# Proxyflow 使用指南 (React Native)

Proxyflow 是一个专为移动端（特别是 React Native）设计的流量监控与调试平台。通过它，你可以在 Web 端实时监控手机请求、修改接口返回数据（Mock）以及利用 AI 进行错误诊断。

---

## 🌟 核心功能

- **实时流量监控**：在浏览器控制台中实时查看手机发出的所有 HTTP/HTTPS 请求。
- **数据 Mock**：拦截指定接口并返回自定义的 JSON 数据、状态码或模拟网络延迟。
- **设备管理**：通过 Session 会话管理多台测试设备。
- **AI 诊断**：内置 AI 助手，一键分析接口报错原因并给出修复建议。

---

## 📲 接入流程

### 1. 生成 Session ID 并绑定设备
在 Proxyflow 管理后台：
1. **进入设备页**：点击左侧菜单的 **Devices**。
2. **生成配对信息**：
   - 点击右上角的 **"Pair New Device"**。
   - 输入设备名称（例如：`iPhone 15 Pro`）。
   - 点击 **"Generate QR Code"**。
3. **获取参数**：
   - 弹窗底部会显示三个关键参数，请记录备用：
     - **Session ID**: 唯一会话标识。
     - **WSS Endpoint**: WebSocket 地址。
     - **Pairing Token**: 配对令牌。

### 2. 在 React Native 项目中初始化
在你的 RN 项目代码中，使用获取到的参数初始化 SDK：

```javascript
import { Proxyflow } from '@proxyflow/react-native-sdk';

Proxyflow.init({
  sessionId: '你的-SESSION-ID', // 从后台生成的 Session ID
  endpoint: 'ws://your-ip:9000/ws', // WSS Endpoint 地址
  pairingToken: '你的-TOKEN'       // Pairing Token 令牌
});
```

---

## 🔍 查看与分析请求

### 实时查看
- 进入 **Dashboard** 页面。
- 当手机运行 APP 并触发网络请求时，请求会实时出现在列表中。
- 点击任意请求可查看详情：
  - **General**: URL、方法、状态码等。
  - **Headers**: 请求与响应头。
  - **Body**: 发送的参数与返回的响应。

### AI 诊断
- 当发现接口报错（状态码非 200）时，在详情面板点击 **"AI Diagnose"**。
- AI 会自动对比请求参数与响应内容，指出可能的故障原因（如参数格式错误、后端逻辑异常等）。

---

## 🧪 设置 Mock 数据

你可以通过后台强行改变接口的返回值，无需修改任何代码或重启服务：

1. **创建规则**：
   - 进入 **Mock Data** 页面，点击 **"New Rule"**。
   - **URL Pattern**: 输入要拦截的路径（如 `/api/user/info`）。
   - **Method**: 选择 `GET`/`POST` 等。
2. **配置 Mock 内容**：
   - 在规则编辑器中，你可以配置不同的 **Version (场景)**。
   - 自定义 **Response Body** (JSON 内容) 和 **Status Code** (如 500、403)。
3. **启用 Mock**：
   - 保存规则后，确保其处于开启状态。
   - 手机再次发起该请求时，将直接收到你定义的 Mock 数据，请求列表会标记为 `MOCKED`。

---

## 🛡️ 域排除 (Exclusion Domains)

为了保持控制台整洁，你可以排除不需要监控的域名（如第三方统计、日志系统）：
1. 在 **Devices** 页面下方的 **Proxy Exclusion Domains** 部分。
2. 添加域名（例如 `sentry.io` 或 `google-analytics.com`）。
3. 点击 **Save**，这些域名的请求将不再被拦截或显示。
