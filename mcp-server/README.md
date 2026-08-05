# @proxyflow/mcp-server

让 AI 编码助手在开发新接口时，通过 MCP 自行创建/切换 mock，并等待真实请求以获取真实的 request/response 形状。

## 提供的工具

| 工具 | 说明 |
|------|------|
| `upsert_mock` | 按 URL pathname（+可选 method）创建或更新一个 mock。已存在时新增一个版本并设为激活版本，不会产生重复规则。 |
| `toggle_mock` | 按 URL pathname（+可选 method）开启/关闭一个已存在的 mock。找不到规则时会提示先调用 `upsert_mock`。 |
| `list_mocks` | 列出当前用户的所有 mock 规则（含版本列表与当前激活版本）。 |
| `wait_for_request` | 阻塞等待下一个匹配该 URL pathname（+可选 method）的真实请求经过代理，返回其抓包结果。适合在关闭 mock 后，触发一次真实调用来获取真实响应结构。 |

## 获取 Token

登录 proxyflow 控制台 → 设置页 → "API Tokens (MCP)" 卡片 → 生成新 Token（`pf_` 开头，仅显示一次，请立即保存）。

## 接入方式一：npx（推荐）

已发布到 npm，无需手动 clone/构建，直接在 MCP 客户端配置里用 `npx` 拉起：

```json
{
  "mcpServers": {
    "proxyflow": {
      "command": "npx",
      "args": ["-y", "@proxyflow/mcp-server"],
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
| `PROXYFLOW_URL` | 是 | proxyflow 后端地址，例如 `http://localhost:9000` |
| `PROXYFLOW_TOKEN` | 是 | 在设置页生成的 API Token，`pf_` 开头 |

## 发布（维护者）

```bash
cd mcp-server
npm version <patch|minor|major>
npm publish --access public
```

`prepublishOnly` 会在 `npm publish` 前自动执行 `npm run build`，确保 `dist/` 是最新的。
