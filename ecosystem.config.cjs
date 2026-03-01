// pm2 生产环境配置
module.exports = {
  apps: [{
    name: 'webot',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    env: {
      NODE_ENV: 'production',
    },
  }],
}
