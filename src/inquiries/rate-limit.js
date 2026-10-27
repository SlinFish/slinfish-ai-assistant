export function createLimiter({
  limit = 5,
  windowMs = 60000,
  globalLimit = 50,
  maxClients = 1000,
} = {}) {
  if (
    ![limit, windowMs, globalLimit, maxClients].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  )
    throw new Error("Invalid rate limit");
  const clients = new Map();
  let global = { count: 0, until: 0 };
  return {
    attempt(key, now) {
      for (const [ip, record] of clients)
        if (record.until <= now) clients.delete(ip);
      if (global.until <= now) global = { count: 0, until: now + windowMs };
      let record = clients.get(key);
      if (!record) {
        if (clients.size >= maxClients) return Math.ceil(windowMs / 1000);
        record = { count: 0, until: now + windowMs };
        clients.set(key, record);
      }
      record.count++;
      global.count++;
      if (record.count > limit || global.count > globalLimit)
        return Math.max(
          1,
          Math.ceil(
            ((global.count > globalLimit ? global.until : record.until) - now) /
              1000,
          ),
        );
      return 0;
    },
    clear() {
      clients.clear();
      global = { count: 0, until: 0 };
    },
  };
}
