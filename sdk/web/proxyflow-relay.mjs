/**
 * proxyflow-relay.mjs
 * 通用 Dev Server / BFF 转发工具：将请求打包转发到 Proxyflow /api/relay
 *
 * 注意：/api/relay 本身永远是 POST（请求体是 JSON 信封），原请求的 method 放在信封里。
 * proxyflow-relay.cjs 与本文件逻辑保持一致，改动时两边同步。
 */

/** 不透传的请求头：由 proxyflow / 目标环境重新决定，透传会出错 */
const DROP_REQUEST_HEADERS = new Set([
  'host', // proxyflow 会改写成目标环境的 host
  'connection',
  'keep-alive',
  'proxy-connection',
  'upgrade',
  'transfer-encoding',
  'content-length', // body 会被重新编码，长度可能变化
  'accept-encoding', // 避免上游返回 gzip/br：旧版 proxyflow 不回传 content-encoding，压缩数据会变成乱码
]);

/** 不回写给浏览器的响应头：fetch 已解压 body，长度由 Node 重新计算 */
const DROP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'connection',
  'keep-alive',
  'set-cookie', // 单独处理，避免多个 Set-Cookie 被合并成一行
]);

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

const DEFAULT_PROXYFLOW_URL = 'http://172.31.0.8:9000';

/**
 * 把 Node 的 IncomingHttpHeaders 转成 { key: string }，并把 origin/referer 改写成目标环境，
 * 避免后端按 localhost 来源做 CSRF / 跨域校验失败。
 */
function buildForwardHeaders(rawHeaders, targetOrigin) {
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders || {})) {
    const lk = key.toLowerCase();
    if (value === undefined || DROP_REQUEST_HEADERS.has(lk)) continue;
    headers[lk] = Array.isArray(value) ? value.join(lk === 'cookie' ? '; ' : ', ') : String(value);
  }
  if (headers.origin) headers.origin = targetOrigin;
  if (headers.referer) {
    try {
      const ref = new URL(headers.referer);
      headers.referer = new URL(ref.pathname + ref.search, targetOrigin).toString();
    } catch {
      delete headers.referer;
    }
  }
  return headers;
}

/**
 * 真实环境下发的 Cookie 通常带 Domain=目标域名，浏览器在 localhost 上会直接丢弃（登录态写不进去）。
 * 去掉 Domain 让 Cookie 落在 dev server 的域名上；dev server 不是 https 时再去掉 Secure，
 * 此时 SameSite=None 必须降级为 Lax，否则浏览器同样会拒收。
 */
function rewriteSetCookie(cookie, secureContext) {
  let parts = cookie
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !/^domain=/i.test(p));
  if (!secureContext) {
    parts = parts
      .filter((p) => !/^secure$/i.test(p))
      .map((p) => (/^samesite=none$/i.test(p) ? 'SameSite=Lax' : p));
  }
  return parts.join('; ');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

function sendJsonError(res, statusCode, message) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message }));
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Object} options
 * @param {string} options.targetEnv - 真实目标环境，如 'https://qa.example.com'
 * @param {string} [options.sessionId] - 设备 Session ID，默认读 process.env.PROXYFLOW_SESSION_ID
 * @param {string} [options.proxyflowUrl] - Proxyflow 服务地址，默认 process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000'
 */
export async function relayToProxyflow(
  req,
  res,
  {
    targetEnv,
    sessionId = process.env.PROXYFLOW_SESSION_ID,
    proxyflowUrl = process.env.PROXYFLOW_URL || DEFAULT_PROXYFLOW_URL,
  } = {}
) {
  if (!targetEnv) {
    sendJsonError(res, 500, '[Proxyflow Relay] targetEnv is required');
    return;
  }
  if (!sessionId) {
    console.warn('[Proxyflow Relay] 警告: 未提供 sessionId，且 process.env.PROXYFLOW_SESSION_ID 为空。请在 .env.local 中配置 PROXYFLOW_SESSION_ID 或显式传入。');
  }

  try {
    const method = (req.method || 'GET').toUpperCase();
    const targetUrl = new URL(req.url, targetEnv);
    const rawBody = await readBody(req);
    // proxyflow 的信封只支持字符串 body：二进制（文件上传等）按 utf8 解码会损坏，见 README
    const body = BODYLESS_METHODS.has(method) || !rawBody ? null : rawBody.toString('utf8');

    const relayRes = await fetch(`${proxyflowUrl.replace(/\/$/, '')}/api/relay`, {
      // 必须是 POST：原请求是 GET/HEAD 时，fetch 不允许带 body，
      // 会直接抛 “Request with GET/HEAD method cannot have body”（1.0.2 及以前的 bug）
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        url: targetUrl.toString(),
        headers: buildForwardHeaders(req.headers, targetUrl.origin),
        body,
        sessionId,
      }),
    });

    res.statusCode = relayRes.status;
    relayRes.headers.forEach((val, key) => {
      if (!DROP_RESPONSE_HEADERS.has(key)) res.setHeader(key, val);
    });
    const secureContext = Boolean(req.socket && req.socket.encrypted);
    const cookies = (typeof relayRes.headers.getSetCookie === 'function' ? relayRes.headers.getSetCookie() : [])
      .map((c) => rewriteSetCookie(c, secureContext));
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);

    const data = Buffer.from(await relayRes.arrayBuffer());
    res.end(method === 'HEAD' ? undefined : data);
  } catch (err) {
    sendJsonError(res, 502, `Proxyflow relay failed: ${err && err.message ? err.message : String(err)}`);
  }
}

/** 默认不转发 multipart / 二进制上传（proxyflow 信封只支持字符串 body），交给下一个中间件（如 server.proxy） */
function defaultSkip(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  return contentType.startsWith('multipart/') || contentType.startsWith('application/octet-stream');
}

/**
 * Vite 插件辅助函数：放在 Vite 配置顶层的 plugins 数组里（不是 server.plugins）
 * @param {Object} options
 * @param {string} options.targetEnv - 真实目标环境
 * @param {string} [options.sessionId] - 设备 Session ID
 * @param {string} [options.proxyflowUrl] - Proxyflow 服务地址
 * @param {string | string[]} [options.prefix] - 拦截的路径前缀，默认 '/api'
 * @param {(req: import('http').IncomingMessage) => boolean} [options.skip] - 返回 true 时不转发，默认跳过 multipart/二进制上传
 */
export function proxyflowPlugin({
  targetEnv,
  sessionId = process.env.PROXYFLOW_SESSION_ID,
  proxyflowUrl = process.env.PROXYFLOW_URL || DEFAULT_PROXYFLOW_URL,
  prefix = '/api',
  skip = defaultSkip,
} = {}) {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  // '/api' 只匹配 /api、/api/xx、/api?x，不误伤 /apixx
  const matches = (url) =>
    prefixes.some((p) => {
      const base = p.replace(/\/$/, '');
      return url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`);
    });

  return {
    name: 'vite-plugin-proxyflow',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !matches(req.url) || (skip && skip(req))) {
          next();
          return;
        }
        relayToProxyflow(req, res, { targetEnv, sessionId, proxyflowUrl }).catch(next);
      });
    },
  };
}

export default relayToProxyflow;
