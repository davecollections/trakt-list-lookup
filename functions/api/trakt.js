import {
  RESULT_LIMIT,
  clampPositiveInteger,
  compareNumber,
  compareText,
  dedupeLists,
  getListKey,
  getPagination,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeList,
  normalizeListItem,
  normalizeOptionalCount,
  normalizeSearchText,
  normalizeSort,
  normalizeSortOrder,
  parseTraktListUrl,
  parseUserListQuery,
  rankSearchResults,
  scoreListSearchMatch,
  singleResultPagination,
  sortLists,
} from "../lib/trakt-api-helpers.js";
import { enrichItemsWithTmdbPosters } from "../lib/tmdb-client.js";
import {
  enrichListsWithLikeCounts,
  getListItems,
  getTraktClientId,
  traktFetch,
} from "../lib/trakt-client.js";

const MAX_RESULT_LIMIT = 50;
const ITEM_LIMIT = 15;
const MAX_PAGE = 25;
const MAX_ITEM_LIMIT = 15;
const MAX_QUERY_LENGTH = 220;
const SUCCESS_CACHE_SECONDS = 300;
const USER_FILTER_LIMIT = 100;
const SORT_FETCH_LIMIT = 50;
const SORT_MAX_ITEMS = 250;
const CURATED_USER_FALLBACKS = ["snoak"];

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

async function getSortedLists(mode, query, page, limit, sort, order, clientId) {
  const fetchLimit = SORT_FETCH_LIMIT;
  const firstPage = await getListPayload(mode, query, 1, fetchLimit, clientId);
  const pageCount = Math.min(firstPage.pagination?.page_count || 1, Math.ceil(SORT_MAX_ITEMS / fetchLimit), MAX_PAGE);
  const pages = [firstPage];

  for (let nextPage = 2; nextPage <= pageCount; nextPage += 1) {
    pages.push(await getListPayload(mode, query, nextPage, fetchLimit, clientId));
  }

  let lists = pages.flatMap((payload) => payload.data).slice(0, SORT_MAX_ITEMS);
  lists = await enrichListsWithLikeCounts(lists, clientId);
  lists = sortLists(lists, sort, order);

  const start = (page - 1) * limit;
  const data = lists.slice(start, start + limit);
  return {
    data,
    pagination: {
      page,
      limit,
      page_count: Math.max(1, Math.ceil(lists.length / limit)),
      item_count: lists.length,
    },
  };
}

async function getListPayload(mode, query, page, limit, clientId) {
  if (mode === "search") return searchLists(query, page, limit, clientId);
  if (mode === "user") return getUserLists(query, page, limit, clientId);
  if (mode === "popular" || mode === "trending") return getGlobalLists(mode, page, limit, clientId);
  throw httpError("Unsupported sorted search mode.", 400);
}

async function searchLists(query, page, limit, clientId) {
  const params = new URLSearchParams({
    query,
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  const payload = await traktFetch(`/search/list?${params.toString()}`, clientId);
  const searchResults = rankSearchResults(payload.data, query).map((item) => item.list).filter(Boolean);
  const fallbackResults = page === 1
    ? await getCuratedUserSearchMatches(query, searchResults, clientId)
    : [];
  const data = dedupeLists([...fallbackResults, ...searchResults]);
  return {
    data,
    pagination: {
      ...payload.pagination,
      item_count: Math.max(payload.pagination?.item_count || 0, data.length),
      page_count: Math.max(payload.pagination?.page_count || 1, Math.ceil(data.length / limit)),
    },
  };
}

async function getCuratedUserSearchMatches(query, existingResults, clientId) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return [];

  const existingKeys = new Set(existingResults.map(getListKey).filter(Boolean));
  const matches = [];

  for (const username of CURATED_USER_FALLBACKS) {
    try {
      const payload = await getFilteredUserLists(username, query, clientId);
      payload.data.forEach((list) => {
        const key = getListKey(list);
        if (!key || existingKeys.has(key)) return;
        existingKeys.add(key);
        matches.push(list);
      });
    } catch (error) {
      console.warn("Curated user fallback failed", {
        username,
        message: error.message,
      });
    }
  }

  return rankFallbackLists(matches, terms);
}

function rankFallbackLists(lists, terms) {
  return [...lists].sort((a, b) => {
    const scoreA = scoreListSearchMatch(a, terms, 0);
    const scoreB = scoreListSearchMatch(b, terms, 0);
    return scoreB - scoreA;
  });
}

async function getGlobalLists(kind, page, limit, clientId) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  const payload = await traktFetch(`/lists/${kind}?${params.toString()}`, clientId);
  return {
    data: payload.data.map(normalizeGlobalListEntry).filter(Boolean),
    pagination: payload.pagination,
  };
}

async function getUserLists(username, page, limit, clientId) {
  const parsed = parseUserListQuery(username);
  if (!isSafePathSegment(parsed.username)) {
    throw httpError("Invalid Trakt username.", 400);
  }

  if (parsed.filter) {
    return getFilteredUserLists(parsed.username, parsed.filter, clientId);
  }

  const safeUsername = encodeURIComponent(parsed.username);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  return traktFetch(`/users/${safeUsername}/lists?${params.toString()}`, clientId);
}

async function getFilteredUserLists(username, filter, clientId) {
  const safeUsername = encodeURIComponent(username);
  const params = new URLSearchParams({
    page: "1",
    limit: String(USER_FILTER_LIMIT),
    extended: "full",
  });
  const payload = await traktFetch(`/users/${safeUsername}/lists?${params.toString()}`, clientId);
  const terms = normalizeSearchText(filter).split(" ").filter(Boolean);
  const results = payload.data.filter((list) => listMatchesTerms(list, terms));

  return {
    data: results.slice(0, RESULT_LIMIT),
    pagination: {
      page: 1,
      limit: RESULT_LIMIT,
      page_count: 1,
      item_count: results.length,
    },
  };
}

async function resolveListUrl(value, clientId) {
  const parsed = parseTraktListUrl(value);
  if (!parsed) {
    throw httpError("That does not look like a supported Trakt list URL.", 400);
  }

  if (parsed.kind === "user-list") {
    const username = encodeURIComponent(parsed.username);
    const slug = encodeURIComponent(parsed.slug);
    const payload = await traktFetch(`/users/${username}/lists/${slug}?extended=full`, clientId);
    return {
      data: [payload.data],
      pagination: singleResultPagination(),
    };
  }

  if (parsed.kind === "list-id") {
    const payload = await traktFetch(`/lists/${encodeURIComponent(parsed.id)}?extended=full`, clientId);
    return {
      data: [payload.data],
      pagination: singleResultPagination(),
    };
  }

  throw httpError("Unsupported Trakt list URL.", 400);
}

function isGlobalListMode(mode) {
  return mode === "popular" || mode === "trending";
}

function getPublicErrorMessage(error, status) {
  if (status >= 500) return "Trakt request failed. Try again shortly.";
  return error.message || "Trakt request failed.";
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status = 200, cacheable = false) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheable
        ? `public, max-age=${SUCCESS_CACHE_SECONDS}, s-maxage=${SUCCESS_CACHE_SECONDS}`
        : "no-store",
    },
  });
}

export const __testables = {
  clampPositiveInteger,
  compareNumber,
  compareText,
  dedupeLists,
  getPagination,
  getPublicErrorMessage,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeList,
  normalizeListItem,
  normalizeOptionalCount,
  normalizeSearchText,
  normalizeSort,
  normalizeSortOrder,
  parseTraktListUrl,
  parseUserListQuery,
  rankSearchResults,
  scoreListSearchMatch,
  singleResultPagination,
  sortLists,
};
