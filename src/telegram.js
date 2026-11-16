import { setTimeout as sleep } from 'node:timers/promises';

import { log } from './log.js';

const REQUEST_TIMEOUT_MS = 6000;
const BACKOFF_MS = [400, 1200];
const MAX_RETRY_AFTER_MS = 3000;

export function formatLead(lead) {
  return [
    'НОВАЯ ЗАЯВКА С САЙТА',
    '',
    `Имя: ${lead.firstName}`,
    `Отчество: ${lead.patronymic}`,
    `Email: ${lead.email}`,
    `Телефон: ${lead.phone}`,
    'Источник: Сайт агентства',
  ].join('\n');
}

async function sendOnce(telegram, chatId, text) {
  let response;
  try {
    response = await fetch(`${telegram.apiBase}/bot${telegram.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Текст ошибки fetch может содержать адрес запроса с токеном, поэтому в результат идёт только её тип.
    return { ok: false, retryable: true, reason: error.name === 'TimeoutError' ? 'timeout' : 'network' };
  }

  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.ok === true) return { ok: true };

  return {
    ok: false,
    retryable: response.status === 429 || response.status >= 500,
    reason: `http_${response.status}`,
    description: typeof payload?.description === 'string' ? payload.description : undefined,
    retryAfterMs: (Number(payload?.parameters?.retry_after) || 0) * 1000,
  };
}

async function sendWithRetry(telegram, chatId, text, recipient) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await sendOnce(telegram, chatId, text);
    if (result.ok) return true;

    const lastAttempt = attempt >= BACKOFF_MS.length;
    log('warn', 'telegram_send_failed', {
      recipient,
      attempt: attempt + 1,
      reason: result.reason,
      description: result.description,
      willRetry: result.retryable && !lastAttempt,
    });
    if (!result.retryable || lastAttempt) return false;
    await sleep(Math.max(BACKOFF_MS[attempt], Math.min(result.retryAfterMs || 0, MAX_RETRY_AFTER_MS)));
  }
}

// Отправляет заявку каждому получателю отдельным запросом. Возвращает chat_id тех, кто ответил ok: true.
export async function deliverLead(telegram, text, alreadyDelivered = new Set()) {
  const pending = telegram.chatIds.filter((chatId) => !alreadyDelivered.has(chatId));
  const outcomes = await Promise.all(
    pending.map((chatId) => sendWithRetry(telegram, chatId, text, telegram.chatIds.indexOf(chatId) + 1)),
  );
  return pending.filter((_, index) => outcomes[index]);
}
