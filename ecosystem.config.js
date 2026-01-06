/**
 * PM2 配置文件 - 生产模式
 * 只启动 Backend，前端静态文件已编译并包含在 backend/dist/static 中
 * 直接访问 http://0.0.0.0:8081 即可使用完整功能
 */

module.exports = {
  apps: [
    {
      name: 'claude-webui',
      script: 'backend/dist/cli/node.js',
      args: '--host 0.0.0.0 --port 8081 --claude-path /Users/huangjinhui/.claude/local/node_modules/.bin/claude',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '8081',
        PATH: '/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
      },
      env_development: {
        NODE_ENV: 'development',
        DEBUG: 'true',
        PORT: '8081',
        PATH: '/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
      },
      error_file: './logs/webui-error.log',
      out_file: './logs/webui-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // 异常重启配置
      max_restarts: 10,
      min_uptime: '10s',
      exp_backoff_restart_delay: 1000,

      // 锁屏后持续运行配置
      kill_timeout: 30000,
      listen_timeout: 10000,
      shutdown_with_message: true
    }
  ]
};
