import assert from "node:assert/strict";
import { createSQLiteBudget } from "./helpers/sqlite-budget.mjs";
import { onRequestGet } from "../functions/api/trakt.js";
import { createDingoHandler } from "../worker/dingo/worker.js";
import { traktFetch } from "../functions/lib/trakt-client.js";
import { SHARED_LIMIT, WINDOW_MS, rateLimitEvidence } from "../functions/lib/trakt-budget.js";

// Pure tests: synthetic upstream fixtures are restricted to this unit harness.
// Accounting executes the production SQL/transactions on real SQLite.
const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
let checks = 0, ip = 1;
const check = async (name, fn) => { await fn(); checks++; console.log("Shared SQLite: " + name); };
const list = (id = 123, extra = {}) => ({ name: "Unit list", ids: { trakt: id, slug: "unit" },
  user: { username: "unit-user" }, item_count: 1, likes: 1, privacy: "public", ...extra });
const response = (data, count = 1, pages = 1, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", "X-Pagination-Item-Count": String(count),
    "X-Pagination-Page": "1", "X-Pagination-Page-Count": String(pages), "X-Pagination-Limit": "30", ...extra },
});
function harness(responder = () => response([])) {
  const db = createSQLiteBudget(), calls = [], cache = new Map(), logs = [];
  const env = { TRAKT_CLIENT_ID: "unit-only-placeholder", TRAKT_CREDENTIAL_SCOPE: "shared",
    TRAKT_BUDGET: db.namespace, API_RATE_LIMIT_PER_MINUTE: 10000 };
  globalThis.caches = { default: { match: async (key) => cache.get(key.url)?.clone(),
    put: async (key, value) => { cache.set(key.url, value.clone()); } } };
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(input).origin, "https://api.trakt.tv");
    assert.equal(init.redirect, "manual");
    calls.push(new URL(input));
    // Every dispatch is already covered; never count an unreserved request.
    assert.ok(db.used() > 0);
    return responder(new URL(input), calls.length);
  };
  const dingo = createDingoHandler({ now: () => db.time, log: (entry) => logs.push(entry),
    throttle: () => ({ allowed: true }) });
  return { db, calls, cache, logs, env,
    standalone: (query, overrides = {}) => onRequestGet({
      request: new Request("https://standalone.test/api/trakt?" + query, { headers: { "CF-Connecting-IP": "unit-" + ip++ } }),
      env: { ...env, ...overrides },
    }),
    dingo: (path, overrides = {}) => dingo(new Request("https://api.dingo.build/v1/trakt/" + path), { ...env, ...overrides }),
    close: () => db.close(),
  };
}
try {
  await check("official working limit 500 is distinct from internal 450/300", async () => {
    const officialWorkingLimit = 500; // Owner-resolved Current limits table; not runtime auto-tuning.
    assert.equal(WINDOW_MS, 300000);
    assert.equal(SHARED_LIMIT, 450);
    assert.ok(SHARED_LIMIT < officialWorkingLimit);
  });
  await check("standalone and Dingo spend the same object and cannot exceed 450", async () => {
    const h = harness();
    try {
      h.db.fill(448);
      assert.equal((await h.standalone("mode=popular")).status, 200);
      assert.equal(h.db.used(), 449);
      assert.equal((await h.dingo("browse?kind=popular")).status, 200);
      assert.equal(h.db.used(), 450);
      assert.equal((await h.standalone("mode=trending")).status, 429);
      assert.equal((await h.dingo("browse?kind=trending")).status, 429);
      assert.equal(h.calls.length, 2);
      assert.deepEqual(h.db.attempts.slice(-4), [1, 1, 1, 1]);
      assert.deepEqual([...new Set(h.db.names)], ["dingo-trakt-v1"]);
    } finally { h.close(); }
  });
  await check("Dingo consumption reduces standalone capacity; lifecycle and expiry", async () => {
    const h = harness();
    try {
      h.db.fill(449);
      assert.equal((await h.dingo("browse?kind=popular")).status, 200);
      h.db.restart();
      assert.equal((await h.standalone("mode=trending")).status, 429);
      h.db.time += 330000;
      assert.equal((await h.standalone("mode=trending")).status, 200);
      assert.equal(h.db.used(), 1);
      assert.equal(h.calls.length, 2);
    } finally { h.close(); }
  });
  await check("Dingo media reserves two once; one remaining starts neither call", async () => {
    for (const used of [448, 449]) {
      const h = harness(() => response([{ type: "movie" }]));
      try {
        h.db.fill(used);
        const result = await h.dingo("lists/123/media");
        assert.equal(result.status, used === 448 ? 200 : 429);
        assert.equal(h.calls.length, used === 448 ? 2 : 0);
        assert.equal(h.db.used(), used === 448 ? 450 : 449);
        assert.equal(h.db.attempts.at(-1), 2);
      } finally { h.close(); }
    }
  });
  await check("cache hits and normalized query order cost zero for both services", async () => {
    const h = harness();
    try {
      await h.standalone("mode=popular&limit=5");
      await h.standalone("limit=5&mode=popular");
      await h.dingo("browse?kind=popular");
      await h.dingo("browse?kind=popular&limit=30&page=1");
      assert.equal(h.calls.length, 2);
      assert.equal(h.db.used(), 2);
      assert.deepEqual(h.db.attempts, [1, 1]);
    } finally { h.close(); }
  });
  for (const kind of ["standalone", "dingo"]) await check(kind + " coalesced callers pay once", async () => {
    let release, started;
    const signal = new Promise((resolve) => { started = resolve; });
    const h = harness(async () => { started(); await new Promise((resolve) => { release = resolve; }); return response([]); });
    try {
      const query = kind === "standalone" ? "mode=popular" : "browse?kind=popular";
      const first = h[kind](query);
      await signal;
      const second = h[kind](query);
      await new Promise((resolve) => setImmediate(resolve));
      release();
      assert.ok((await Promise.all([first, second])).every((r) => r.status === 200));
      assert.equal(h.db.used(), 1);
      assert.equal(h.calls.length, 1);
    } finally { h.close(); }
  });
  await check("incremental filtered-user and sorted fan-out stop before unreserved call", async () => {
    for (const query of ["mode=user&q=unit-user+absent", "mode=popular&sort=likes"]) {
      const h = harness(() => response([], 101, 3));
      try {
        h.db.fill(449);
        const result = await h.standalone(query);
        assert.equal(result.status, 429);
        assert.equal(h.calls.length, 1);
        assert.equal(h.db.used(), 450);
        assert.equal(h.cache.size, 0);
        assert.match((await result.json()).error, /budget/);
      } finally { h.close(); }
    }
  });
  await check("availability detail and item checks cannot hide budget refusal", async () => {
    for (const used of [448, 447]) {
      const h = harness((url) => url.pathname === "/lists/popular"
        ? response([{ list: list(123, { user: {} }), like_count: 1 },
          { list: list(124, { user: {} }), like_count: 1 }])
        : url.pathname.endsWith("/items/movie,show,episode,season") ? response([]) : response(list(123, { user: {} })));
      try {
        h.db.fill(used);
        assert.equal((await h.standalone("mode=popular")).status, 429);
        assert.equal(h.calls.length, 450 - used);
        assert.equal(h.db.used(), 450);
        assert.equal(h.cache.size, 0);
      } finally { h.close(); }
    }
  });
  await check("all standalone paths account exactly once, including availability/items", async () => {
    const cases = [
      ["mode=search&q=unit", [{ list: list() }], 1],
      ["mode=user&q=unit-user", [list()], 1],
      ["mode=popular", [{ list: list() }], 1],
      ["mode=trending", [{ list: list() }], 1],
      ["mode=url&q=123", list(), 1],
      ["mode=url&q=https://trakt.tv/users/unit-user/lists/unit", list(), 1],
      ["mode=items&id=123&posters=0", [], 1],
      ["mode=items&user=unit-user&slug=unit&posters=0", [], 1],
      ["mode=media&id=123", [], 2],
    ];
    for (const [query, data, cost] of cases) {
      const h = harness(() => response(data));
      try {
        assert.equal((await h.standalone(query)).status, 200, query);
        assert.equal(h.calls.length, cost, query);
        assert.equal(h.db.used(), cost, query);
        assert.deepEqual(h.db.attempts, Array(cost).fill(1));
      } finally { h.close(); }
    }
    const h = harness((url) => url.pathname === "/lists/popular"
      ? response([{ list: list(123, { user: {} }) }])
      : url.pathname === "/lists/123" ? response(list(123, { user: {} })) : response([]));
    try {
      assert.equal((await h.standalone("mode=popular")).status, 200);
      assert.equal(h.calls.length, 3);
      assert.equal(h.db.used(), 3);
    } finally { h.close(); }
  });
  await check("shared client rejects missing accounting; scope/binding fail closed", async () => {
    const h = harness();
    try {
      await assert.rejects(traktFetch("/lists/popular", "unit"), { code: "ACCOUNTING_REQUIRED" });
      for (const scope of [undefined, "unknown", "dedicated"]) {
        assert.equal((await h.standalone("mode=popular", { TRAKT_CREDENTIAL_SCOPE: scope })).status, 503);
        assert.equal((await h.dingo("browse?kind=popular", { TRAKT_CREDENTIAL_SCOPE: scope })).status, 503);
      }
      assert.equal((await h.standalone("mode=popular", { TRAKT_BUDGET: undefined })).status, 503);
      assert.equal(h.calls.length, 0);
      assert.equal(h.db.used(), 0);
    } finally { h.close(); }
  });
  await check("Trakt 429 stops queued standalone media and availability fan-out", async () => {
    for (const query of ["mode=media&id=123", "mode=popular"]) {
      const h = harness((url) => url.pathname === "/lists/popular"
        ? response([{ list: list(123, { user: {} }) }, { list: list(124, { user: {} }) }])
        : response({ error: "must-not-leak" }, 0, 1, 429, { "Retry-After": "999999" }));
      try {
        const result = await h.standalone(query);
        assert.equal(result.status, 429);
        assert.equal(result.headers.get("Retry-After"), "3600");
        assert.equal(h.calls.length, query.includes("media") ? 1 : 2);
        assert.equal(h.db.used(), h.calls.length);
        assert.equal(h.cache.size, 0);
        assert.ok(!(await result.text()).includes("must-not-leak"));
      } finally { h.close(); }
    }
  });
  await check("malformed upstream bodies and headers never enter standalone error logs", async () => {
    const errors = [], originalError = console.error;
    const h = harness(() => new Response("unit-only-placeholder private-body", { headers: { "Content-Type": "application/json" } }));
    console.error = (...args) => errors.push(args);
    try {
      const result = await h.standalone("mode=popular");
      assert.equal(result.status, 502);
      assert.ok(!JSON.stringify(errors).match(/unit-only-placeholder|private-body/));
      assert.ok(!(await result.text()).includes("unit-only-placeholder"));
    } finally { console.error = originalError; h.close(); }
  });
  for (const status of [300, 301, 302, 303, 304, 305, 306, 307, 308, 399]) {
    await check("redirect " + status + " rejected once by both services, for either destination", async () => {
      for (const location of ["https://redirect.invalid/private-target", "https://api.trakt.tv/private-target"]) {
        for (const kind of ["standalone", "dingo"]) {
          const h = harness(() => new Response(null, { status, headers: { Location: location } }));
          try {
            const result = await h[kind](kind === "standalone" ? "mode=popular" : "browse?kind=popular");
            assert.equal(result.status, 502);
            assert.equal(result.headers.get("Location"), null);
            assert.equal(result.headers.get("Retry-After"), null);
            const body = await result.json();
            assert.equal(kind === "dingo" ? body.error.code : typeof body.error, kind === "dingo" ? "UPSTREAM_FAILURE" : "string");
            assert.ok(!JSON.stringify(body).match(/private-target|redirect.invalid|unit-only-placeholder/));
            assert.ok(!JSON.stringify(h.logs).match(/private-target|redirect.invalid|unit-only-placeholder/));
            assert.equal(h.calls.length, 1, "No follow-up or retry");
            assert.equal(h.calls[0].origin, "https://api.trakt.tv");
            assert.equal(h.db.used(), 1, "The actual GET remains charged");
            assert.deepEqual(h.db.attempts, [1], "No second reservation or refund");
            assert.equal(h.cache.size, 0);
            if (kind === "dingo") assert.deepEqual(h.logs[0].upstreamStatuses, [status]);
          } finally { h.close(); }
        }
      }
    });
  }
  await check("ordinary upstream errors retain both public service contracts", async () => {
    for (const [status, dingoStatus] of [[401, 502], [403, 502], [404, 404], [500, 502], [503, 502]]) {
      for (const kind of ["standalone", "dingo"]) {
        const h = harness(() => response({ private: "must-not-leak" }, 0, 1, status));
        try {
          const result = await h[kind](kind === "standalone" ? "mode=popular" : "browse?kind=popular");
          assert.equal(result.status, kind === "dingo" ? dingoStatus : status);
          assert.ok(!(await result.text()).includes("must-not-leak"));
          assert.equal(h.calls.length, 1);
          assert.equal(h.db.used(), 1);
          assert.equal(h.cache.size, 0);
        } finally { h.close(); }
      }
    }
  });
  await check("runtime quota evidence is allowlisted and cannot change the 450 ceiling", async () => {
    const evidence = { name: "UNAUTHED_API_GET_LIMIT", period: 300, limit: 1000, remaining: 999 };
    assert.deepEqual(rateLimitEvidence(JSON.stringify({ ...evidence, secret: "must-not-leak" })), evidence);
    assert.equal(rateLimitEvidence('{"name":"secret","period":300,"limit":1000,"remaining":0}'), null);
    assert.equal(rateLimitEvidence("not JSON"), null);
    const h = harness(() => response([], 0, 1, 200, { "X-Ratelimit": JSON.stringify(evidence) }));
    try {
      await h.dingo("browse?kind=popular");
      assert.deepEqual(h.logs[0].rateLimits, [evidence]);
      assert.equal(SHARED_LIMIT, 450);
    } finally { h.close(); }
  });
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches;
}
console.log("Shared SQLite checks passed: " + checks);
