import { createTraktAccounting } from "../../functions/lib/trakt-budget.js";
import { json } from "../../functions/lib/http-response.js";
import { createRateLimiter } from "../../functions/lib/rate-limit.js";
import { getTraktClientId, getListItems, getListMediaComposition } from "../../functions/lib/trakt-client.js";
import { searchLists, getUserLists, getGlobalLists, resolveListUrl } from "../../functions/lib/trakt-list-service.js";
import { parseRoute, listMetadata, itemSample, arrayPayload, boundedRetryAfter, failure } from "./contract.js";

const ORIGINS = new Set(["https://davecollections.github.io", "https://dingo.build"]);
function allowedOrigin(origin, requestUrl, env) {
  if (ORIGINS.has(origin)) return true;
  // A production-domain request cannot enable loopback CORS even with a mistaken flag.
  if (env.ALLOW_LOOPBACK_ORIGINS !== "true" || !["localhost", "127.0.0.1"].includes(requestUrl.hostname)) return false;
  try {
    const parsed = new URL(origin);
    return origin === parsed.origin && parsed.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch { return false; }
}
function apiJson(payload, status = 200, cacheable = false, headers = {}) {
  const response = json({ apiVersion: 1, ...payload }, status, cacheable, headers);
  response.headers.delete("Content-Security-Policy");
  return response;
}
function outgoing(response, origin, allowed) {
  const result = new Response(response.body, response);
  result.headers.set("Vary", "Origin");
  if (origin && allowed) {
    result.headers.set("Access-Control-Allow-Origin", origin);
    result.headers.set("Access-Control-Expose-Headers", "Retry-After");
  }
  return result;
}

export function createDingoHandler({
  cache = () => globalThis.caches?.default,
  now = Date.now,
  log = (entry) => console.log(JSON.stringify(entry)),
  throttle = createRateLimiter({ maxBuckets: 10000 }),
} = {}) {
  const pending = new Map();
  return async function handle(request, env = {}) {
    const started = now();
    const stats = { event: "dingo_trakt_request", route: "unknown", operation: "none",
      cache: "none", reservedCost: 0, budgetRefused: false, upstreamStatuses: [], rateLimits: [] };
    let origin = null;
    let allowOrigin = false;
    let response;
    try {
      const url = new URL(request.url);
      origin = request.headers.get("Origin");
      allowOrigin = origin !== null && allowedOrigin(origin, url, env);
      if (!["GET", "OPTIONS"].includes(request.method)) {
        response = apiJson({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and OPTIONS are supported." } },
          405, false, { Allow: "GET, OPTIONS" });
      } else {
        if (origin !== null && !allowOrigin) throw failure(403, "ORIGIN_DENIED", "Origin is not allowed.");
        const op = parseRoute(url);
        stats.route = op.route;
        stats.operation = op.mode || op.kind || op.route;
        const rate = throttle(request, { API_RATE_LIMIT_PER_MINUTE: 60 });
        if (!rate.allowed) throw failure(429, "ABUSE_LIMIT", "Too many requests. Try again shortly.", rate.headers["Retry-After"]);
        if (request.method === "OPTIONS") {
          const method = request.headers.get("Access-Control-Request-Method");
          const headers = request.headers.get("Access-Control-Request-Headers") || "";
          if (!origin || (method && !["GET", "OPTIONS"].includes(method))
              || headers.split(",").some((header) => header.trim() && header.trim().toLowerCase() !== "accept")) {
            throw failure(400, "INVALID_PREFLIGHT", "Unsupported preflight request.");
          }
          response = new Response(null, { status: 204, headers: {
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Accept",
            "Access-Control-Max-Age": "600",
          } });
        } else {
          const clientId = getTraktClientId(env);
          if (!clientId || env.TRAKT_CREDENTIAL_SCOPE !== "shared" || !env.TRAKT_BUDGET) {
            throw failure(503, "SERVICE_NOT_CONFIGURED", "Trakt service is not configured.");
          }
          let dataCache;
          try { dataCache = cache(); } catch { /* Cache failure never bypasses reservations. */ }
          const key = new Request(op.cacheKey);
          let hit;
          try { hit = await dataCache?.match(key); } catch { /* Continue cold, with budget. */ }
          if (hit?.status === 200) {
            stats.cache = "hit";
            response = hit;
          } else {
            const existing = pending.get(op.cacheKey);
            stats.cache = existing ? "coalesced" : "miss";
            if (existing) response = (await existing).clone();
            else {
              if (pending.size >= 64) throw failure(503, "SERVICE_BUSY", "Trakt service is busy. Try again shortly.");
              const work = coldRequest(op, clientId, env, stats, dataCache, key);
              pending.set(op.cacheKey, work);
              try { response = (await work).clone(); }
              finally { pending.delete(op.cacheKey); }
            }
          }
        }
      }
    } catch (error) {
      const known = error.code && [400, 403, 404, 429, 502, 503].includes(error.status);
      const status = known ? error.status : error.status === 429 ? 429 : error.status === 404 ? 404 : 502;
      const code = known ? error.code : status === 429 ? "UPSTREAM_RATE_LIMIT" : status === 404 ? "LIST_NOT_FOUND" : "UPSTREAM_FAILURE";
      const message = known ? error.message : status === 429 ? "Trakt rate limit exceeded. Try again shortly."
        : status === 404 ? "No public Trakt list was found." : "Trakt request failed. Try again shortly.";
      const retry = boundedRetryAfter(String(error.retryAfter ?? ""));
      response = apiJson({ error: { code, message } }, status, false, retry ? { "Retry-After": retry } : {});
    }
    stats.status = response.status;
    stats.upstream429 = stats.upstreamStatuses.includes(429);
    stats.latencyMs = Math.max(0, now() - started);
    try { log(stats); } catch { /* Logging cannot fail the API. */ }
    return outgoing(response, origin, allowOrigin);
  };

  async function coldRequest(op, clientId, env, stats, dataCache, key) {
    const accounting = await createTraktAccounting(env, {
      operationCost: op.cost, now,
      onReserve: (units) => { stats.reservedCost += units; },
      onRefused: () => { stats.budgetRefused = true; },
    });
    const options = { accounting, strict: true, timeoutMs: 10000, onResponse: (status) => {
      if (stats.upstreamStatuses.length < 3) stats.upstreamStatuses.push(status);
    }, onRateLimit: (evidence) => {
      if (stats.rateLimits.length < 3) stats.rateLimits.push(evidence);
    } };
    let result;
    if (op.route === "media") {
      const counts = await getListMediaComposition(op.id, clientId, options);
      const composition = counts.movie_count > 0
        ? counts.show_count > 0 ? "mixed" : "movie-only"
        : counts.show_count > 0 ? "show-only" : "zero";
      result = { id: Number(op.id), media: { status: "known", composition, ...counts } };
    } else if (op.route === "items") {
      const payload = await getListItems(op.id, 1, op.limit, clientId, options);
      result = { id: Number(op.id), sample: "first-page", items: arrayPayload(payload.data, op.limit).map(itemSample),
        pagination: payload.pagination };
    } else {
      const payload = op.route === "resolve" ? await resolveListUrl(op.value, clientId, options)
        : op.route === "browse" ? await getGlobalLists(op.kind, op.page, op.limit, clientId, options)
        : op.mode === "keyword" ? await searchLists(op.query, op.page, op.limit, clientId, options)
        : await getUserLists(op.query, op.page, op.limit, clientId, options);
      const lists = arrayPayload(payload.data, op.route === "resolve" ? 1 : op.limit)
        .map((list) => listMetadata(list, op.route === "resolve"));
      if (op.route === "resolve") {
        if (lists.length !== 1 || lists[0].availability !== "available") {
          throw failure(404, "LIST_NOT_FOUND", "No public Trakt list was found.");
        }
        if (/^[1-9]\d*$/.test(op.value) && lists[0].ids.trakt !== Number(op.value)) {
          throw failure(502, "INVALID_UPSTREAM_RESPONSE", "Trakt returned an invalid response.");
        }
        result = { list: lists[0] };
      } else result = { lists, pagination: payload.pagination };
    }
    const response = apiJson(result, 200, true);
    try { await dataCache?.put(key, response.clone()); } catch { /* Successful data may still be returned. */ }
    return response;
  }
}

export default { fetch: createDingoHandler() };
