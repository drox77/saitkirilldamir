import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizePhone, validateLead } from '../public/js/lead-rules.js';
import { issueToken, verifyToken, TOKEN_TTL_MS } from '../src/csrf.js';
import { createLedger } from '../src/ledger.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { formatLead } from '../src/telegram.js';
import { VALID_LEAD } from './helpers.js';

test('телефон приводится к единому формату', () => {
  for (const raw of ['89991234567', '+7 999 123-45-67', '9991234567', '+7 (999) 123-45-67', '7 999 1234567']) {
    assert.equal(normalizePhone(raw), '+7 (999) 123-45-67', raw);
  }
});

test('некорректные телефоны отклоняются', () => {
  for (const raw of ['', '12345', '+7 999 123-45-6', '+1 202 555 0147', '+7 (099) 123-45-67', '899912345678', null, 79991234567]) {
    assert.equal(normalizePhone(raw), null, String(raw));
  }
});

test('корректная заявка проходит и нормализуется', () => {
  const { valid, values, errors } = validateLead({ ...VALID_LEAD, firstName: '  анна-мария  ', email: ' Anna@Example.RU ' });
  assert.equal(valid, true, JSON.stringify(errors));
  assert.deepEqual(values, {
    firstName: 'анна-мария',
    patronymic: 'Сергеевна',
    email: 'anna@example.ru',
    phone: '+7 (999) 123-45-67',
  });
});

test('каждое обязательное поле проверяется', () => {
  const { valid, errors } = validateLead({});
  assert.equal(valid, false);
  assert.deepEqual(Object.keys(errors).sort(), ['consent', 'email', 'firstName', 'patronymic', 'phone']);
});

test('имя и email с недопустимым содержимым отклоняются', () => {
  const cases = [
    { firstName: 'A' },
    { firstName: '<script>alert(1)</script>' },
    { firstName: 'Анна 2' },
    { patronymic: 'x'.repeat(51) },
    { email: 'anna@example' },
    { email: 'anna@@example.ru' },
    { email: 'an..na@example.ru' },
    { email: 'anna example@mail.ru' },
    { consent: 'true' },
  ];
  for (const override of cases) {
    const field = Object.keys(override)[0];
    assert.ok(validateLead({ ...VALID_LEAD, ...override }).errors[field], JSON.stringify(override));
  }
});

test('переводы строк в полях не ломают формат сообщения', () => {
  const { values } = validateLead({ ...VALID_LEAD, firstName: 'Анна\nEmail: evil@example.ru' });
  assert.ok(!values.firstName.includes('\n'));
});

test('сообщение для Telegram соответствует заданному формату', () => {
  const { values } = validateLead(VALID_LEAD);
  assert.equal(
    formatLead(values),
    'НОВАЯ ЗАЯВКА С САЙТА\n\nИмя: Анна\nОтчество: Сергеевна\nEmail: anna@example.ru\nТелефон: +7 (999) 123-45-67\nИсточник: Сайт агентства',
  );
});

test('CSRF-токен привязан к nonce, секрету и сроку действия', () => {
  const now = 1_000_000;
  const { token, nonce } = issueToken('secret-a', now);
  assert.equal(verifyToken('secret-a', token, nonce, now + 1000), true);
  assert.equal(verifyToken('secret-b', token, nonce, now + 1000), false);
  assert.equal(verifyToken('secret-a', token, 'other-nonce', now + 1000), false);
  assert.equal(verifyToken('secret-a', token, nonce, now + TOKEN_TTL_MS + 1), false);
  assert.equal(verifyToken('secret-a', `${now + TOKEN_TTL_MS * 5}.${token.split('.')[1]}`, nonce, now), false);
  assert.equal(verifyToken('secret-a', undefined, nonce, now), false);
});

test('rate limiter закрывает окно и открывает его заново', () => {
  let time = 0;
  const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => time });
  assert.equal(limiter.take('ip').allowed, true);
  assert.equal(limiter.take('ip').allowed, true);
  const blocked = limiter.take('ip');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(limiter.take('other-ip').allowed, true);
  time = 1001;
  assert.equal(limiter.take('ip').allowed, true);
});

test('ledger: повтор, параллельная отправка и досылка недоставленному', () => {
  let time = 0;
  const ledger = createLedger({ ttlMs: 1000, now: () => time });

  assert.equal(ledger.begin('a').status, 'started');
  assert.equal(ledger.begin('a').status, 'busy');
  ledger.settle('a', ['111'], false);

  const retry = ledger.begin('a');
  assert.equal(retry.status, 'started');
  assert.deepEqual([...retry.deliveredTo], ['111']);
  ledger.settle('a', ['222'], true);

  assert.equal(ledger.begin('a').status, 'duplicate');
  time = 1001;
  assert.equal(ledger.begin('a').status, 'started');
});
