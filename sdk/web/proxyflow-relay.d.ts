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
  /** 拦截的路径前缀，默认 '/api'；可传数组，如 ['/api', '/op']。'/api' 不会误匹配 '/apixx' */
  prefix?: string | string[];
  /**
   * 返回 true 时不转发，交给下一个中间件（如 Vite 的 server.proxy）。
   * 默认跳过 multipart/form-data 与 application/octet-stream：proxyflow 只支持字符串 body，二进制上传会损坏
   */
  skip?: (req: IncomingMessage) => boolean;
}

/**
 * 通用 Dev Server / BFF 转发函数：将请求打包 POST 到 Proxyflow /api/relay
 */
export function relayToProxyflow(
  req: IncomingMessage,
  res: ServerResponse,
  options: RelayOptions
): Promise<void>;

/**
 * Vite 插件：放在 Vite 配置顶层的 plugins 数组里，仅在 dev server（apply: 'serve'）生效
 */
export function proxyflowPlugin(options: VitePluginOptions): {
  name: string;
  apply: 'serve';
  configureServer: (server: any) => void;
};

export default relayToProxyflow;
