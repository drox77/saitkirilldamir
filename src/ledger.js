// Идемпотентность по содержимому заявки: одинаковые данные в течение ttlMs доставляются один раз.
// Если один получатель уже получил сообщение, а второй нет, повтор уходит только второму.
export function createLedger({ ttlMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map();

  function sweep() {
    const time = now();
    for (const [fingerprint, entry] of entries) {
      if (entry.expiresAt <= time && !entry.pending) entries.delete(fingerprint);
    }
  }

  function begin(fingerprint) {
    sweep();
    let entry = entries.get(fingerprint);
    if (entry?.done) return { status: 'duplicate' };
    if (entry?.pending) return { status: 'busy' };
    if (!entry) {
      entry = { pending: false, done: false, deliveredTo: new Set(), expiresAt: 0 };
      entries.set(fingerprint, entry);
    }
    entry.pending = true;
    entry.expiresAt = now() + ttlMs;
    return { status: 'started', deliveredTo: new Set(entry.deliveredTo) };
  }

  function settle(fingerprint, delivered, done) {
    const entry = entries.get(fingerprint);
    for (const recipient of delivered) entry.deliveredTo.add(recipient);
    entry.pending = false;
    entry.done = done;
  }

  return { begin, settle, sweep };
}
