import type { IncomingMessage, ServerResponse } from 'http';

export interface RelayOptions {
  /** 真实目标环境，如 'https://qa.example.com' */
  targetEnv: string;
  /** 设备 Session ID（默认读取 process.env.PROXYFLOW_SESSION_ID，可从控制台 Devices 页面获取） */
  sessionId?: string;
  /** Proxyflow 后端地址，默认 process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000' */
  proxyflowUrl?: string;
}

export interface VitePluginOptions extends RelayOptions {
  /** 拦截的前缀路径，默认 '/api' */
  prefix?: string;
}

/**
 * 通用 Dev Server / BFF 转发函数：将请求打包转发到 Proxyflow /api/relay
 */
export function relayToProxyflow(
  req: IncomingMessage,
  res: ServerResponse,
  options: RelayOptions
): Promise<void>;

/**
 * Vite 插件：一行集成 Proxyflow 转发中间件
 */
export function proxyflowPlugin(options: VitePluginOptions): {
  name: string;
  configureServer: (server: any) => void;
};

export default relayToProxyflow;
