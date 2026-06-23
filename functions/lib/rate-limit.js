const WINDOW_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 600;

const buckets = new Map();
let lastCleanup = 0;

export function checkRateLimit(request, env = {}, cost = 1) {
  const limit = getRateLimit(env.API_RATE_LIMIT_PER_MINUTE);
  const requestCost = getRequestCost(cost, limit);
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const key = getClientKey(request);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: requestCost,
      resetAt: now + WINDOW_MS,
    });
    return { allowed: true };
  }

  if (bucket.count + requestCost > limit) {
    return {
      allowed: false,
      headers: getRateLimitHeaders(limit, 0, bucket.resetAt, now),
    };
  }

  bucket.count += requestCost;
  return { allowed: true };
}

function getRateLimit(value) {
  const limit = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function getClientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function getRequestCost(value, limit) {
  const cost = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(cost) || cost <= 1) return 1;
  return Math.min(cost, limit);
}

function getRateLimitHeaders(limit, remaining, resetAt, now) {
  return {
    "Retry-After": String(Math.max(1, Math.ceil((resetAt - now) / 1000))),
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(Math.max(0, remaining)),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };
}

function cleanupExpiredBuckets(now) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
