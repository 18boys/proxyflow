/**
 * proxyflow React Native SDK — TypeScript 类型定义
 */

export interface proxyflowConfig {
  /** proxyflow 后端地址，如 "http://192.168.1.100:9000" */
  serverUrl: string;
  /** 设备 session ID，从 proxyflow 控制台扫码配对获取 */
  sessionId: string;
  /** 是否启用 SDK，默认 true */
  enabled?: boolean;
  /** 请求超时毫秒，默认 30000 */
  timeout?: number;
  /** 打印调试日志，默认 false */
  debug?: boolean;
  /** 初始化时自动 patch 全局 fetch，默认 false */
  autoPatch?: boolean;
}

export interface proxyflowRNSDK {
  readonly version: string;

  /**
   * 初始化 SDK，必须在任何请求调用前执行。
   * 推荐在 app/_layout.tsx 的顶层调用。
   */
  init(config: proxyflowConfig): void;

  /**
   * 发送经过 proxyflow relay 的 fetch 请求。
   * 与原生 fetch 签名完全兼容。
   * 响应头中会包含：
   *   x-proxyflow-is-mocked: 'true' | 'false'
   *   x-proxyflow-duration-ms: 请求耗时（毫秒）
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  /**
   * 拦截全局 fetch。
   * 调用后，所有 fetch 调用都会自动经过 proxyflow。
   */
  patch(): void;

  /**
   * 恢复原始 fetch。
   */
  unpatch(): void;

  /** 启用 SDK（默认已启用）。*/
  enable(): void;

  /** 禁用 SDK（fetch 请求会直接使用原始方法）。*/
  disable(): void;

  /** 返回当前配置副本。*/
  getConfig(): Required<proxyflowConfig>;
}

declare const proxyflow: proxyflowRNSDK;
export default proxyflow;
