module.exports = {
  apps: [
    {
      name: 'proxyflow-backend',
      cwd: __dirname + '/backend',
      script: 'dist/index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env_file: __dirname + '/backend/.env',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: __dirname + '/logs/backend-error.log',
      out_file: __dirname + '/logs/backend-out.log',
      merge_logs: true,
    },
    {
      name: 'proxyflow-frontend',
      script: __dirname + '/proxy-server.js',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        FRONTEND_PORT: '3100',
        BACKEND_URL: 'http://127.0.0.1:9000',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: __dirname + '/logs/frontend-error.log',
      out_file: __dirname + '/logs/frontend-out.log',
      merge_logs: true,
    },
  ],
};
