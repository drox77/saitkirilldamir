import crypto from 'node:crypto';
import path from 'node:path';

const TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID_PATTERN = /^-?\d{5,}$/;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env) {
  const warnings = [];
  const port = positiveInt(env.PORT, 3000);
  const isProduction = env.NODE_ENV === 'production';

  const token = (env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatIds = (env.TELEGRAM_CHAT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
  const tokenValid = TOKEN_PATTERN.test(token);
  const chatIdsValid = chatIds.length > 0 && chatIds.every((id) => CHAT_ID_PATTERN.test(id));
  if (!tokenValid) warnings.push('TELEGRAM_BOT_TOKEN не задан или имеет неверный формат: форма будет отвечать 503');
  if (!chatIdsValid) warnings.push('TELEGRAM_CHAT_IDS не задан или содержит нечисловые значения: форма будет отвечать 503');

  let siteUrl = (env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!siteUrl) {
    siteUrl = `http://localhost:${port}`;
    if (isProduction) warnings.push('SITE_URL не задан: canonical, sitemap.xml и Open Graph указывают на localhost');
  }

  let csrfSecret = (env.CSRF_SECRET || '').trim();
  if (csrfSecret.length < 32) {
    csrfSecret = crypto.randomBytes(32).toString('hex');
    if (isProduction) warnings.push('CSRF_SECRET не задан: сгенерирован временный, токены формы сбросятся при перезапуске');
  }

  return {
    port,
    host: env.HOST || '0.0.0.0',
    isProduction,
    siteUrl,
    siteOrigin: new URL(siteUrl).origin,
    publicDir: path.join(import.meta.dirname, '..', 'public'),
    csrfSecret,
    trustProxy: Math.max(0, Number.parseInt(env.TRUST_PROXY, 10) || 0),
    rateLimit: {
      max: positiveInt(env.RATE_LIMIT_MAX, 5),
      windowMs: positiveInt(env.RATE_LIMIT_WINDOW_MIN, 10) * 60_000,
    },
    telegram: {
      apiBase: 'https://api.telegram.org',
      token,
      chatIds,
      ready: tokenValid && chatIdsValid,
    },
    warnings,
  };
}
