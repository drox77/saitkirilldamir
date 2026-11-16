import http from 'node:http';
import { once } from 'node:events';

import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export const TEST_TOKEN = '123456789:TEST_ONLY_token_abcdefghijklmnopqrstuvwxyz';
export const CHAT_IDS = ['111111', '222222'];

export const VALID_LEAD = {
  firstName: 'Анна',
  patronymic: 'Сергеевна',
  email: 'anna@example.ru',
  phone: '8 (999) 123-45-67',
  consent: true,
  website: '',
};

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

// Локальная подмена Telegram Bot API: записывает запросы и отвечает по сценарию для каждого chat_id.
export async function startTelegramMock() {
  const requests = [];
  const scripts = new Map();

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ url: req.url, body });

    const reply = scripts.get(String(body.chat_id))?.shift() ?? { status: 200, body: { ok: true, result: {} } };
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });

  return {
    url: await listen(server),
    requests,
    script: (chatId, replies) => scripts.set(chatId, [...replies]),
    reset: () => {
      requests.length = 0;
      scripts.clear();
    },
    close: () => server.close(),
  };
}

export async function startSite(envOverrides = {}, telegramUrl = 'http://127.0.0.1:9') {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: TEST_TOKEN,
    TELEGRAM_CHAT_IDS: CHAT_IDS.join(','),
    CSRF_SECRET: 'test-secret-test-secret-test-secret-test',
    SITE_URL: 'https://dk.example',
    RATE_LIMIT_MAX: '100',
    ...envOverrides,
  });
  config.telegram.apiBase = telegramUrl;

  const app = createApp(config);
  const server = http.createServer(app.handle);
  const url = await listen(server);

  async function csrf() {
    const response = await fetch(`${url}/api/csrf`);
    const { token } = await response.json();
    return { token, cookie: response.headers.get('set-cookie').split(';')[0] };
  }

  async function postLead(lead, { headers = {}, withCsrf = true } = {}) {
    const session = withCsrf ? await csrf() : null;
    const response = await fetch(`${url}/api/lead`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: url,
        ...(session ? { 'x-csrf-token': session.token, cookie: session.cookie } : {}),
        ...headers,
      },
      body: typeof lead === 'string' ? lead : JSON.stringify(lead),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  return {
    url,
    postLead,
    close: () => {
      app.close();
      server.close();
    },
  };
}
