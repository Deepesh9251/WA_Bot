module.exports = {
  apps: [
    {
      name: 'wa-link-deleter',
      script: 'src/index.js',

      // Restart on crash with a small delay so we don't hammer WhatsApp
      restart_delay: 5000,      // 5 seconds between restarts
      max_restarts: 10,         // Give up after 10 crashes in a row
      min_uptime: '10s',        // Count as a successful start if alive for 10s

      // Environment — pm2 reads the .env file automatically
      env_file: '.env',

      // Logging & Log Rotation
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      max_size: '10M',
      retain: 5,
      compress: true,
    },
  ],
};
