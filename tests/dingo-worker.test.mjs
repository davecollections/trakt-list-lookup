import assert from "node:assert/strict";
import { createDingoHandler } from "../worker/dingo/worker.js";
import { createRateLimiter } from "../functions/lib/rate-limit.js";

const originalFetch = globalThis.fetch;
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log("Dingo: " + name); };
const list = (extra = {}) => ({ name: "Unit list", ids: { trakt: 123, slug: "unit-list" },
  user: { username: "unit-user", name: "Unit User" }, privacy: "public", ...extra });
const json = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json", ...headers },
});
const paged = (data, count = data.length, page = 1, limit = 30, pageCount = 1) => json(data, {
  "X-Pagination-Item-Count": String(count), "X-Pagination-Page": String(page),
  "X-Pagination-Limit": String(limit), "X-Pagination-Page-Count": String(pageCount),
});
function harness(responder = () => paged([]), options = {}) {
  const calls = [], reservations = [], logs = [], cached = new Map();
  const env = { TRAKT_CLIENT_ID: "unit-only-placeholder", TRAKT_CREDENTIAL_SCOPE: "shared",
    TRAKT_BUDGET: {
      idFromName: (name) => { assert.equal(name, "dingo-trakt-v1"); return name; },
      get: () => ({ reserve: async (cost) => { reservations.push(cost); return options.reservation?.(cost) ?? { allowed: true }; } }),
    },
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://api.trakt.tv");
    assert.equal(init.headers["trakt-api-key"], env.TRAKT_CLIENT_ID);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, "manual");
    calls.push(url);
    return responder(url, calls.length, init);
  };
  const cache = { match: async (key) => cached.get(key.url)?.clone(),
    put: async (key, response) => { cached.set(key.url, response.clone()); } };
  const handle = createDingoHandler({ cache: () => cache, log: (entry) => logs.push(entry), ...options.handler });
  return { calls, reservations, logs, cached, env,
    request: (path, init = {}, overrides = {}) => handle(new Request("https://api.dingo.build" + path, init), { ...env, ...overrides }),
    local: (path, origin) => handle(new Request("http://localhost:8787" + path, { headers: { Origin: origin } }),
      { ...env, ALLOW_LOOPBACK_ORIGINS: "true" }),
  };
}
try {
  await check("strict routes and parameters fail before reservation/fetch", async () => {
    const h = harness();
    const invalid = [
      "/v1/trakt/search?mode=bad&q=a", "/v1/trakt/search?mode=keyword&q=a&q=b",
      "/v1/trakt/search?mode=keyword&q=a&page=26", "/v1/trakt/search?mode=keyword&q=a&limit=51",
      "/v1/trakt/search?mode=keyword&q=a&page=01", "/v1/trakt/search?mode=keyword&q=a&sort=likes",
      "/v1/trakt/search?mode=keyword&q=" + "a".repeat(221), "/v1/trakt/search?mode=user&q=me",
      "/v1/trakt/search?mode=user&q=a%2Fb", "/v1/trakt/search?mode=user&q=user+filter&page=2",
      "/v1/trakt/search?mode=user&q=user+filter&limit=50", "/v1/trakt/search?mode=keyword",
      "/v1/trakt/browse?kind=new", "/v1/trakt/browse?kind=popular&target=https://evil.test",
      "/v1/trakt/lists/9007199254740992/media", "/v1/trakt/lists/123/media?q=x",
      "/v1/trakt/lists/123/items?page=2", "/v1/trakt/lists/123/items?limit=0",
      "/v1/trakt/lists/123/items?limit=10&limit=10",
    ];
    for (const path of invalid) assert.equal((await h.request(path)).status, 400, path);
    for (const value of ["0", "-1", "01", "1e2", "9007199254740992", "https://evil.test/lists/1",
      "ftp://trakt.tv/lists/1", "http://trakt.tv/lists/1", "https://x@trakt.tv/lists/1",
      "https://trakt.tv/lists/1/extra", "https://trakt.tv/users/a/lists/b/items",
      "https://trakt.tv/lists/1?x=1", "https://trakt.tv:444/lists/1", "https://trakt.tv/lists/%31",
      "https://trakt.tv/users/me/lists/a", "https://trakt.tv/users/a/../lists/b", "nonsense"]) {
      assert.equal((await h.request("/v1/trakt/resolve?value=" + encodeURIComponent(value))).status, 400, value);
    }
    for (const path of ["/", "/api/trakt", "/v1/trakt/lists/0/media", "/v1/trakt/search/"]) {
      assert.equal((await h.request(path)).status, 404);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      const response = await h.request("/v1/trakt/browse?kind=popular", { method });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "GET, OPTIONS");
    }
    assert.equal(h.calls.length, 0);
    assert.equal(h.reservations.length, 0);
  });
  for (const [path, upstream, payload, cost] of [
    ["/v1/trakt/search?mode=keyword&q=unit", "/search/list", [{ list: list() }], 1],
    ["/v1/trakt/search?mode=user&q=unit-user&page=2&limit=20", "/users/unit-user/lists", [list()], 1],
    ["/v1/trakt/browse?kind=popular", "/lists/popular", [{ list: list(), like_count: 0 }], 1],
    ["/v1/trakt/browse?kind=trending", "/lists/trending", [{ list: list() }], 1],
    ["/v1/trakt/resolve?value=123", "/lists/123", list(), 1],
    ["/v1/trakt/resolve?value=https://www.trakt.tv/lists/123/", "/lists/123", list(), 1],
    ["/v1/trakt/resolve?value=https://app.trakt.tv/users/unit-user/lists/unit-list", "/users/unit-user/lists/unit-list", list(), 1],
  ]) await check("one cold call: " + path, async () => {
    const h = harness((url) => { assert.equal(url.pathname, upstream); return json(payload); });
    const response = await h.request(path);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.apiVersion, 1);
    assert.equal(h.calls.length, cost);
    assert.deepEqual(h.reservations, [cost]);
    assert.equal((body.list || body.lists[0]).availability, body.list ? "available" : "unverified");
    assert.equal((body.list || body.lists[0]).item_count, null);
    if (body.pagination) assert.equal(body.pagination.item_count, null);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.ok(response.headers.has("Permissions-Policy"));
    assert.equal(response.headers.get("Content-Security-Policy"), null);
    assert.equal(response.headers.get("Vary"), "Origin");
  });
  await check("returned list slug boundaries preserve metadata and use only route-safe URLs", async () => {
    for (const length of [121, 122, 169, 171, 1000]) {
      const value = "a".repeat(length);
      const h = harness(() => paged([{ list: list({ ids: { trakt: 123, slug: value } }) }]));
      const response = await h.request("/v1/trakt/search?mode=keyword&q=unit");
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.apiVersion, 1);
      assert.equal(body.lists[0].ids.slug, value);
      assert.equal(body.lists[0].url, length <= 121
        ? "https://trakt.tv/users/unit-user/lists/" + value : "https://trakt.tv/lists/123");
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.reservations, [1]);
    }
  });
  await check("returned list metadata is nullable and independent of route character grammar", async () => {
    for (const value of [undefined, null, " fête / collection! ", " "]) {
      const ids = value === undefined ? { trakt: 123 } : { trakt: 123, slug: value };
      const h = harness(() => paged([{ list: list({ ids }) }]));
      const response = await h.request("/v1/trakt/search?mode=keyword&q=unit");
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.apiVersion, 1);
      assert.equal(body.lists[0].ids.slug, value ?? null);
      assert.equal(body.lists[0].url, "https://trakt.tv/lists/123");
    }
    for (const user of [{ username: "unit-user" }, {}]) {
      const h = harness(() => paged([{ list: list({ user }) }]));
      const response = await h.request("/v1/trakt/search?mode=keyword&q=unit");
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.lists[0].ids.slug, "unit-list");
      assert.equal(body.lists[0].url, user.username
        ? "https://trakt.tv/users/unit-user/lists/unit-list" : "https://trakt.tv/lists/123");
    }
  });
  await check("invalid list metadata slugs fail closed without successful caching", async () => {
    for (const value of ["a".repeat(1001), "", 123, false, {}, [],
      "unit\u0000list", "unit\u001flist", "unit\u007flist", "unit\u0085list", "unit\u009flist"]) {
      const h = harness(() => paged([{ list: list({ ids: { trakt: 123, slug: value } }) }]));
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await h.request("/v1/trakt/search?mode=keyword&q=unit");
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { apiVersion: 1,
          error: { code: "INVALID_UPSTREAM_RESPONSE", message: "Trakt returned an invalid response." } });
      }
      assert.equal(h.cached.size, 0);
      assert.equal(h.calls.length, 2);
      assert.deepEqual(h.reservations, [1, 1]);
    }
  });
  await check("Resolve route segments retain their input grammar and 121-character boundary", async () => {
    for (const value of ["unit-list", "a".repeat(121)]) {
      const h = harness((url) => {
        assert.equal(url.pathname, "/users/unit-user/lists/" + value);
        return json(list({ ids: { trakt: 123, slug: value } }));
      });
      const response = await h.request("/v1/trakt/resolve?value="
        + encodeURIComponent("https://trakt.tv/users/unit-user/lists/" + value));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).list.url, "https://trakt.tv/users/unit-user/lists/" + value);
      assert.equal(h.calls.length, 1);
      assert.deepEqual(h.reservations, [1]);
    }
    const h = harness();
    for (const value of [
      "https://trakt.tv/users/unit-user/lists/" + "a".repeat(122),
      "https://trakt.tv/users/" + "a".repeat(122) + "/lists/unit-list",
      "https://trakt.tv/users/unit-user/lists/bad%2Fsegment",
      "https://trakt.tv/users/bad%2Fuser/lists/unit-list",
    ]) assert.equal((await h.request("/v1/trakt/resolve?value=" + encodeURIComponent(value))).status, 400);
    assert.equal(h.calls.length, 0);
    assert.equal(h.reservations.length, 0);
  });
  await check("item and show slugs retain their existing nullable route-safe contract", async () => {
    for (const field of ["slug", "show_slug"]) {
      for (const value of [null, "a".repeat(121), "a".repeat(122), "bad/segment", ""]) {
        const row = { type: "episode", episode: { title: "Unit episode", ids: {} }, show: { ids: {} } };
        if (field === "slug") row.episode.ids.slug = value;
        else row.show.ids.slug = value;
        const h = harness(() => paged([row], 1, 1, 15));
        const response = await h.request("/v1/trakt/lists/123/items");
        const valid = value === null || value.length === 121;
        assert.equal(response.status, valid ? 200 : 502);
        const body = await response.json();
        if (valid) assert.equal(body.items[0].ids[field], value);
        else {
          assert.equal(body.error.code, "INVALID_UPSTREAM_RESPONSE");
          assert.equal(h.cached.size, 0);
        }
      }
    }
  });
  await check("Keyword projects all 30 rows with five known long-slug lengths", async () => {
    const values = Array.from({ length: 30 }, (_, index) => index < 25
      ? "unit-list-" + index : "a".repeat(index === 29 ? 171 : 169));
    const rows = values.map((value, index) => ({ list: list({ ids: { trakt: 123 + index, slug: value } }) }));
    const h = harness(() => paged(rows));
    const response = await h.request("/v1/trakt/search?mode=keyword&q=unit&page=1&limit=30");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.apiVersion, 1);
    assert.equal(body.lists.length, 30);
    assert.deepEqual(body.pagination, { page: 1, limit: 30, page_count: 1, item_count: 30 });
    for (let index = 0; index < values.length; index++) {
      const result = body.lists.find((entry) => entry.ids.trakt === 123 + index);
      assert.ok(result);
      assert.equal(result.ids.slug, values[index]);
      assert.equal(result.url, index < 25 ? "https://trakt.tv/users/unit-user/lists/" + values[index]
        : "https://trakt.tv/lists/" + (123 + index));
    }
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.reservations, [1]);
    assert.equal(h.cached.size, 1);
  });
  await check("filtered user is bounded to three calls, with one complete reservation", async () => {
    const h = harness((url, n) => {
      assert.equal(url.pathname, "/users/unit-user/lists");
      assert.equal(url.searchParams.get("limit"), n === 3 ? "50" : "100");
      return paged(Array.from({ length: n === 3 ? 50 : 100 }, () => list()), 1000, n, n === 3 ? 50 : 100, 10);
    });
    const response = await h.request("/v1/trakt/search?mode=user&q=unit-user+absent");
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.reservations, [3]);
    assert.deepEqual((await response.json()).lists, []);
  });
  for (const [movies, shows, composition] of [[3, 4, "mixed"], [3, 0, "movie-only"], [0, 4, "show-only"], [0, 0, "zero"]]) {
    await check("media known " + composition, async () => {
      const h = harness((url) => {
        const count = url.pathname.endsWith("/movie") ? movies : shows;
        return paged(count ? [{ type: url.pathname.endsWith("/movie") ? "movie" : "show" }] : [], count, 1, 1);
      });
      const response = await h.request("/v1/trakt/lists/123/media");
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).media, { status: "known", composition, movie_count: movies, show_count: shows });
      assert.equal(h.calls.length, 2);
      assert.deepEqual(h.reservations, [2]);
    });
  }
  await check("items uses one call, real fields only, and no posters", async () => {
    const h = harness((url) => {
      assert.equal(url.pathname, "/lists/123/items/movie,show,episode,season");
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("limit"), "50");
      return paged([{ type: "movie", rank: 0, movie: { title: "Unit item", year: 2000, ids: { trakt: 1, tmdb: 2, imdb: "tt0000001" }, images: { private: true } } }], 1, 1, 50);
    });
    const response = await h.request("/v1/trakt/lists/123/items?limit=50");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.sample, "first-page");
    assert.equal(body.items[0].rank, 0);
    assert.equal(body.items[0].year, 2000);
    assert.equal(body.items[0].images, undefined);
    assert.equal(h.calls.length, 1);
  });
  await check("unknown values stay null and zero is retained", async () => {
    const h = harness(() => json([list({ item_count: 0, likes: 0, user: undefined, description: undefined })]));
    const body = await (await h.request("/v1/trakt/search?mode=user&q=unit-user")).json();
    assert.equal(body.lists[0].item_count, 0);
    assert.equal(body.lists[0].like_count, 0);
    assert.equal(body.lists[0].creator.name, null);
    assert.equal(body.lists[0].description, null);
    assert.equal(body.lists[0].availability, "unverified");
  });
  await check("malformed upstream fails closed and is not cached", async () => {
    for (const [path, response] of [
      ["/v1/trakt/browse?kind=popular", json({ wrong: [] })],
      ["/v1/trakt/browse?kind=popular", json([null])],
      ["/v1/trakt/browse?kind=popular", json([{ list: null }])],
      ["/v1/trakt/browse?kind=popular", json([{}])],
      ["/v1/trakt/resolve?value=123", json(list({ ids: { trakt: 456 } }))],
      ["/v1/trakt/search?mode=keyword&q=unit", json([{ wrong: {} }])],
      ["/v1/trakt/resolve?value=123", json(list({ item_count: "invalid" }))],
      ["/v1/trakt/resolve?value=123", json(list({ ids: { trakt: 9007199254740992 } }))],
      ["/v1/trakt/lists/123/items", json([{ type: "movie" }])],
      ["/v1/trakt/lists/123/media", json([])],
      ["/v1/trakt/lists/123/media", json([], { "X-Pagination-Item-Count": "bad" })],
      ["/v1/trakt/lists/123/media", paged([{}], 0)],
      ["/v1/trakt/browse?kind=popular", new Response("<html>upstream</html>")],
      ["/v1/trakt/browse?kind=popular", new Response("[]", { headers: { "Content-Type": "application/jsonp" } })],
    ]) {
      const h = harness(() => response.clone());
      assert.equal((await h.request(path)).status, 502, path);
      assert.equal((await h.request(path)).status, 502, path);
      assert.equal(h.cached.size, 0);
      assert.equal(h.calls.length, 2);
    }
  });
  await check("origin-independent data cache; normalized keys; outgoing CORS and success TTL", async () => {
    const h = harness(() => paged([{ list: list() }]));
    const path = "/v1/trakt/browse?kind=popular";
    const first = await h.request(path, { headers: { Origin: "https://dingo.build" } });
    const second = await h.request(path + "&limit=30&page=1", { headers: { Origin: "https://davecollections.github.io" } });
    assert.equal(first.headers.get("Access-Control-Allow-Origin"), "https://dingo.build");
    assert.equal(second.headers.get("Access-Control-Allow-Origin"), "https://davecollections.github.io");
    assert.match(first.headers.get("Cache-Control"), /max-age=300/);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.reservations, [1]);
    assert.equal(h.cached.size, 1);
    for (const [key, value] of h.cached) {
      assert.ok(!key.includes(h.env.TRAKT_CLIENT_ID));
      assert.equal(value.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(value.headers.get("Vary"), null);
    }
    assert.equal(h.logs[1].cache, "hit");
    assert.equal(h.logs[1].reservedCost, 0);
  });
  await check("identical in-flight requests coalesce, including followers' CORS", async () => {
    let release, started;
    const signal = new Promise((resolve) => { started = resolve; });
    const h = harness(async () => { started(); await new Promise((resolve) => { release = resolve; }); return paged([]); });
    const path = "/v1/trakt/browse?kind=popular";
    const first = h.request(path, { headers: { Origin: "https://dingo.build" } });
    await signal;
    const second = h.request(path, { headers: { Origin: "https://davecollections.github.io" } });
    release();
    const responses = await Promise.all([first, second]);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.reservations, [1]);
    assert.equal(responses[1].headers.get("Access-Control-Allow-Origin"), "https://davecollections.github.io");
  });
  await check("CORS production, loopback development, and OPTIONS", async () => {
    const h = harness();
    const path = "/v1/trakt/browse?kind=popular";
    for (const origin of ["https://evil.test", "https://www.dingo.build", "null", "http://192.168.1.2:4173", "http://localhost:4173"]) {
      const response = await h.request(path, { headers: { Origin: origin } }, { ALLOW_LOOPBACK_ORIGINS: "true" });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    }
    for (const origin of ["http://localhost:4173", "http://127.0.0.1:8158"]) {
      assert.equal((await h.local(path, origin)).headers.get("Access-Control-Allow-Origin"), origin);
    }
    assert.equal((await h.local(path, "http://192.168.1.2:4173")).status, 403);
    const count = h.calls.length;
    const preflight = await h.request(path, { method: "OPTIONS", headers: {
      Origin: "https://dingo.build", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Accept",
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
    assert.equal(h.calls.length, count);
    assert.equal((await h.request(path, { method: "OPTIONS", headers: {
      Origin: "https://dingo.build", "Access-Control-Request-Method": "POST",
    } })).status, 400);
    assert.equal((await h.request(path, { method: "OPTIONS", headers: {
      Origin: "https://dingo.build", "Access-Control-Request-Headers": "Authorization",
    } })).status, 400);
  });
  await check("complete media reservation refusal makes zero calls; coordinator failure fails closed", async () => {
    const h = harness(undefined, { reservation: () => ({ allowed: false, retryAfter: 45 }) });
    const response = await h.request("/v1/trakt/lists/123/media");
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "45");
    assert.equal((await response.json()).error.code, "UPSTREAM_BUDGET");
    assert.deepEqual(h.reservations, [2]);
    assert.equal(h.calls.length, 0);
    assert.equal(h.cached.size, 0);
    const broken = harness(undefined, { reservation: () => { throw new Error("private details"); } });
    assert.equal((await broken.request("/v1/trakt/browse?kind=popular")).status, 503);
    assert.equal(broken.calls.length, 0);
    assert.equal((await broken.request("/v1/trakt/browse?kind=popular", {}, { TRAKT_CREDENTIAL_SCOPE: "unknown" })).status, 503);
  });
  await check("Trakt 429 halts media and user scans; no retries, cache, or sensitive logs", async () => {
    for (const path of ["/v1/trakt/lists/123/media", "/v1/trakt/search?mode=user&q=unit-user+private-query"]) {
      const h = harness(() => json({ error: "sensitive-upstream-body" }, { "Retry-After": "999999" }, 429));
      const response = await h.request(path);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "3600");
      assert.equal((await response.json()).error.code, "UPSTREAM_RATE_LIMIT");
      assert.equal(h.calls.length, 1);
      assert.equal(h.cached.size, 0);
      assert.equal(h.logs[0].upstream429, true);
      assert.ok(!JSON.stringify(h.logs).match(/unit-only-placeholder|private-query|sensitive-upstream-body/));
    }
    const h = harness(() => json({}, { "Retry-After": "garbage" }, 429));
    assert.equal((await h.request("/v1/trakt/browse?kind=popular")).headers.get("Retry-After"), null);
  });
  await check("anonymous throttle is independent, bounded, and expires", async () => {
    let time = 100000;
    const throttle = createRateLimiter({ maxBuckets: 1, clock: () => time });
    const req = (ip) => new Request("https://api.dingo.build", { headers: { "CF-Connecting-IP": ip } });
    assert.equal(throttle(req("one"), { API_RATE_LIMIT_PER_MINUTE: 2 }).allowed, true);
    assert.equal(throttle(req("one"), { API_RATE_LIMIT_PER_MINUTE: 2 }).allowed, true);
    assert.equal(throttle(req("one"), { API_RATE_LIMIT_PER_MINUTE: 2 }).allowed, false);
    assert.equal(throttle(req("two")).allowed, false);
    time += 60000;
    assert.equal(throttle(req("two")).allowed, true);
    const h = harness(undefined, { handler: { throttle: () => ({ allowed: false, headers: { "Retry-After": "60" } }) } });
    const response = await h.request("/v1/trakt/browse?kind=popular");
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error.code, "ABUSE_LIMIT");
    assert.equal(h.reservations.length, 0);
    assert.equal(h.calls.length, 0);
  });
  await check("expired dispatch reservation cannot start any upstream call", async () => {
    let time = 1000;
    const h = harness(undefined, { handler: { now: () => time },
      reservation: () => { time += 30000; return { allowed: true }; } });
    const response = await h.request("/v1/trakt/lists/123/media");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "RESERVATION_EXPIRED");
    assert.deepEqual(h.reservations, [2]);
    assert.equal(h.calls.length, 0);
  });
  await check("failure clears coalescing state; later request can recover", async () => {
    const h = harness((url, n) => n === 1 ? json({}, {}, 500) : paged([]));
    const path = "/v1/trakt/browse?kind=popular";
    assert.equal((await h.request(path)).status, 502);
    assert.equal((await h.request(path)).status, 200);
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.reservations, [1, 1]);
  });
} finally { globalThis.fetch = originalFetch; }
console.log("Dingo Worker checks passed: " + checks);
