# 让 AI 自己写 Mock 数据：Proxyflow MCP 使用分享

> 分享时长建议：15 分钟讲 + 5 分钟现场演示
> 一句话：**接口还没写好，AI 助手已经替你把 Mock 配好、切好、验证好了；接口写好后，AI 还能自己去抓真实数据回来校对。**

---

## 1. 我们为什么需要它

做移动端 / 小程序联调时，绝大多数人都遇到过：

| 痛点 | 以前 | 现在 |
|---|---|---|
| 后端接口没好，前端/App 干等 | 手写本地 mock 文件，或去控制台一个字段一个字段填 | 告诉 AI「这个接口返回这样」，10 秒后就能调 |
| 想测「空列表 / 报错 / 超时」分支 | 改代码或让后端配合造数据 | 一句话切换场景，App 不用重启、不用改代码 |
| 不知道后端真实返回长啥样 | 抓包 → 复制 → 手动粘成 mock | AI 自己等一次真实请求，原样存成 mock |
| Mock 数据和真实数据慢慢对不上 | 靠人肉对比 | 直接用真实响应生成 |

**核心思路**：Proxyflow 本来就是我们的抓包 + Mock 平台。MCP 把它的能力开放给 AI 编码助手（Claude Code、Cursor 等），
让「写代码的 AI」同时也能「操作 Mock 平台」，整个联调闭环不用离开编辑器。

---

## 2. 它是怎么工作的

```
 ┌──────────────┐  MCP(stdio)   ┌────────────┐   HTTP API    ┌──────────────────┐
 │ AI 编码助手   │ ────────────▶ │ proxyflow  │ ────────────▶ │ Proxyflow 后端    │
 │ (Claude Code)│ ◀──────────── │ MCP Server │ ◀──────────── │ Mock 规则 / 抓包库 │
 └──────────────┘               └────────────┘               └────────┬─────────┘
                                                                      │ 命中 mock 就直接返回
                                   ┌───────────────┐   请求经 SDK/代理    │ 否则转发真实后端并记录
                                   │ 手机 App/小程序 │ ──────────────────▶ │
                                   └───────────────┘
```

- MCP Server 本身很薄：只是把 8 个工具翻译成 Proxyflow 后端的 API 调用，鉴权用 `pf_` 开头的 API Token。
- **只有经过 Proxyflow 的流量才会被 mock / 被抓到**（已配对设备的 SDK，或带 `x-proxyflow-session` 头的代理请求）。

---

## 3. 三分钟接入

**① 生成 Token**：控制台 → Settings → API Tokens (MCP) → 生成（`pf_…` 只显示一次，立即保存）

**② 配置 MCP**（Claude Code 一条命令）：

```bash
claude mcp add proxyflow \
  --env PROXYFLOW_URL=http://你的后端地址:9000 \
  --env PROXYFLOW_TOKEN=pf_xxxxxxxxxxxxxxxx \
  -- npx -y @proxyflow/mcp-server
```

其它客户端（Cursor / Claude Desktop 等）写 JSON：

```json
{ "mcpServers": { "proxyflow": {
  "command": "npx", "args": ["-y", "@proxyflow/mcp-server"],
  "env": { "PROXYFLOW_URL": "http://localhost:9000", "PROXYFLOW_TOKEN": "pf_xxx" }
}}}
```

**③ 手机/模拟器已配对**：Devices 页 → Pair New Device，按 SDK 文档初始化（这是抓包/Mock 生效的前提）。

启动后在 MCP 日志里会看到 `token OK`；如果是 `WARNING: PROXYFLOW_TOKEN was rejected`，说明 Token 有误或已被撤销。

---

## 4. 八个工具速览

| 工具 | 干什么 | 一句话记忆 |
|---|---|---|
| `upsert_mock` | 创建/更新 mock | 「这个接口返回这样」 |
| `toggle_mock` | 开/关 mock | 关掉 = 走真实后端 |
| `list_mocks` | 看有哪些 mock | 精简输出，含版本列表 |
| `switch_mock_version` | 切换场景（成功/空/报错） | 「切到报错场景」 |
| `delete_mock` | 删除 mock | 用完清理 |
| `wait_for_request` | 等一次真实请求并抓回来 | 「等我点一下，看看真实返回」 |
| `list_recent_requests` | 最近请求摘要，可筛 4xx/5xx | 「刚才哪个接口挂了」 |
| `get_request` | 单个请求详情 | 顺藤摸瓜看细节 |

**几个好用的细节**

- 路径参数直接写 `/api/coupons/:id`，自动变成通配。
- 同一接口多个场景：`version_name` 命名，`activate:false` 只存不切换。
- 同一个接口按入参给不同结果：`condition`（按 query / header / body 字段）。
- 想把真实响应存成 mock：`from_request_id`，**原样复制**，不经过 AI 重新抄一遍（不会抄错、不吃 token）。
- 安全：抓回来的 `Authorization` / `Cookie` 等请求头**自动打码**，不会进 AI 的上下文；超大响应体自动截断并提示。

---

## 5. 四个典型场景（直接对 AI 说的话）

### 场景 A：接口还没写，先 Mock 出来
> 「我要做优惠券详情页，接口是 `GET /api/coupons/:id`，返回 id、code、discount。先帮我用 proxyflow mock 一个。」

### 场景 B：测试异常分支
> 「给这个接口再加一个 404 场景 `not-found`，但先别激活。我等下让你切。」
> …（App 里看完正常态）…
> 「切到 not-found。」

### 场景 C：后端好了，抓真实数据校对
> 「后端写好了。把 `/api/coupons/:id` 的 mock 关掉，我在 App 里点一下，你抓一下真实返回，和我们 mock 的字段对比下有没有差异。」

### 场景 D：排查线上/联调报错
> 「刚才 App 报错了，看下最近有没有 5xx 的请求，把那次的请求参数和返回给我。」

---

## 6. 现场演示脚本（5 分钟）

前置：后端已启动、设备已配对、MCP 已接入，编辑器里开一个 AI 会话。

| 步骤 | 你说 | 观众看到 |
|---|---|---|
| 1 | 「用 proxyflow 给 `GET /api/coupons/:id` mock 一个返回 `{id, code:'SAVE10', discount:10}`」 | AI 调 `upsert_mock`；控制台 Mock 页出现规则 |
| 2 | 「再加一个 404 的 `not-found` 场景，先不激活」 | 同一规则下多了一个版本，当前仍是 success |
| 3 | 手机/模拟器请求一次 | 拿到 SAVE10，请求列表标 `MOCKED` |
| 4 | 「切到 not-found」，再请求一次 | App 立刻出现「优惠券不存在」，没改任何代码 |
| 5 | 「把 mock 关掉，等我触发一次真实请求」→ 手机点一下 | AI 调 `toggle_mock` + `wait_for_request`，报出真实响应；Authorization 显示 `[REDACTED]` |
| 6 | 「把这次真实响应存成 mock」 | AI 用 `from_request_id` 存下来，字段和真实完全一致 |

> 💡 演示翻车预案：没有真机时，用 curl 调 relay 接口模拟 App 发请求（`POST /api/relay`，body 里带 `method`、`url`、配对得到的 `sessionId`）；再不行就直接放第 7 节的实测结果。

---

## 7. 我们到底测了什么（结果）

这次对 MCP 做了一轮完整 review + 功能加强 + 实测。

**自动化端到端测试**：`mcp-server/test/e2e.mjs`，通过 stdio 启动真实 MCP，覆盖全部 8 个工具 + 边界/故障场景 → **54 项全部通过**。

**真 AI 实测**（Claude 在只拿到 MCP、没有任何额外提示的情况下完成任务）：

| 任务 | 结果 |
|---|---|
| 建 mock + 加未激活的 404 场景 + 验证 + 切换 + 查抓包 | ✅ 8 轮、约 27 秒；用对了 `:id`、`activate:false`、`switch_mock_version` |
| 关 mock → 等真实请求 → 存成新 mock → 验证 | ✅ 7 轮；自动用了 `lookback_ms` + `only_real`；Authorization 全程未泄露 |

**结论：好用。** 工具描述足够让 AI 一次调对，闭环（Mock → 抓真实 → 固化 → 切场景）能跑通。

### 本轮发现并修复的问题

| # | 问题（修复前） | 影响 | 现状 |
|---|---|---|---|
| 1 | `response_status` 传 `99999` 被接受，之后**第一次命中就让整个后端进程崩溃**（且规则持久化，重启后再崩，PM2 会崩溃循环） | 🔴 严重 | 两层校验（MCP schema + 后端 400）；命中时状态码兜底；加全局 `unhandledRejection` 保护 |
| 2 | 先建 `/api/orders/*` 再建 `/api/orders/42`，精确规则被通配抢走（匹配没有排序） | 🟠 高 | 按优先级排序：condition > exact > wildcard > regex |
| 3 | 重复 upsert 时 `delay_ms` / `match_type` / `name` 被**静默忽略**；相同内容每次都新增一个版本 | 🟠 高 | 更新生效；相同内容复用版本；整个操作放进事务 |
| 4 | `wait_for_request` 把整条原始记录丢给 AI：**Authorization/Cookie 明文进上下文**、大响应撑爆上下文、被 mock 命中的也当作「真实响应」 | 🟠 高 | 自动打码、截断、标注 MOCK/REAL、支持 `only_real`；返回结构化 JSON |
| 5 | `toggle_mock` 不传 method 会 404；`/api/users/:id` 这种写法完全不生效 | 🟡 中 | 不传 method 作用于该路径全部规则；`:id`/`{id}` 自动转通配 |
| 6 | 后端没启动 / Token 失效时，错误信息是一串晦涩异常，fetch 无超时 | 🟡 中 | 明确报错（含地址、修复建议）；15s 超时；启动即校验 Token |
| 7 | 无法切场景、删 mock、看最近请求、把真实响应存成 mock | ✨ 功能缺口 | 新增 4 个工具 + `condition` / `from_request_id` / `lookback_ms` |
| 8 | `.env.example` 端口是 8000/8001，与文档、代码默认的 9000/9001 不一致 | 🟡 中 | 已对齐 |

---

## 8. 注意事项 / 已知限制

1. **只按 pathname 匹配**：忽略域名和 query。同一路径在不同域名下会命中同一个 mock；要区分入参用 `condition`。
2. **只有经过 Proxyflow 的流量才生效**：设备没配对、或域名在 Exclusion Domains 里，就既不 mock 也抓不到。
3. **Token = 你账号的完整权限**（可读全部抓包记录、改所有 mock）：不要提交到仓库，泄露了立即在设置页撤销。抓包里的敏感头会被打码，但**响应体不会**——别让 AI 抓含个人隐私的真实数据后随意外传。
4. `wait_for_request` 最长等 60 秒；若请求可能已经发出，加 `lookback_ms`。
5. 抓包日志每用户保留约 1000 条，超出自动清理。
6. HTTPS 通过 CONNECT 隧道时内容加密、看不到明文（SDK relay 路径不受影响）。
7. 部署上线顺序：**先部署后端，再发布 MCP**（新版 MCP 的新工具依赖后端新接口；旧版 MCP 连新后端是兼容的）。
8. 安全建议（非本次范围，但值得跟进）：生产务必设置强 `JWT_SECRET`（缺省值是写死在代码里的）；API Token 目前没有权限范围区分。

---

## 9. FAQ

**Q：和手动在控制台建 mock 有什么区别？**
A：控制台适合精细调整；MCP 适合「边写代码边要数据」的高频场景，AI 已经知道你的字段设计，不用你再手填一遍。两者操作的是同一份数据，可以混着用。

**Q：AI 会不会乱改我的 mock？**
A：`upsert` 是幂等的，重复调用不会产生重复规则；`delete_mock` 标注为破坏性操作，客户端通常会请你确认；想「停用」用 `toggle_mock` 更安全。

**Q：AI 抓到的数据会不会泄露 Token？**
A：请求头里的 `Authorization` / `Cookie` / `X-Api-Key` 等已自动打码，不会进入 AI 上下文。

**Q：支持哪些 AI 客户端？**
A：任何支持 MCP（stdio）的客户端：Claude Code、Claude Desktop、Cursor、Cline 等。

**Q：为什么 AI 说「没有匹配的请求」？**
A：先排查：设备是否在线并已配对？请求路径是否一致？请求是否已经发出（加 `lookback_ms`）？`list_recent_requests` 可以看到实际经过的请求。

---

## 10. 后续可以做的（欢迎大家提需求）

- 一键从 OpenAPI/Swagger 批量生成 mock；
- 按响应结构做「mock vs 真实」字段差异对比；
- API Token 支持只读 / 只 mock 的权限范围；
- 响应体支持模板（随机 id、时间戳、分页）；
- 支持 SSE / 文件下载等特殊响应。
