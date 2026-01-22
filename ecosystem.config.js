module.exports = {
  apps: [{
    name: 'na-forays-schedule',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 5000,
    min_uptime: 10000,
    max_restarts: 10,
    exp_backoff_restart_delay: 100
  }]
};
