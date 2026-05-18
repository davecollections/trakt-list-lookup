import {
  RESULT_LIMIT,
  dedupeLists,
  getListKey,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeSearchText,
  parseTraktListUrl,
  parseUserListQuery,
  rankSearchResults,
  scoreListSearchMatch,
  singleResultPagination,
  sortLists,
} from "./trakt-api-helpers.js";
import {
  enrichListsWithLikeCounts,
  traktFetch,
} from "./trakt-client.js";

const MAX_PAGE = 25;
const USER_FILTER_LIMIT = 100;
const SORT_FETCH_LIMIT = 50;
const SORT_MAX_ITEMS = 250;
const CURATED_USER_FALLBACKS = ["snoak"];

export async function getSortedLists(mode, query, page, limit, sort, order, clientId) {
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

export async function getListPayload(mode, query, page, limit, clientId) {
  if (mode === "search") return searchLists(query, page, limit, clientId);
  if (mode === "user") return getUserLists(query, page, limit, clientId);
  if (mode === "popular" || mode === "trending") return getGlobalLists(mode, page, limit, clientId);
  throw httpError("Unsupported sorted search mode.", 400);
}

export async function searchLists(query, page, limit, clientId) {
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

export async function getGlobalLists(kind, page, limit, clientId) {
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

export async function getUserLists(username, page, limit, clientId) {
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

export async function resolveListUrl(value, clientId) {
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

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
