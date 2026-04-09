/**
 * proxyflow Mini-Program SDK — TypeScript 类型定义
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
  /** 初始化时自动 patch 全局 request，默认 false */
  autoPatch?: boolean;
}

export interface RequestTask {
  abort(): void;
}

export interface RequestSuccessResponse<T = any> {
  data: T;
  statusCode: number;
  header: Record<string, string>;
  /** proxyflow 附加信息 */
  _proxyflow?: {
    isMocked: boolean;
    durationMs: number;
  };
}

export interface RequestOptions<T = any> {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  data?: string | object | ArrayBuffer;
  header?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  success?: (res: RequestSuccessResponse<T>) => void;
  fail?: (err: { errMsg: string }) => void;
  complete?: (res: RequestSuccessResponse<T> | { errMsg: string }) => void;
}

export interface proxyflowSDK {
  readonly version: string;

  /**
   * 初始化 SDK，必须在任何 request 调用前执行。
   */
  init(config: proxyflowConfig): void;

  /**
   * 发送 HTTP 请求（与 wx.request / my.request 接口兼容）。
   * 请求会经过 proxyflow relay 端点，支持 Mock 规则和请求录制。
   */
  request<T = any>(options: RequestOptions<T>): RequestTask;

  /**
   * 拦截平台全局 request 方法（wx.request / my.request 等）。
   * 调用后，所有 wx.request 调用都会自动经过 proxyflow。
   */
  patch(): void;

  /**
   * 恢复平台原始 request 方法。
   */
  unpatch(): void;

  /** 启用 SDK（默认已启用）。*/
  enable(): void;

  /** 禁用 SDK（请求会直接使用原始方法）。*/
  disable(): void;

  /** 返回当前配置。*/
  getConfig(): Required<proxyflowConfig>;

  /** 返回检测到的平台名称。*/
  getPlatform(): 'wechat' | 'alipay' | 'bytedance' | 'baidu' | 'unknown';
}

declare const proxyflow: proxyflowSDK;
export default proxyflow;
