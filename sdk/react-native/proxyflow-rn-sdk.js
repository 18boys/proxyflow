/**
 * proxyflow React Native SDK
 *
 * 将 React Native 的 fetch 请求转发到 proxyflow 服务，实现请求拦截、录制和 Mock 功能。
 *
 * 基本用法:
 *   import proxyflow from 'proxyflow-react-native';
 *   proxyflow.init({ serverUrl: 'http://192.168.1.100:9000', sessionId: 'xxx' });
 *   proxyflow.patch(); // 自动拦截全局 fetch
 */

'use strict';

// ─── 内部状态 ─────────────────────────────────────────────────────────────────

var _config = {
  serverUrl: '',
  sessionId: '',
  enabled: true,
  timeout: 30000,
  debug: false,
};

/** 保存原始 fetch，patch 后用于还原 */
var _originalFetch = null;
var _patched = false;

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function log() {
  if (_config.debug) {
    var args = ['[proxyflow]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  }
}

function warn() {
  var args = ['[proxyflow]'].concat(Array.prototype.slice.call(arguments));
  console.warn.apply(console, args);
}

/**
 * 将各种格式的 headers（Headers 实例 / 二维数组 / 普通对象）统一转为小写 key 的普通对象
 */
function normalizeHeaders(headers) {
  if (!headers) return {};
  var result = {};

  // Headers 实例（RN 原生 fetch 支持）
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach(function (value, key) {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  // 二维数组 [['key', 'value'], ...]
  if (Array.isArray(headers)) {
    headers.forEach(function (pair) {
      if (pair && pair.length >= 2) {
        result[pair[0].toLowerCase()] = pair[1];
      }
    });
    return result;
  }

  // 普通对象
  if (typeof headers === 'object') {
    Object.keys(headers).forEach(function (key) {
      result[key.toLowerCase()] = headers[key];
    });
  }

  return result;
}

/**
 * 从 RequestInfo | URL | string 中提取 URL 字符串
 */
function extractUrl(input) {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  // Request 对象
  if (input && typeof input.url === 'string') return input.url;
  return String(input);
}

/**
 * 从 RequestInfo | URL | string 中提取初始化参数（method / headers / body）
 * 合并 init（init 优先）
 */
function mergeRequestInit(input, init) {
  var merged = {};

  // 如果 input 是 Request 对象，先从中读取
  if (input && typeof input === 'object' && typeof input.url === 'string') {
    merged.method = input.method;
    merged.headers = input.headers;
    merged.body = input.body;
  }

  if (init) {
    if (init.method) merged.method = init.method;
    if (init.headers) merged.headers = init.headers;
    if (typeof init.body !== 'undefined') merged.body = init.body;
  }

  return merged;
}

// ─── 核心：relay fetch ────────────────────────────────────────────────────────

/**
 * 拦截 fetch 调用，通过 proxyflow relay 端点中转请求。
 * 返回标准 Response 对象，对调用方完全透明。
 */
function relayFetch(input, init) {
  if (!_config.serverUrl) {
    warn('proxyflow not initialized. Call proxyflow.init() first.');
    return (_originalFetch || globalThis.fetch).call(globalThis, input, init);
  }

  var merged = mergeRequestInit(input, init);
  var method = (merged.method || 'GET').toUpperCase();
  var url = extractUrl(input);
  var reqHeaders = normalizeHeaders(merged.headers);

  // FormData 无法序列化为 JSON，直接走原始 fetch
  if (merged.body instanceof FormData) {
    log('FormData detected, falling back to direct request for', url);
    return (_originalFetch || globalThis.fetch).call(globalThis, input, init);
  }

  var body = null;
  if (method !== 'GET' && method !== 'HEAD' && merged.body != null) {
    if (typeof merged.body === 'string') {
      body = merged.body;
    } else {
      try {
        body = JSON.stringify(merged.body);
      } catch (e) {
        body = String(merged.body);
      }
    }
  }

  // 注入 content-type（若有 body 且未指定）
  if (body && !reqHeaders['content-type']) {
    reqHeaders['content-type'] = 'application/json';
  }

  var relayUrl = _config.serverUrl.replace(/\/$/, '') + '/api/relay?url=' + encodeURIComponent(url);
  log('Relaying', method, url, '→', relayUrl);

  var originalFetch = _originalFetch || globalThis.fetch;

  // 超时控制
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, _config.timeout);

  return originalFetch.call(globalThis, relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: method,
      url: url,
      headers: reqHeaders,
      body: body,
      sessionId: _config.sessionId,
    }),
    signal: controller.signal,
  }).then(function (relayResponse) {
    clearTimeout(timeoutId);
    // relay 现在直接透传原始响应（status + headers + body），直接返回即可
    log(method, url, '→', relayResponse.status);
    return relayResponse;
  }).catch(function (err) {
    clearTimeout(timeoutId);
    warn('Relay request failed:', err);
    throw err;
  });
}

// ─── Patch / Unpatch ──────────────────────────────────────────────────────────

/**
 * 拦截全局 fetch，所有请求自动通过 proxyflow relay 转发。
 * 调用 unpatch() 可恢复原始 fetch。
 */
function patch() {
  if (_patched) {
    warn('Already patched');
    return;
  }
  if (typeof globalThis.fetch !== 'function') {
    warn('Cannot patch: global fetch is not available');
    return;
  }

  _originalFetch = globalThis.fetch;

  globalThis.fetch = function (input, init) {
    if (!_config.enabled) {
      return _originalFetch.call(globalThis, input, init);
    }
    return relayFetch(input, init);
  };

  _patched = true;
  log('Patched global.fetch');
}

/**
 * 还原原始 fetch。
 */
function unpatch() {
  if (!_patched || !_originalFetch) return;
  globalThis.fetch = _originalFetch;
  _originalFetch = null;
  _patched = false;
  log('Unpatched global.fetch');
}

// ─── 公共 API ─────────────────────────────────────────────────────────────────

var proxyflow = {

  /**
   * 初始化 SDK
   *
   * @param {object} config
   *   serverUrl  {string}  proxyflow 后端地址，如 "http://192.168.1.100:9000"（必填）
   *   sessionId  {string}  设备 session ID，从 proxyflow 控制台扫码配对获取（必填）
   *   enabled    {boolean} 是否启用，默认 true
   *   timeout    {number}  请求超时毫秒，默认 30000
   *   debug      {boolean} 打印调试日志，默认 false
   *   autoPatch  {boolean} 自动拦截全局 fetch，默认 false
   */
  init: function (config) {
    if (!config.serverUrl) throw new Error('proxyflow.init: serverUrl is required');
    if (!config.sessionId) throw new Error('proxyflow.init: sessionId is required');

    _config.serverUrl = config.serverUrl.replace(/\/$/, '');
    _config.sessionId = config.sessionId;
    if (typeof config.enabled !== 'undefined') _config.enabled = !!config.enabled;
    if (typeof config.timeout === 'number') _config.timeout = config.timeout;
    if (typeof config.debug !== 'undefined') _config.debug = !!config.debug;

    // Capture the original fetch NOW, before autoPatch can overwrite it.
    // This prevents infinite loops when relayFetch falls back to globalThis.fetch
    // which might already be patched.
    if (!_originalFetch && typeof globalThis.fetch === 'function') {
      _originalFetch = globalThis.fetch;
    }

    log('Initialized. serverUrl=' + _config.serverUrl + ', sessionId=' + _config.sessionId);

    if (config.autoPatch) {
      patch();
    }
  },

  /**
   * 直接发送一个经过 proxyflow relay 的 fetch 请求。
   * 不需要先调用 patch()，可直接替代 fetch 使用。
   */
  fetch: relayFetch,

  /**
   * 拦截全局 fetch，所有请求自动通过 proxyflow 转发。
   */
  patch: patch,

  /**
   * 恢复原始 fetch。
   */
  unpatch: unpatch,

  /**
   * 启用/禁用 SDK（不影响 patch 状态，只控制是否转发）。
   */
  enable: function () { _config.enabled = true; log('Enabled'); },
  disable: function () { _config.enabled = false; log('Disabled'); },

  /**
   * 返回当前配置的副本（用于调试）。
   */
  getConfig: function () {
    return Object.assign({}, _config);
  },

  version: '1.0.0',
};

module.exports = proxyflow;
module.exports.default = proxyflow;
