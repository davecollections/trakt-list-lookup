// One application credential, one namespace and one stable object identity.
// Keep the existing identity when attaching Pages: changing it creates a new pool.
export const SHARED_BUDGET_NAME = "dingo-trakt-v1";
export const SHARED_LIMIT = 450;
export const WINDOW_MS = 300000;
export const DISPATCH_GRACE_MS = 30000;

export function budgetError(status, code, message, retryAfter) {
  return Object.assign(new Error(message), { status, code, ...(retryAfter ? { retryAfter } : {}) });
}
export function assertBudgetConfigured(env) {
  if (env.TRAKT_CREDENTIAL_SCOPE !== "shared" || !env.TRAKT_BUDGET) {
    throw budgetError(503, "SERVICE_NOT_CONFIGURED", "Trakt service is not configured.");
  }
}
export function isAccountingFailure(error) {
  return error?.status === 429 || ["BUDGET_UNAVAILABLE", "RESERVATION_EXPIRED",
    "RESERVATION_EXHAUSTED", "ACCOUNTING_REQUIRED"].includes(error?.code);
}

// Explicit request-owned context. A nonzero operationCost pre-reserves once;
// zero means incremental standalone reservations, immediately before dispatch.
export async function createTraktAccounting(env, {
  operationCost = 0, now = Date.now, onReserve = () => {}, onRefused = () => {},
} = {}) {
  assertBudgetConfigured(env);
  if (!Number.isInteger(operationCost) || operationCost < 0 || operationCost > 3) {
    throw budgetError(503, "ACCOUNTING_REQUIRED", "Trakt service is not configured.");
  }
  let remaining = operationCost;
  let deadline = 0;
  let stopped;
  let queue = Promise.resolve();
  async function reserve(units) {
    const dispatchDeadline = now() + DISPATCH_GRACE_MS;
    let result;
    try {
      const coordinator = env.TRAKT_BUDGET.get(env.TRAKT_BUDGET.idFromName(SHARED_BUDGET_NAME));
      result = await coordinator.reserve(units);
    } catch {
      throw budgetError(503, "BUDGET_UNAVAILABLE", "Trakt service is temporarily unavailable.");
    }
    if (result?.allowed !== true) {
      if (result?.allowed !== false || !Number.isInteger(result.retryAfter) || result.retryAfter < 1) {
        throw budgetError(503, "BUDGET_UNAVAILABLE", "Trakt service is temporarily unavailable.");
      }
      onRefused();
      throw budgetError(429, "UPSTREAM_BUDGET", "Trakt request budget is temporarily exhausted.", String(result.retryAfter));
    }
    onReserve(units);
    return dispatchDeadline;
  }
  if (operationCost) deadline = await reserve(operationCost);
  return {
    run(dispatch) {
      // Serial dispatch prevents further fan-out after quota refusal or Trakt 429.
      const work = queue.then(async () => {
        if (stopped) throw stopped;
        if (operationCost) {
          if (remaining < 1) throw budgetError(503, "RESERVATION_EXHAUSTED", "Trakt request failed. Try again shortly.");
          remaining--;
        } else deadline = await reserve(1);
        if (now() >= deadline) throw budgetError(503, "RESERVATION_EXPIRED", "Trakt service is busy. Try again shortly.");
        return dispatch();
      }).catch((error) => {
        if (isAccountingFailure(error)) stopped = error;
        throw error;
      });
      queue = work.catch(() => {});
      return work;
    },
  };
}

export function boundedRetryAfter(value) {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) return undefined;
  return String(Math.max(1, Math.min(3600, Number(value))));
}

// Only validated operational fields leave the upstream response headers.
export function rateLimitEvidence(value) {
  if (!value || value.length > 2048) return null;
  try {
    const data = JSON.parse(value);
    if (!["UNAUTHED_API_GET_LIMIT", "AUTHED_API_GET_LIMIT"].includes(data.name)
        || ![data.period, data.limit, data.remaining].every((n) => Number.isSafeInteger(n) && n >= 0)
        || data.period < 1 || data.limit < 1 || data.remaining > data.limit) return null;
    return { name: data.name, period: data.period, limit: data.limit, remaining: data.remaining };
  } catch { return null; }
}
