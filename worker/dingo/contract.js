import {
  getRouteUsername, isSafePathSegment, normalizeListMetrics, normalizeOptionalCount,
  parseTraktListId, parseTraktListUrl, parseUserListQuery,
} from "../../functions/lib/trakt-api-helpers.js";

const strict = { strict: true };
export function failure(status, code, message, retryAfter) {
  return Object.assign(new Error(message), { status, code, retryAfter });
}
const badInput = () => failure(400, "INVALID_REQUEST", "Invalid route parameters.");
const badUpstream = () => failure(502, "INVALID_UPSTREAM_RESPONSE", "Trakt returned an invalid response.");

export function parseRoute(url) {
  const match = /^\/v1\/trakt\/lists\/([1-9]\d*)\/(media|items)$/.exec(url.pathname);
  const route = match?.[2] || ({
    "/v1/trakt/search": "search", "/v1/trakt/browse": "browse", "/v1/trakt/resolve": "resolve",
  })[url.pathname];
  if (!route) throw failure(404, "NOT_FOUND", "Unknown API route.");
  const allowed = {
    search: ["mode", "q", "page", "limit"], browse: ["kind", "page", "limit"],
    resolve: ["value"], media: [], items: ["page", "limit"],
  }[route];
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw badInput();
  }
  const result = { route, cost: route === "media" ? 2 : 1 };
  const canonical = new URLSearchParams();
  function integer(key, fallback, max) {
    const text = params.get(key) ?? String(fallback);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > max) throw badInput();
    canonical.set(key, String(Number(text)));
    return Number(text);
  }
  function text(key) {
    const raw = params.get(key);
    if (!raw || raw.length > 220 || /[\u0000-\u001f\u007f]/.test(raw)) throw badInput();
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) throw badInput();
    canonical.set(key, value);
    return value;
  }
  if (match) {
    result.id = parseTraktListId(match[1], strict);
    if (!result.id) throw badInput();
  }
  if (["search", "browse", "items"].includes(route)) {
    result.page = integer("page", 1, route === "items" ? 1 : 25);
    result.limit = integer("limit", route === "items" ? 15 : 30, 50);
  }
  if (route === "search") {
    result.mode = params.get("mode");
    if (!["keyword", "user"].includes(result.mode)) throw badInput();
    canonical.set("mode", result.mode);
    result.query = text("q");
    if (result.mode === "user") {
      const parsed = parseUserListQuery(result.query);
      if (!isSafePathSegment(parsed.username) || parsed.username.toLowerCase() === "me") throw badInput();
      result.query = [parsed.username, parsed.filter].filter(Boolean).join(" ");
      canonical.set("q", result.query);
      if (parsed.filter) {
        if (result.page !== 1 || result.limit !== 30) throw badInput();
        result.cost = 3;
      }
    }
  }
  if (route === "browse") {
    result.kind = params.get("kind");
    if (!["popular", "trending"].includes(result.kind)) throw badInput();
    canonical.set("kind", result.kind);
  }
  if (route === "resolve") {
    const value = text("value");
    const id = parseTraktListId(value, strict);
    const parsed = id ? { kind: "list-id", id } : parseTraktListUrl(value, strict);
    if (!parsed || (parsed.kind === "list-id" && !parsed.id)
        || parsed.username?.toLowerCase() === "me") throw badInput();
    result.value = parsed.kind === "list-id" ? parsed.id
      : "https://trakt.tv/users/" + parsed.username + "/lists/" + parsed.slug;
    canonical.set("value", result.value);
  }
  canonical.sort();
  result.cacheKey = "https://api.dingo.build/__dingo_v1_cache" + url.pathname
    + (canonical.size ? "?" + canonical.toString() : "");
  return result;
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badUpstream();
  return value;
}
function optionalText(value, max = 20000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) throw badUpstream();
  return value;
}
function id(value) {
  if (value === undefined || value === null) return null;
  if (!parseTraktListId(value, strict)) throw badUpstream();
  return Number(value);
}
function slug(value) {
  const result = optionalText(value, 121);
  if (result !== null && !isSafePathSegment(result)) throw badUpstream();
  return result;
}

// A versioned data projection: unlike standalone presentation, never invents
// labels, zero counts or discovery-time availability. Transport stays shared.
export function listMetadata(raw, resolved = false) {
  const list = normalizeListMetrics(object(raw), strict);
  const ids = list.ids === undefined || list.ids === null ? {} : object(list.ids);
  const user = list.user === undefined || list.user === null ? {} : object(list.user);
  const trakt = id(ids.trakt);
  if (trakt === null) throw badUpstream();
  const listSlug = slug(ids.slug);
  const username = optionalText(user.username, 121);
  const name = optionalText(user.name, 500);
  const routeUsername = getRouteUsername(list) || null;
  const privacy = optionalText(list.privacy, 30);
  const updated = optionalText(list.updated_at ?? list.updated, 100);
  if (updated !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(updated) || !Number.isFinite(Date.parse(updated)))) throw badUpstream();
  const unavailable = privacy !== null && privacy !== "" && privacy !== "public";
  return {
    name: optionalText(list.name, 1000), description: optionalText(list.description),
    ids: { trakt, slug: listSlug },
    creator: { username, name, slug: routeUsername },
    url: routeUsername && listSlug ? "https://trakt.tv/users/" + encodeURIComponent(routeUsername)
      + "/lists/" + encodeURIComponent(listSlug) : trakt ? "https://trakt.tv/lists/" + trakt : null,
    item_count: normalizeOptionalCount(list.item_count, strict),
    like_count: normalizeOptionalCount(list.like_count, strict),
    updated_at: updated,
    availability: unavailable ? "unavailable" : resolved && trakt ? "available" : "unverified",
  };
}

export function itemSample(raw) {
  const item = object(raw);
  if (!["movie", "show", "season", "episode"].includes(item.type)) throw badUpstream();
  const media = object(item[item.type]);
  const ids = media.ids == null ? {} : object(media.ids);
  const show = item.show == null ? {} : object(item.show);
  const showIds = show.ids == null ? {} : object(show.ids);
  const imdb = optionalText(ids.imdb, 30);
  if (imdb !== null && !/^tt\d+$/.test(imdb)) throw badUpstream();
  return {
    type: item.type, title: optionalText(media.title ?? media.name, 2000),
    year: normalizeOptionalCount(media.year ?? show.year, strict),
    rank: normalizeOptionalCount(item.rank, strict),
    season: normalizeOptionalCount(media.season ?? item.episode?.season, strict),
    number: normalizeOptionalCount(media.number, strict),
    ids: { trakt: id(ids.trakt), tmdb: id(ids.tmdb), imdb, slug: slug(ids.slug),
      show_tmdb: id(showIds.tmdb), show_slug: slug(showIds.slug) },
  };
}

export function arrayPayload(data, max) {
  if (!Array.isArray(data) || data.length > max) throw badUpstream();
  return data;
}
export { boundedRetryAfter } from "../../functions/lib/trakt-budget.js";
