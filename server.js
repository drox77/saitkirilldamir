import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';
import { log } from './src/log.js';

const envFile = path.join(import.meta.dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig(process.env);
for (const warning of config.warnings) log('warn', 'config_warning', { warning });

const app = createApp(config);
const server = http.createServer(app.handle);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(config.port, config.host, () => {
  log('info', 'server_started', { port: config.port, siteUrl: config.siteUrl, telegramReady: config.telegram.ready });
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    app.close();
    server.close(() => process.exit(0));
  });
}
