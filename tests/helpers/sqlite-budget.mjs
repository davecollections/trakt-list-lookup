import { DatabaseSync } from "node:sqlite";
import { initializeBudget, reserveBudget } from "../../worker/dingo/budget-store.js";
export function createSQLiteBudget() {
  const db = new DatabaseSync(":memory:");
  const storage = {
    sql: { exec: (sql, ...args) => db.prepare(sql).all(...args) },
    transactionSync(fn) {
      db.exec("BEGIN");
      try { const result = fn(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  initializeBudget(storage);
  const fixture = { db, storage, time: Date.now(), attempts: [], names: [],
    namespace: {
      idFromName(name) { fixture.names.push(name); return name; },
      get() { return { reserve: async (cost) => {
        fixture.attempts.push(cost);
        return reserveBudget(storage, cost, fixture.time);
      } }; },
    },
    used: () => storage.sql.exec("SELECT used FROM budget_state WHERE id = 1")[0].used,
    fill(units) { while (units > 0) { const cost = Math.min(units, 3);
      if (!reserveBudget(storage, cost, fixture.time).allowed) throw new Error("Fixture overflow");
      units -= cost; } },
    restart: () => initializeBudget(storage),
    close: () => db.close(),
  };
  return fixture;
}
