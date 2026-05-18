import {
  RESULT_LIMIT,
  clampPositiveInteger,
  isSafePathSegment,
  normalizeList,
  normalizeListItem,
  normalizeSort,
  normalizeSortOrder,
} from "../lib/trakt-api-helpers.js";
import { getPublicErrorMessage, json } from "../lib/http-response.js";
import { enrichItemsWithTmdbPosters } from "../lib/tmdb-client.js";
import {
  getGlobalLists,
  getSortedLists,
  getUserLists,
  resolveListUrl,
  searchLists,
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

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const query = (url.searchParams.get("q") || "").trim();
  const page = clampPositiveInteger(url.searchParams.get("page"), 1, MAX_PAGE);
  const resultLimit = clampPositiveInteger(url.searchParams.get("limit"), RESULT_LIMIT, MAX_RESULT_LIMIT);
  const sort = normalizeSort(url.searchParams.get("sort"));
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
      const items = await enrichItemsWithTmdbPosters(payload.data.map(normalizeListItem).filter(Boolean), env);
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

    let payload;
    if (sort && mode !== "url") {
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

    const lists = await enrichListsWithLikeCounts(payload.data, clientId);

    return json({
      results: lists.map(normalizeList).filter(Boolean),
      pagination: payload.pagination,
    }, 200, true);
  } catch (error) {
    const status = error.status || 502;
    return json({ error: getPublicErrorMessage(error, status) }, status);
  }
}

function isGlobalListMode(mode) {
  return mode === "popular" || mode === "trending";
}
