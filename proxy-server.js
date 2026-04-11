/**
 * proxyflow 前端代理服务器
 * - 监听端口 3100
 * - /api/* 和 /ws/* 转发到后端 9000
 * - 其余请求服务 frontend/dist 静态文件（SPA 回退到 index.html）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const LISTEN_PORT = parseInt(process.env.FRONTEND_PORT || '3100');
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:9000';
const STATIC_DIR = path.join(__dirname, 'frontend/dist');

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json',
};

// 静态文件处理
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  let filePath = path.join(STATIC_DIR, urlPath);

  // 安全检查：防止路径穿越
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // 尝试读取文件
  function tryFile(fp, fallbackToIndex) {
    fs.stat(fp, (err, stat) => {
      if (!err && stat.isDirectory()) {
        tryFile(path.join(fp, 'index.html'), fallbackToIndex);
        return;
      }
      if (err || !stat.isFile()) {
        if (fallbackToIndex) {
          // SPA 回退：返回 index.html
          fs.readFile(path.join(STATIC_DIR, 'index.html'), (e, data) => {
            if (e) {
              res.writeHead(404);
              res.end('Not Found');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(data);
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
        return;
      }
      const ext = path.extname(fp).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
      });
      fs.createReadStream(fp).pipe(res);
    });
  }

  tryFile(filePath, true);
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // /api/* → 后端
  if (url.startsWith('/api/') || url.startsWith('/health')) {
    const options = {
      hostname: '127.0.0.1',
      port: 9000,
      path: url,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[proxy] backend error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend unavailable', detail: err.message }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 静态文件服务
  serveStatic(req, res);
});

// WebSocket 升级代理
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/ws')) {
    const net = require('net');
    const backendSocket = net.connect(9000, '127.0.0.1', () => {
      backendSocket.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n'
      );
      backendSocket.write(head);
      socket.pipe(backendSocket);
      backendSocket.pipe(socket);
    });
    backendSocket.on('error', (err) => {
      console.error('[ws-proxy] error:', err.message);
      socket.destroy();
    });
    socket.on('error', () => backendSocket.destroy());
  } else {
    socket.destroy();
  }
});

server.listen(LISTEN_PORT, () => {
  console.log(`✅ proxyflow 前端代理服务器启动 http://localhost:${LISTEN_PORT}`);
  console.log(`   静态文件: ${STATIC_DIR}`);
  console.log(`   API 代理: /api/* → ${BACKEND_URL}`);
  console.log(`   WS  代理: /ws/*  → ${BACKEND_URL.replace('http', 'ws')}`);
});
