/**
 * proxyflow Mini-Program SDK
 *
 * 将小程序的网络请求转发到 proxyflow 服务，实现请求拦截、录制和 Mock 功能。
 *
 * 支持平台:
 *   - 微信小程序  (wx)
 *   - 支付宝小程序 (my)
 *   - 抖音/字节跳动小程序 (tt)
 *   - 百度小程序  (swan)
 *
 * 基本用法:
 *   const proxyflow = require('./proxyflow-sdk');
 *   proxyflow.init({ serverUrl: 'http://192.168.1.100:9000', sessionId: 'xxx' });
 *   proxyflow.patch(); // 自动拦截 wx.request
 */

(function (global, factory) {
  // CommonJS (小程序 require)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    global.proxyflow = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── 内部状态 ─────────────────────────────────────────────────────────────

  var _config = {
    serverUrl: '',
    sessionId: '',
    enabled: true,
    timeout: 30000,
    debug: false,
  };

  // 各平台原始 request 函数备份（patch 后用于还原）
  var _originals = {};

  // 平台检测结果
  var _platform = null;

  // ─── 平台检测 ─────────────────────────────────────────────────────────────

  function detectPlatform() {
    if (_platform) return _platform;
    if (typeof wx !== 'undefined' && wx.request) return (_platform = 'wechat');
    if (typeof my !== 'undefined' && my.request) return (_platform = 'alipay');
    if (typeof tt !== 'undefined' && tt.request) return (_platform = 'bytedance');
    if (typeof swan !== 'undefined' && swan.request) return (_platform = 'baidu');
    return (_platform = 'unknown');
  }

  function getPlatformObject() {
    var p = detectPlatform();
    if (p === 'wechat') return typeof wx !== 'undefined' ? wx : null;
    if (p === 'alipay') return typeof my !== 'undefined' ? my : null;
    if (p === 'bytedance') return typeof tt !== 'undefined' ? tt : null;
    if (p === 'baidu') return typeof swan !== 'undefined' ? swan : null;
    return null;
  }

  // ─── 工具函数 ─────────────────────────────────────────────────────────────

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
   * 将 GET 请求的 data 对象序列化为 query string（不含 ?）
   */
  function objectToQueryString(data) {
    if (!data || typeof data !== 'object') return '';
    var keys = Object.keys(data);
    if (keys.length === 0) return '';
    return keys.map(function (k) {
      return k + '=' + data[k];
    }).join('&');
  }

  /**
   * 如果 url 已含参数则用 & 追加，否则用 ? 追加
   */
  function appendQueryString(url, qs) {
    if (!qs) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + qs;
  }

  /**
   * 将请求 data 序列化为字符串。
   * 微信 wx.request 的 data 可以是 Object / String / ArrayBuffer，
   * 我们统一转为字符串传给 relay。
   */
  function serializeBody(data, method) {
    if (!data) return null;
    if (method && method.toUpperCase() === 'GET') return null;
    if (typeof data === 'string') return data;
    if (typeof data === 'object' && !(data instanceof ArrayBuffer)) {
      try {
        return JSON.stringify(data);
      } catch (e) {
        return String(data);
      }
    }
    return null;
  }

  /**
   * 将 headers 对象的 key 统一转小写
   */
  function normalizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') return {};
    var result = {};
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      result[keys[i].toLowerCase()] = headers[keys[i]];
    }
    return result;
  }

  /**
   * 尝试将字符串解析为 JSON，失败则原样返回
   */
  function tryParseJson(str) {
    if (typeof str !== 'string') return str;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }

  // ─── 核心：通过 relay 发送请求 ────────────────────────────────────────────

  /**
   * 通过 proxyflow relay 端点发送请求。
   * 与 wx.request 签名兼容。
   *
   * @param {object} options
   *   url       {string}   目标 URL（必填）
   *   method    {string}   HTTP 方法，默认 GET
   *   data      {any}      请求体
   *   header    {object}   请求头（微信用 header，支付宝用 headers）
   *   headers   {object}   同上（别名）
   *   success   {Function} 成功回调
   *   fail      {Function} 失败回调
   *   complete  {Function} 完成回调
   *
   * @returns {object} task 对象（包含 abort 方法）
   */
  function relayRequest(options) {
    if (!_config.serverUrl) {
      warn('proxyflow not initialized. Call proxyflow.init() first.');
      var errMsg = 'proxyflow not initialized';
      if (typeof options.fail === 'function') options.fail({ errMsg: errMsg });
      if (typeof options.complete === 'function') options.complete({ errMsg: errMsg });
      return { abort: function () {} };
    }

    var method = (options.method || 'GET').toUpperCase();
    var url = options.url;
    var reqHeaders = normalizeHeaders(options.header || options.headers || {});
    var body = serializeBody(options.data, method);

    // GET 请求：将 data 对象拼接为 query string 追加到 url
    if (method === 'GET' && options.data && typeof options.data === 'object') {
      url = appendQueryString(url, objectToQueryString(options.data));
    }

    // 注入 content-type（若有 body 且未指定）
    if (body && !reqHeaders['content-type']) {
      reqHeaders['content-type'] = 'application/json';
    }

    var relayUrl = _config.serverUrl.replace(/\/$/, '') + '/api/relay?url=' + encodeURIComponent(url);

    log('Relaying', method, url, '→', relayUrl);

    var platformObj = getPlatformObject();
    if (!platformObj) {
      warn('Platform not detected, falling back to direct request');
      // 降级：直接发请求（不经过 proxyflow）
      return _directRequest(options);
    }

    // 用原始 request 发 relay 请求
    // 优先使用 init() 时保存的原始函数，避免使用已被 patch 的版本导致死循环
    var originalFn = _originals[detectPlatform()];
    if (!originalFn) {
      warn('No original request function found. Call proxyflow.init() before making requests.');
      var errMsg = 'proxyflow not initialized properly';
      if (typeof options.fail === 'function') options.fail({ errMsg: errMsg });
      if (typeof options.complete === 'function') options.complete({ errMsg: errMsg });
      return { abort: function () {} };
    }

    var aborted = false;
    var innerTask = null;

    var task = {
      abort: function () {
        aborted = true;
        if (innerTask && typeof innerTask.abort === 'function') innerTask.abort();
      },
    };

    innerTask = originalFn({
      url: relayUrl,
      method: 'POST',
      header: {
        'content-type': 'application/json',
      },
      data: {
        method: method,
        url: url,
        headers: reqHeaders,
        body: body,
        sessionId: _config.sessionId,
      },
      timeout: _config.timeout,
      success: function (relayRes) {
        if (aborted) return;

        // relay 现在直接透传原始响应，statusCode/data/header 即为真实值
        var successRes = {
          data: relayRes.data,
          statusCode: relayRes.statusCode,
          header: relayRes.header || {},
        };

        log(method, url, '→', relayRes.statusCode);

        if (typeof options.success === 'function') options.success(successRes);
        if (typeof options.complete === 'function') options.complete(successRes);
      },
      fail: function (err) {
        if (aborted) return;
        warn('Relay request failed:', err);
        var failRes = { errMsg: err.errMsg || 'relay request failed' };
        if (typeof options.fail === 'function') options.fail(failRes);
        if (typeof options.complete === 'function') options.complete(failRes);
      },
    });

    return task;
  }

  /**
   * 降级：直接用平台原始方法发请求（不经过 proxyflow）
   */
  function _directRequest(options) {
    var p = detectPlatform();
    var platformObj = getPlatformObject();
    if (!platformObj) return { abort: function () {} };
    var origFn = _originals[p] || platformObj.request.bind(platformObj);
    return origFn(options) || { abort: function () {} };
  }

  // ─── Patch / Unpatch ──────────────────────────────────────────────────────

  /**
   * 拦截平台的 request 方法，自动将所有请求通过 proxyflow relay 转发。
   * 调用 unpatch() 可以恢复原始行为。
   */
  function patch() {
    var p = detectPlatform();
    var platformObj = getPlatformObject();
    if (!platformObj) {
      warn('Cannot patch: platform not detected');
      return;
    }
    if (_originals[p]) {
      warn('Already patched');
      return;
    }

    _originals[p] = platformObj.request.bind(platformObj);

    platformObj.request = function (options) {
      if (!_config.enabled) {
        return (_originals[p])(options);
      }
      return relayRequest(options);
    };

    log('Patched ' + p + '.request');
  }

  /**
   * 还原平台的原始 request 方法。
   */
  function unpatch() {
    var p = detectPlatform();
    var platformObj = getPlatformObject();
    if (!platformObj || !_originals[p]) return;
    platformObj.request = _originals[p];
    delete _originals[p];
    log('Unpatched ' + p + '.request');
  }

  // ─── 公共 API ─────────────────────────────────────────────────────────────

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
     *   autoPatch  {boolean} 自动拦截平台 request，默认 false
     */
    init: function (config) {
      if (!config.serverUrl) throw new Error('proxyflow.init: serverUrl is required');
      if (!config.sessionId) throw new Error('proxyflow.init: sessionId is required');

      _config.serverUrl = config.serverUrl.replace(/\/$/, '');
      _config.sessionId = config.sessionId;
      if (typeof config.enabled !== 'undefined') _config.enabled = !!config.enabled;
      if (typeof config.timeout === 'number') _config.timeout = config.timeout;
      if (typeof config.debug !== 'undefined') _config.debug = !!config.debug;

      // Capture the original platform request NOW, before any patching occurs.
      // This prevents infinite loops when relayRequest falls back to platformObj.request
      // which might already be patched (e.g. wx.request = proxyflow.request).
      var p = detectPlatform();
      var platformObj = getPlatformObject();
      if (platformObj && !_originals[p]) {
        _originals[p] = platformObj.request.bind(platformObj);
      }

      log('Initialized. serverUrl=' + _config.serverUrl + ', sessionId=' + _config.sessionId);
      log('Platform detected:', p);

      if (config.autoPatch) {
        patch();
      }
    },

    /**
     * 发送请求（与 wx.request 接口兼容）。
     * 不需要先调用 patch()，可直接替换 wx.request 使用。
     */
    request: relayRequest,

    /**
     * 拦截平台全局 request 方法（wx.request / my.request 等），
     * 所有请求自动通过 proxyflow 转发。
     */
    patch: patch,

    /**
     * 恢复平台原始 request 方法。
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

    /**
     * 返回检测到的小程序平台名称。
     */
    getPlatform: detectPlatform,

    version: '1.0.0',
  };

  return proxyflow;
});
