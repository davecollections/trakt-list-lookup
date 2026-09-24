import {
  RESULT_LIMIT,
  clampPositiveInteger,
  isSafePathSegment,
  normalizeList,
  normalizeListItem,
  normalizeSort,
  normalizeSortOrder,
  parseTraktListId,
} from "../lib/trakt-api-helpers.js";
import { getPublicErrorMessage, json } from "../lib/http-response.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { enrichItemsWithTmdbPosters } from "../lib/tmdb-client.js";
import {
  getGlobalLists,
  getQuickUsersForPayload,
  getSortedLists,
  getUserLists,
  resolveListId,
  resolveListUrl,
  searchLists,
  validateListAvailability,
} from "../lib/trakt-list-service.js";
import {
  getListItems,
  getListItemsByRoute,
  getListMediaComposition,
  getTraktClientId,
} from "../lib/trakt-client.js";

const MAX_RESULT_LIMIT = 50;
const ITEM_LIMIT = 15;
const MAX_PAGE = 25;
const MAX_ITEM_LIMIT = 50;
const MAX_QUERY_LENGTH = 220;
const SORT_REQUEST_COST = 8;
const QUICK_USERS_TIMEOUT_MS = 1200;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const sort = normalizeSort(url.searchParams.get("sort"));
  const rateLimit = checkRateLimit(request, env, getRequestRateLimitCost(mode, sort));
  if (!rateLimit.allowed) {
    return json({ error: "Too many requests. Try again shortly." }, 429, false, rateLimit.headers);
  }

  const query = (url.searchParams.get("q") || "").trim();
  const page = clampPositiveInteger(url.searchParams.get("page"), 1, MAX_PAGE);
  const resultLimit = clampPositiveInteger(url.searchParams.get("limit"), RESULT_LIMIT, MAX_RESULT_LIMIT);
  const order = normalizeSortOrder(url.searchParams.get("order"));
  const clientId = getTraktClientId(env);

  if (!clientId) {
    return json({ error: "TRAKT_CLIENT_ID is not configured in Cloudflare." }, 500);
  }

  const cached = await getCachedApiResponse(request);
  if (cached) return cached;

  try {
    if (mode === "media") {
      const listId = parseTraktListId((url.searchParams.get("id") || "").trim());
      if (!listId) {
        return json({ error: "Invalid or missing Trakt list ID." }, 400);
      }

      const media = await getListMediaComposition(listId, clientId);
      return cacheSuccessfulApiResponse(request, json({
        id: Number(listId),
        ...media,
      }, 200, true), waitUntil);
    }

    if (mode === "items") {
      const rawListId = (url.searchParams.get("id") || "").trim();
      const listId = parseTraktListId(rawListId);
      const username = (url.searchParams.get("user") || "").trim();
      const slug = (url.searchParams.get("slug") || "").trim();
      const limit = clampPositiveInteger(url.searchParams.get("limit"), ITEM_LIMIT, MAX_ITEM_LIMIT);

      if (rawListId && !listId) {
        return json({ error: "Invalid Trakt list ID." }, 400);
      }

      let payload;
      if (listId) {
        payload = await getListItems(listId, page, Math.min(limit, MAX_ITEM_LIMIT), clientId);
      } else {
        if (!username || !slug) {
          return json({ error: "Missing Trakt list ID or username/list slug." }, 400);
        }
        if (!isSafePathSegment(username) || !isSafePathSegment(slug)) {
          return json({ error: "Invalid Trakt username or list slug." }, 400);
        }
        payload = await getListItemsByRoute(username, slug, page, Math.min(limit, MAX_ITEM_LIMIT), clientId);
      }

      const items = shouldIncludePosters(url)
        ? await enrichItemsWithTmdbPosters(payload.data.map(normalizeListItem).filter(Boolean), env)
        : payload.data.map(normalizeListItem).filter(Boolean);
      return cacheSuccessfulApiResponse(request, json({
        items,
        pagination: payload.pagination,
      }, 200, true), waitUntil);
    }

    if (!query && !isGlobalListMode(mode)) {
      return json({ error: "Missing search query." }, 400);
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return json({ error: `Search query is too long. Keep it under ${MAX_QUERY_LENGTH} characters.` }, 400);
    }

    const directListId = getDirectListId(mode, query);
    let payload;
    if (directListId) {
      payload = await resolveListId(directListId, clientId);
    } else if (sort && mode !== "url") {
      payload = await getSortedLists(mode, query, page, resultLimit, sort, order, clientId);
    } else if (mode === "search") {
      payload = await searchLists(query, page, resultLimit, clientId);
    } else if (mode === "user") {
      payload = await getUserLists(query, page, resultLimit, clientId);
    } else if (mode === "url") {
      payload = await resolveListUrl(query, clientId);
    } else if (mode === "popular" || mode === "trending") {
      payload = await getGlobalLists(mode, page, resultLimit, clientId);
    } else {
      return json({ error: "Unsupported search mode." }, 400);
    }

    const lists = await validateListAvailability(payload.data, clientId);
    const quickUsersPayload = {
      ...payload,
      data: lists,
      quickUserLists: lists,
    };
    const quickUsers = await withTimeout(
      getQuickUsers(mode, query, quickUsersPayload, clientId),
      QUICK_USERS_TIMEOUT_MS,
      null,
    );

    const responsePayload = {
      results: lists.map(normalizeList).filter(Boolean),
      pagination: payload.pagination,
    };
    if (quickUsers) responsePayload.quickUsers = quickUsers;

    return cacheSuccessfulApiResponse(request, json(responsePayload, 200, true), waitUntil);
  } catch (error) {
    const status = error.status || 502;
    const headers = status === 429 && error.retryAfter
      ? { "Retry-After": error.retryAfter }
      : {};
    return json({ error: getPublicErrorMessage(error, status) }, status, false, headers);
  }
}

async function getCachedApiResponse(request) {
  const cache = globalThis.caches?.default;
  if (!cache) return null;

  try {
    return await cache.match(getCacheKey(request));
  } catch (error) {
    console.warn("Could not read Trakt API response cache", {
      message: error.message,
    });
    return null;
  }
}

async function cacheSuccessfulApiResponse(request, response, waitUntil) {
  const cache = globalThis.caches?.default;
  if (!cache || !response.ok) return response;

  const write = cache.put(getCacheKey(request), response.clone()).catch((error) => {
    console.warn("Could not write Trakt API response cache", {
      message: error.message,
    });
  });

  if (typeof waitUntil === "function") {
    waitUntil(write);
  } else {
    await write;
  }

  return response;
}

function getCacheKey(request) {
  return new Request(request.url, {
    method: "GET",
  });
}

function isGlobalListMode(mode) {
  return mode === "popular" || mode === "trending";
}

function getDirectListId(mode, query) {
  if (mode !== "search" && mode !== "url") return "";
  return parseTraktListId(query);
}

function shouldIncludePosters(url) {
  return url.searchParams.get("posters") !== "0";
}

function getRequestRateLimitCost(mode, sort) {
  if (mode === "media") return 2;
  if (sort && mode !== "url") return SORT_REQUEST_COST;
  return 1;
}

async function getQuickUsers(mode, query, payload, clientId) {
  try {
    return await getQuickUsersForPayload(mode, query, payload, clientId);
  } catch (error) {
    console.warn("Could not build quick user summary", {
      mode,
      message: error.message,
    });
    return null;
  }
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
