/**
 * proxyflow-relay.cjs
 * CommonJS 版本：支持 require('@proxyflow/web-sdk/relay')
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Object} options
 * @param {string} options.targetEnv - 真实目标环境，如 'https://qa.example.com'
 * @param {string} options.sessionId - 设备 Session ID（从控制台 Devices 页面获取）
 * @param {string} [options.proxyflowUrl] - Proxyflow 服务地址，默认 'http://172.31.0.8:9000'
 */
async function relayToProxyflow(
  req,
  res,
  {
    targetEnv,
    sessionId = process.env.PROXYFLOW_SESSION_ID,
    proxyflowUrl = process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  } = {}
) {
  if (!sessionId) {
    console.warn('[Proxyflow Relay] 警告: 未提供 sessionId，且 process.env.PROXYFLOW_SESSION_ID 为空。请在 .env.local 中配置 PROXYFLOW_SESSION_ID 或显式传入。');
  }
  const targetUrl = new URL(req.url, targetEnv).toString();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null;

  try {
    const relayRes = await fetch(`${proxyflowUrl.replace(/\/$/, '')}/api/relay`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: req.method,
        url: targetUrl,
        headers: req.headers, // 完整携带浏览器传递的所有请求头与 Cookie
        body,
        sessionId,
      }),
    });

    res.statusCode = relayRes.status;
    relayRes.headers.forEach((val, key) => {
      if (key !== 'transfer-encoding' && key !== 'content-encoding') res.setHeader(key, val);
    });
    const data = await relayRes.arrayBuffer();
    res.end(Buffer.from(data));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Proxyflow relay failed: ${err.message}` }));
  }
}

function proxyflowPlugin({
  targetEnv,
  sessionId = process.env.PROXYFLOW_SESSION_ID,
  proxyflowUrl = process.env.PROXYFLOW_URL || 'http://172.31.0.8:9000',
  prefix = '/api',
} = {}) {
  return {
    name: 'vite-plugin-proxyflow',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith(prefix)) {
          relayToProxyflow(req, res, { targetEnv, sessionId, proxyflowUrl });
        } else {
          next();
        }
      });
    },
  };
}

module.exports = {
  relayToProxyflow,
  proxyflowPlugin,
  default: relayToProxyflow,
};
