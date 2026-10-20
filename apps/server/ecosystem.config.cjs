module.exports = {
  apps: [
    {
      name: 'omnis',
      cwd: __dirname,
      script: 'dist/index.js',
      node_args: '--env-file=.env',
      max_memory_restart: '200M',
      kill_timeout: 10000,
      autorestart: true,
    },
  ],
};
