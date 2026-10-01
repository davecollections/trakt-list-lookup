import assert from "node:assert/strict";
import { createSQLiteBudget } from "./helpers/sqlite-budget.mjs";
import { initializeBudget, reserveBudget, WINDOW_MS, DISPATCH_GRACE_MS } from "../worker/dingo/budget-store.js";
const { db, storage } = createSQLiteBudget();
try {
  initializeBudget(storage);
  const start = 1000000;
  const retention = WINDOW_MS + DISPATCH_GRACE_MS;
  for (let n = 0; n < 149; n++) assert.deepEqual(reserveBudget(storage, 3, start), { allowed: true });
  assert.deepEqual(reserveBudget(storage, 2, start), { allowed: true });
  assert.deepEqual(reserveBudget(storage, 2, start), { allowed: false, retryAfter: 330 });
  assert.deepEqual(reserveBudget(storage, 1, start), { allowed: true });
  assert.deepEqual(reserveBudget(storage, 1, start + retention - 1), { allowed: false, retryAfter: 1 });
  for (const cost of [0, -1, 4, 1.5, NaN, Infinity, "1"]) assert.throws(() => reserveBudget(storage, cost, start));
  assert.equal([...storage.sql.exec("SELECT SUM(units) AS used FROM reservations")][0].used, 450);
  assert.deepEqual(reserveBudget(storage, 3, start + retention), { allowed: true });
  // Simulated coordinator restart preserves reservations; clock rollback cannot free budget.
  initializeBudget(storage);
  for (let n = 0; n < 149; n++) assert.equal(reserveBudget(storage, 3, start + retention).allowed, true);
  assert.equal(reserveBudget(storage, 1, start).allowed, false);
  // A failed insertion rolls the entire expiration/check/reserve transaction back.
  const before = [...storage.sql.exec("SELECT * FROM reservations")];
  db.exec("CREATE TRIGGER fail_reserve BEFORE INSERT ON reservations BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  assert.throws(() => reserveBudget(storage, 1, start + 2 * retention));
  assert.deepEqual([...storage.sql.exec("SELECT * FROM reservations")], before);
  console.log("Dingo SQLite budget: capacity, atomic media reservation, expiry, persistence, invalid costs, clock rollback and transaction rollback passed");
} finally { db.close(); }
