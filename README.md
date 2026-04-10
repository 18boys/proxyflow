# Proxyflow

> App Mock & API Proxy Platform — 移动端接口抓包、Mock 与代理平台

## 架构概览

```
proxyflow/
├── backend/     # Express API Server + HTTP 代理服务器
├── frontend/    # React + Vite 控制台界面
└── sdk/         # 各端 SDK（React Native / 小程序）
```

**端口说明：**

| 服务 | 端口 | 说明 |
|------|------|------|
| API Server | 9000 | REST API + WebSocket |
| Proxy Server | 9001 | HTTP 抓包代理 |
| Frontend Dev | 3100 | 仅开发模式使用 |

---

## 开发环境

### 安装依赖

```bash
npm run install:all
```

### 启动开发服务

```bash
npm run dev              # 同时启动 backend + frontend
# 或分别启动
npm run dev:backend
npm run dev:frontend
```

访问控制台：http://localhost:3100

---

## 生产部署

### 前置要求

- Node.js >= 18
- PM2（进程守护）：`npm install -g pm2`

### Step 1：配置环境变量

```bash
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，**必须修改**以下内容：

```ini
PORT=9000
PROXY_PORT=9001
HOST=0.0.0.0

# ⚠️ 改成随机强密码，不要使用默认值
JWT_SECRET=your_super_secure_random_secret_here

# 如需 AI 功能，填入真实 Key
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_REAL_KEY
```

### Step 2：创建日志目录

```bash
mkdir -p logs
```

### Step 3：首次部署

```bash
npm run build        # 编译 backend TypeScript + frontend React
npm run pm2:start    # 用 PM2 启动进程
pm2 save             # 保存进程列表
pm2 startup          # 生成开机自启命令（按提示执行输出的那条命令）
```

### 后续更新部署

```bash
git pull
npm run deploy       # = build + pm2 restart，一键完成
```

---

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发环境（backend + frontend） |
| `npm run build` | 编译 backend + frontend 产物 |
| `npm run build:backend` | 仅编译 backend |
| `npm run build:frontend` | 仅编译 frontend |
| `npm start` | 直接运行编译后的 backend（无守护） |
| `npm run deploy` | 🚀 一键构建并重启 PM2 服务 |
| `npm run pm2:start` | 首次用 PM2 启动（需先 build）|
| `npm run pm2:restart` | 重启 PM2 服务 |
| `npm run pm2:stop` | 停止服务 |
| `npm run pm2:logs` | 查看实时日志 |
| `npm run pm2:status` | 查看所有进程状态 |

---

## 进程守护（PM2）

项目根目录已包含 `ecosystem.config.js`，配置了以下内容：

- 进程名称：`proxyflow-backend`
- 崩溃自动重启
- 内存超过 500MB 自动重启
- 日志输出到 `logs/` 目录

```bash
pm2 list                          # 查看进程状态
pm2 logs proxyflow-backend        # 实时日志
pm2 logs proxyflow-backend --lines 100  # 最近 100 行日志
pm2 monit                         # 实时监控面板
```

---

## 数据库

使用 SQLite，数据库文件位于 `backend/proxyflow.db`，**建议定期备份**：

```bash
cp backend/proxyflow.db backend/proxyflow-backup-$(date +%Y%m%d).db
```

---

## SDK 集成

- React Native：[sdk/react-native/README.md](./sdk/react-native/README.md)
- 微信小程序：[sdk/miniprogram/README.md](./sdk/miniprogram/README.md)
