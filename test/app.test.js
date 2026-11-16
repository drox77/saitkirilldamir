import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { CHAT_IDS, startSite, startTelegramMock, TEST_TOKEN, VALID_LEAD } from './helpers.js';

process.env.LOG_LEVEL = 'silent';

let telegram;
let site;

before(async () => {
  telegram = await startTelegramMock();
  site = await startSite({}, telegram.url);
});

after(() => {
  site.close();
  telegram.close();
});

beforeEach(() => telegram.reset());

const lead = (email) => ({ ...VALID_LEAD, email });

test('главная отдаётся с заголовками безопасности и подставленным адресом сайта', async () => {
  const response = await fetch(`${site.url}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.ok(html.includes('<link rel="canonical" href="https://dk.example/">'));
  assert.ok(!html.includes('{{'));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(!html.includes(TEST_TOKEN));
});

test('версионированная статика кэшируется надолго, сжимается и отдаёт 304', async () => {
  const html = await (await fetch(`${site.url}/`)).text();
  const cssPath = html.match(/href="(\/css\/styles\.css\?v=[0-9a-f]+)"/)[1];

  const css = await fetch(`${site.url}${cssPath}`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(css.headers.get('content-encoding'), 'br');

  const cached = await fetch(`${site.url}${cssPath}`, { headers: { 'if-none-match': css.headers.get('etag') } });
  assert.equal(cached.status, 304);
});

test('robots.txt и sitemap.xml строятся от SITE_URL', async () => {
  const robots = await (await fetch(`${site.url}/robots.txt`)).text();
  const sitemap = await (await fetch(`${site.url}/sitemap.xml`)).text();
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/dk\.example\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/dk\.example\/<\/loc>/);
});

test('несуществующие пути и попытки выйти из public дают 404', async () => {
  for (const path of ['/nope', '/../server.js', '/%2e%2e/server.js', '/js/../../.env', '/.env']) {
    const response = await fetch(`${site.url}${path}`);
    assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes('createApp'));
  }
});

test('заявка уходит обоим получателям отдельными запросами', async () => {
  const { status, body } = await site.postLead(lead('both@example.ru'));

  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.deepEqual(telegram.requests.map((request) => String(request.body.chat_id)).sort(), CHAT_IDS);
  for (const request of telegram.requests) {
    assert.equal(request.url, `/bot${TEST_TOKEN}/sendMessage`);
    assert.equal(
      request.body.text,
      'НОВАЯ ЗАЯВКА С САЙТА\n\nИмя: Анна\nОтчество: Сергеевна\nEmail: both@example.ru\nТелефон: +7 (999) 123-45-67\nИсточник: Сайт агентства',
    );
  }
});

test('повторная отправка тех же данных не дублирует сообщения', async () => {
  await site.postLead(lead('twice@example.ru'));
  const second = await site.postLead(lead('twice@example.ru'));

  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(telegram.requests.length, 2);
});

test('одновременные одинаковые заявки доставляются один раз', async () => {
  const results = await Promise.all([site.postLead(lead('race@example.ru')), site.postLead(lead('race@example.ru'))]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(telegram.requests.length, 2);
});

test('успех только после ok: true от обоих; повтор досылает лишь недоставленному', async () => {
  telegram.script(CHAT_IDS[1], [{ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }]);

  const failed = await site.postLead(lead('partial@example.ru'));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.ok, false);
  assert.ok(!JSON.stringify(failed.body).includes('Forbidden'));

  telegram.requests.length = 0;
  const retried = await site.postLead(lead('partial@example.ru'));
  assert.equal(retried.status, 200);
  assert.deepEqual(telegram.requests.map((request) => String(request.body.chat_id)), [CHAT_IDS[1]]);
});

test('HTTP 200 с ok: false не считается успехом', async () => {
  telegram.script(CHAT_IDS[0], [{ status: 200, body: { ok: false } }]);
  const { status } = await site.postLead(lead('notok@example.ru'));
  assert.equal(status, 502);
});

test('временная ошибка Telegram повторяется и заканчивается успехом', async () => {
  telegram.script(CHAT_IDS[0], [
    { status: 500, body: { ok: false } },
    { status: 429, body: { ok: false, parameters: { retry_after: 0 } } },
  ]);
  const { status } = await site.postLead(lead('retry@example.ru'));
  assert.equal(status, 200);
  assert.equal(telegram.requests.filter((request) => String(request.body.chat_id) === CHAT_IDS[0]).length, 3);
});

test('число повторов ограничено', async () => {
  telegram.script(CHAT_IDS[0], Array.from({ length: 10 }, () => ({ status: 500, body: { ok: false } })));
  const { status } = await site.postLead(lead('limit@example.ru'));
  assert.equal(status, 502);
  assert.equal(telegram.requests.filter((request) => String(request.body.chat_id) === CHAT_IDS[0]).length, 3);
});

test('некорректные поля возвращают ошибки по каждому полю и ничего не отправляют', async () => {
  const { status, body } = await site.postLead({ ...VALID_LEAD, email: 'not-an-email', phone: '123', consent: false });
  assert.equal(status, 422);
  assert.deepEqual(Object.keys(body.errors).sort(), ['consent', 'email', 'phone']);
  assert.equal(telegram.requests.length, 0);
});

test('запрос без CSRF-токена, с чужим Origin или без него отклоняется', async () => {
  assert.equal((await site.postLead(lead('csrf@example.ru'), { withCsrf: false })).status, 403);
  assert.equal((await site.postLead(lead('csrf@example.ru'), { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await site.postLead(lead('csrf@example.ru'), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await site.postLead(lead('csrf@example.ru'), { headers: { 'x-csrf-token': 'forged.token' } })).status, 403);
  assert.equal(telegram.requests.length, 0);
});

test('заполненное поле-ловушка не приводит к отправке', async () => {
  const { status } = await site.postLead({ ...lead('bot@example.ru'), website: 'https://spam.example' });
  assert.equal(status, 200);
  assert.equal(telegram.requests.length, 0);
});

test('слишком большое тело, не-JSON и неверный метод отклоняются', async () => {
  assert.equal((await site.postLead({ ...VALID_LEAD, firstName: 'я'.repeat(9000) })).status, 413);
  assert.equal((await site.postLead('{broken')).status, 400);
  assert.equal((await site.postLead(VALID_LEAD, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(`${site.url}/api/lead`)).status, 405);
  assert.equal((await fetch(`${site.url}/`, { method: 'DELETE' })).status, 405);
});

test('лимит заявок с одного IP', async () => {
  const limited = await startSite({ RATE_LIMIT_MAX: '2' }, telegram.url);
  try {
    assert.equal((await limited.postLead(lead('rl1@example.ru'))).status, 200);
    assert.equal((await limited.postLead(lead('rl2@example.ru'))).status, 200);
    const blocked = await limited.postLead(lead('rl3@example.ru'));
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally {
    limited.close();
  }
});

test('без настроенного Telegram форма отвечает 503, а не имитирует успех', async () => {
  const unconfigured = await startSite({ TELEGRAM_BOT_TOKEN: '' }, telegram.url);
  try {
    const { status, body } = await unconfigured.postLead(lead('noconfig@example.ru'));
    assert.equal(status, 503);
    assert.equal(body.ok, false);
  } finally {
    unconfigured.close();
  }
});

test('в логи не попадают токен и данные заявителя', async () => {
  const written = [];
  const originals = [process.stdout.write, process.stderr.write];
  process.stdout.write = (chunk) => written.push(String(chunk));
  process.stderr.write = (chunk) => written.push(String(chunk));
  process.env.LOG_LEVEL = 'info';

  const offline = await startSite({}, 'http://127.0.0.1:9');
  try {
    telegram.script(CHAT_IDS[0], [{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }]);
    await site.postLead(lead('logs@example.ru'));
    await site.postLead(lead('logs-ok@example.ru'));
    await offline.postLead(lead('offline@example.ru'));
  } finally {
    offline.close();
    [process.stdout.write, process.stderr.write] = originals;
    process.env.LOG_LEVEL = 'silent';
  }

  const logs = written.join('');
  assert.match(logs, /telegram_send_failed/);
  assert.match(logs, /lead_delivered/);
  for (const secret of [TEST_TOKEN, 'example.ru', '999', 'Анна', 'Сергеевна', ...CHAT_IDS]) {
    assert.ok(!logs.includes(secret), `в логах найдено: ${secret}`);
  }
});
