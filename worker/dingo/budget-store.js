import { SHARED_LIMIT, WINDOW_MS, DISPATCH_GRACE_MS } from "../../functions/lib/trakt-budget.js";
export { WINDOW_MS, DISPATCH_GRACE_MS };
// Retain reservations for the full upstream window after the latest dispatch.

export function initializeBudget(storage) {
  storage.sql.exec("CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, units INTEGER NOT NULL)");
  storage.sql.exec("CREATE INDEX IF NOT EXISTS reservations_at ON reservations(at)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS budget_state (id INTEGER PRIMARY KEY CHECK(id = 1), used INTEGER NOT NULL, last_at INTEGER NOT NULL)");
  storage.sql.exec("INSERT OR IGNORE INTO budget_state SELECT 1, COALESCE(SUM(units), 0), COALESCE(MAX(at), 0) FROM reservations");
}

// Synchronous transaction: check and complete reservation are atomic. The ledger
// holds at most 450 rows. Normal admission reads state + expired rows; it does not
// scan the whole active ledger. A refusal needs at most three oldest rows.
export function reserveBudget(storage, units, now = Date.now()) {
  if (!Number.isInteger(units) || units < 1 || units > 3 || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("Invalid budget reservation.");
  }
  return storage.transactionSync(() => {
    const state = [...storage.sql.exec("SELECT used, last_at FROM budget_state WHERE id = 1")][0];
    const effectiveNow = Math.max(now, state.last_at);
    const cutoff = effectiveNow - WINDOW_MS - DISPATCH_GRACE_MS;
    const expired = [...storage.sql.exec("SELECT COALESCE(SUM(units), 0) AS units FROM reservations WHERE at <= ?", cutoff)][0].units;
    const used = state.used - expired;
    if (expired) {
      storage.sql.exec("DELETE FROM reservations WHERE at <= ?", cutoff);
      storage.sql.exec("UPDATE budget_state SET used = ?, last_at = ? WHERE id = 1", used, effectiveNow);
    }
    if (used + units > SHARED_LIMIT) {
      let released = 0;
      let retryAt = effectiveNow + WINDOW_MS + DISPATCH_GRACE_MS;
      for (const row of storage.sql.exec("SELECT at, units FROM reservations ORDER BY at, id LIMIT 3")) {
        released += row.units;
        if (used + units - released <= SHARED_LIMIT) {
          retryAt = row.at + WINDOW_MS + DISPATCH_GRACE_MS;
          break;
        }
      }
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
    }
    storage.sql.exec("INSERT INTO reservations (at, units) VALUES (?, ?)", effectiveNow, units);
    storage.sql.exec("UPDATE budget_state SET used = ?, last_at = ? WHERE id = 1", used + units, effectiveNow);
    return { allowed: true };
  });
}
