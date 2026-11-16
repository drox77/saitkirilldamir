export function createRateLimiter({ max, windowMs, now = Date.now }) {
  const windows = new Map();

  function take(key) {
    const time = now();
    const current = windows.get(key);
    if (!current || current.resetAt <= time) {
      windows.set(key, { count: 1, resetAt: time + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    current.count += 1;
    if (current.count <= max) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.ceil((current.resetAt - time) / 1000) };
  }

  function sweep() {
    const time = now();
    for (const [key, entry] of windows) {
      if (entry.resetAt <= time) windows.delete(key);
    }
  }

  return { take, sweep };
}
