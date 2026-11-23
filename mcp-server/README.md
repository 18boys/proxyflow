# @proxyflow/mcp-server

让 AI 编码助手在开发新接口时，通过 MCP 自行创建/切换 mock，并等待真实请求以获取真实的 request/response 形状。

## 提供的工具

| 工具 | 说明 |
|------|------|
| `upsert_mock` | 按 URL pathname（+可选 method）创建/更新 mock。幂等：已存在则更新规则并新增版本（内容完全相同则复用，不会堆重复版本）。支持 `:id` 路径参数、`version_name` 场景命名、`activate:false` 只存不切换、`condition`（按 query/header/body 字段返回不同 mock）、`from_request_id`（把抓到的真实响应原样存为 mock）。 |
| `toggle_mock` | 开启/关闭 mock。不传 `method` 时作用于该路径的所有规则；找不到时提示先 `upsert_mock`。 |
| `list_mocks` | 列出 mock 规则（精简输出：版本列表 + 当前激活版本），`include_body` 可附带激活版本的响应体。 |
| `switch_mock_version` | 在同一接口的多个场景（成功/空列表/报错…）之间切换激活版本，按 `version_name` 或 `version_id`。 |
| `delete_mock` | 删除某条 mock 规则或单个版本。支持 `rule_id`、`url_pattern`（+ `method`/`condition`/`match_type`）、`version_name`/`version_id`；匹配多条时返回 409 候选列表，需明确 `rule_id`/`condition` 或 `delete_all: true` 才会全删。 |
| `wait_for_request` | 阻塞等待匹配的真实请求经过代理并返回抓包结果。`lookback_ms` 可回溯已发生的请求，`only_real` 忽略被 mock 命中的请求；返回中 `source` 标明 MOCK/REAL，敏感请求头（Authorization/Cookie 等）自动打码，过大的 body 自动截断。 |
| `list_recent_requests` | 最近抓到的请求摘要（id/时间/方法/URL/状态/来源），可按 URL、方法、状态（`404` / `5xx`）过滤。 |
| `get_request` | 按 id 查看单个请求的完整详情（同样打码 + 截断）。 |
| `share_request` | 将某条抓包请求归档为**永久分享链接**（存入独立归档表，不受抓包日志 7 天/1000 条自动清理影响）。支持填 `title`、`note` 记录联调需求上下文，默认对敏感认证头（Authorization/Cookie 等）自动脱敏。 |
| `list_shared_requests` | 查看/搜索自己已归档的永久分享链接列表。 |
| `get_shared_request` | 按 `share_token` 或完整 `/share/<token>` 链接读取永久归档的请求与响应详情。 |
| `authorize` | 查看当前登录状态，或发起浏览器一键授权并自动生成保存本地 Token（支持 `ensure` / `status` / `reauth` / `logout`）。 |
| `get_or_create_session` | 自动获取已有或新建一个设备 `session_id`（附带 `server_url`、`relay_url`、`ws_url` 和 `.env.local` 片段），方便 Agent 直接写入项目 SDK / 代理配置 / 调试后门。 |
| `list_sessions` | 列出当前账号下全部已配对设备及其 `session_id` 与在线状态。 |

> 只有经过 proxyflow（已配对设备的 SDK relay，或带 `x-proxyflow-session` 头的代理请求）的流量才会被 mock / 抓取。
> mock 只按 **pathname** 匹配（忽略域名和 query）；需要按 query/header/body 区分时用 `condition`。
> 多条规则同时命中时的优先级：带 condition > exact > wildcard（`*` 越少越优先） > regex。

## 典型流程

1. 设计好接口 → `upsert_mock` 立刻给前端/客户端一个可用的假数据；
2. 后端写好后 → `toggle_mock enabled=false`，让 App 触发一次真实请求 → `wait_for_request` 看真实结构；
3. `upsert_mock` 带 `from_request_id` 把真实响应存成 mock（或据此微调）；
4. `switch_mock_version` 在成功/空/错误场景间切换，验证客户端各分支；
5. 完成后 `delete_mock` 清理。

## 授权方式（推荐免填 Token）

现在安装 MCP **无需手动配置 `PROXYFLOW_TOKEN`**，只需填 `PROXYFLOW_URL`：
- 首次调用任意 MCP 工具（或调用 `authorize`）时，MCP 会自动打开浏览器跳转到 ProxyFlow 授权页（`/mcp-auth`）；
- 登录并点击「确认授权」后，后端自动生成 API Token，MCP 自动领取并持久化到 `~/.proxyflow/credentials.json`（权限 `0600`），后续永久免登；
- 如果你仍想在无浏览器/CI 环境使用固定 Token，也可以在控制台 Settings → API Tokens 手动生成并配置 `PROXYFLOW_TOKEN` 环境变量。

## 接入方式一：npx（推荐）

已发布到 npm，无需手动 clone/构建，直接在 MCP 客户端配置里用 `npx` 拉起（**无需填 Token**）：

```json
{
  "mcpServers": {
    "proxyflow": {
      "command": "npx",
      "args": ["-y", "@proxyflow/mcp-server"],
      "env": {
        "PROXYFLOW_URL": "http://localhost:3100"
      }
    }
  }
}
```

或使用 Claude Code CLI 添加：

```bash
claude mcp add proxyflow \
  --env PROXYFLOW_URL=http://localhost:3100 \
  -- npx -y @proxyflow/mcp-server
```

`npx` 会自动下载并缓存最新发布的版本，之后每次由 MCP 客户端拉起时无需重复安装。

## 接入方式二：本地构建

适合在本仓库内开发/调试这个 MCP server 本身：

```bash
cd mcp-server
npm install
npm run build
```

配置 MCP 客户端时指向本地构建产物：

```json
{
  "mcpServers": {
    "proxyflow": {
      "command": "node",
      "args": ["/absolute/path/to/proxyflow/mcp-server/dist/index.js"],
      "env": {
        "PROXYFLOW_URL": "http://localhost:9000",
        "PROXYFLOW_TOKEN": "pf_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

或使用 Claude Code CLI 添加：

```bash
claude mcp add proxyflow \
  --env PROXYFLOW_URL=http://localhost:9000 \
  --env PROXYFLOW_TOKEN=pf_xxxxxxxxxxxxxxxxxxxxxxxx \
  -- node /absolute/path/to/proxyflow/mcp-server/dist/index.js
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `PROXYFLOW_URL` | 是 | proxyflow 服务地址，例如 `https://proxyflow.example.com` 或 `http://localhost:3100` |
| `PROXYFLOW_TOKEN` | 否 | 可选；在设置页手动生成的 API Token（`pf_` 开头）。省略时首次使用自动走浏览器一键授权并保存到 `~/.proxyflow/credentials.json` |
| `PROXYFLOW_WEB_URL` | 否 | 前端控制台访问域名（当 `PROXYFLOW_URL` 指向纯后端端口如 `:9000` 时使用），用于拼接授权页与分享页完整链接 |
| `PROXYFLOW_CREDENTIALS_PATH` | 否 | 自定义本地凭证文件路径，默认 `~/.proxyflow/credentials.json` |
| `PROXYFLOW_AUTH_WAIT_MS` | 否 | 发起浏览器授权后单次等待审批的毫秒数，默认 `45000` |

## 测试

`test/e2e.mjs` 通过 stdio 启动构建后的 MCP，对一个运行中的 proxyflow 后端跑全部工具的端到端用例（含边界/故障场景）。
它会注册一个临时用户并创建 mock，**请对测试后端运行，不要指向你的真实库**：

```bash
# 在一份临时拷贝（独立 DB）里起后端：PORT=19000 PROXY_PORT=19001 bun src/index.ts
PROXYFLOW_URL=http://localhost:19000 npm run test:e2e
```

## 发布（维护者）

> ⚠️ 本版本的新工具依赖后端新增的接口，**请先部署后端（`npm run deploy`），再 `npm publish` MCP**。旧版 MCP 连新版后端是兼容的，反之不行。


```bash
cd mcp-server
npm version <patch|minor|major>
npm publish --access public
```

`prepublishOnly` 会在 `npm publish` 前自动执行 `npm run build`，确保 `dist/` 是最新的。
