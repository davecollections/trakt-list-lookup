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
  enrichListsWithLikeCounts,
  getListItems,
  getTraktClientId,
} from "../lib/trakt-client.js";

const MAX_RESULT_LIMIT = 50;
const ITEM_LIMIT = 15;
const MAX_PAGE = 25;
const MAX_ITEM_LIMIT = 15;
const MAX_QUERY_LENGTH = 220;
const SORT_REQUEST_COST = 8;

export async function onRequestGet({ request, env }) {
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

  try {
    if (mode === "items") {
      const username = (url.searchParams.get("user") || "").trim();
      const slug = (url.searchParams.get("slug") || "").trim();
      const limit = clampPositiveInteger(url.searchParams.get("limit"), ITEM_LIMIT, MAX_ITEM_LIMIT);
      if (!username || !slug) {
        return json({ error: "Missing Trakt username or list slug." }, 400);
      }
      if (!isSafePathSegment(username) || !isSafePathSegment(slug)) {
        return json({ error: "Invalid Trakt username or list slug." }, 400);
      }

      const payload = await getListItems(username, slug, page, Math.min(limit, MAX_ITEM_LIMIT), clientId);
      const items = shouldIncludePosters(url)
        ? await enrichItemsWithTmdbPosters(payload.data.map(normalizeListItem).filter(Boolean), env)
        : payload.data.map(normalizeListItem).filter(Boolean);
      return json({
        items,
        pagination: payload.pagination,
      }, 200, true);
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

    const enrichedLists = sort && mode !== "url" && !directListId
      ? payload.data
      : await enrichListsWithLikeCounts(payload.data, clientId);
    const lists = await validateListAvailability(enrichedLists, clientId);
    const quickUsersPayload = mode === "url" || directListId
      ? { ...payload, quickUserLists: lists }
      : payload;
    const quickUsers = await getQuickUsers(mode, query, quickUsersPayload, clientId);

    const responsePayload = {
      results: lists.map(normalizeList).filter(Boolean),
      pagination: payload.pagination,
    };
    if (quickUsers) responsePayload.quickUsers = quickUsers;

    return json(responsePayload, 200, true);
  } catch (error) {
    const status = error.status || 502;
    return json({ error: getPublicErrorMessage(error, status) }, status);
  }
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
