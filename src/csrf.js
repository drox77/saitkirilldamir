import crypto from 'node:crypto';

// Подписанный double-submit: nonce лежит в HttpOnly-cookie, подпись nonce — в заголовке запроса.
export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

function sign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueToken(secret, now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const expiresAt = now + TOKEN_TTL_MS;
  return { nonce, expiresAt, token: `${expiresAt}.${sign(secret, `${expiresAt}.${nonce}`)}` };
}

export function verifyToken(secret, token, nonce, now = Date.now()) {
  if (typeof token !== 'string' || typeof nonce !== 'string' || !nonce) return false;
  const [expiresAt, signature = ''] = token.split('.');
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < now) return false;

  const expected = Buffer.from(sign(secret, `${expiresAt}.${nonce}`));
  const received = Buffer.from(signature);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
