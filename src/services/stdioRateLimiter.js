const { getAuth, resolveWriteOwner } = require("../context");

const WINDOW_MS = 60 * 1000;
const MAX_CALLS = 60;

function createRateLimiter({ windowMs = WINDOW_MS, maxCalls = MAX_CALLS } = {}) {
  const counters = new Map();

  return {
    consume(owner, now = Date.now()) {
      let counter = counters.get(owner);

      if (!counter || counter.resetAt <= now) {
        counter = { count: 0, resetAt: now + windowMs };
        counters.set(owner, counter);
      }

      if (counter.count >= maxCalls) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - now) / 1000)),
        };
      }

      counter.count += 1;
      return { allowed: true };
    },
  };
}

const stdioRateLimiter = createRateLimiter();

function withLocalToolRateLimit(handler) {
  return async (...args) => {
    if (getAuth()) {
      return handler(...args);
    }

    const result = stdioRateLimiter.consume(resolveWriteOwner());
    if (!result.allowed) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Límite local de ${MAX_CALLS} llamadas por minuto alcanzado. Reintentá en ${result.retryAfterSeconds} segundos.`,
        }],
      };
    }

    return handler(...args);
  };
}

module.exports = { createRateLimiter, withLocalToolRateLimit };