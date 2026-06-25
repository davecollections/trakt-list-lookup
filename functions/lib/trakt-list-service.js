import {
  RESULT_LIMIT,
  dedupeLists,
  getListKey,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeSearchText,
  parseTraktListId,
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
const QUICK_USER_SAMPLE_LIMIT = 250;
const QUICK_USER_FETCH_LIMIT = 50;
const QUICK_USER_LIMIT = 6;
const CURATED_USER_FALLBACKS = ["snoak", "extreme_one"];

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
    quickUserLists: lists,
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
  const directId = parseTraktListId(value);
  if (directId) return resolveListId(directId, clientId);

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
      quickUserLists: [payload.data],
      pagination: singleResultPagination(),
    };
  }

  if (parsed.kind === "list-id") {
    return resolveListId(parsed.id, clientId);
  }

  throw httpError("Unsupported Trakt list URL.", 400);
}

export async function resolveListId(id, clientId) {
  const listId = parseTraktListId(id);
  if (!listId) {
    throw httpError("Invalid Trakt list ID.", 400);
  }

  try {
    const payload = await traktFetch(`/lists/${encodeURIComponent(listId)}?extended=full`, clientId);
    return {
      data: [payload.data],
      quickUserLists: [payload.data],
      pagination: singleResultPagination(),
    };
  } catch (error) {
    if (error.status === 404) {
      throw httpError("No public list found for this Trakt list ID.", 404);
    }
    throw error;
  }
}

export async function getQuickUsersForPayload(mode, query, payload, clientId) {
  const lists = payload.quickUserLists || await getQuickUserSampleLists(mode, query, clientId);
  return buildQuickUsers(lists);
}

async function getQuickUserSampleLists(mode, query, clientId) {
  if (mode === "url") return [];

  const firstPage = await getListPayload(mode, query, 1, QUICK_USER_FETCH_LIMIT, clientId);
  const pageCount = Math.min(
    firstPage.pagination?.page_count || 1,
    Math.ceil(QUICK_USER_SAMPLE_LIMIT / QUICK_USER_FETCH_LIMIT),
    MAX_PAGE,
  );
  const pages = [firstPage];

  for (let nextPage = 2; nextPage <= pageCount; nextPage += 1) {
    pages.push(await getListPayload(mode, query, nextPage, QUICK_USER_FETCH_LIMIT, clientId));
  }

  return dedupeLists(pages.flatMap((page) => page.data)).slice(0, QUICK_USER_SAMPLE_LIMIT);
}

function buildQuickUsers(lists) {
  const users = new Map();

  (lists || []).forEach((list) => {
    const normalized = list ? {
      ...list,
      user: list.user || {},
      ids: list.ids || {},
    } : null;
    const username = normalized?.user?.username || normalized?.user?.ids?.slug || "";
    if (!username) return;

    const key = username.toLowerCase();
    const existing = users.get(key) || {
      username,
      name: normalized.user.name || "",
      listCount: 0,
      likeCount: 0,
      itemCount: 0,
      topList: null,
    };

    const likeCount = normalizeCount(normalized.like_count);
    const itemCount = normalizeCount(normalized.item_count);
    existing.listCount += 1;
    existing.likeCount += likeCount;
    existing.itemCount += itemCount;
    if (!existing.name && normalized.user.name) existing.name = normalized.user.name;

    if (isBetterTopList(normalized, existing.topList)) {
      existing.topList = normalized;
    }

    users.set(key, existing);
  });

  return [...users.values()]
    .sort((a, b) => compareQuickUsers(a, b))
    .slice(0, QUICK_USER_LIMIT)
    .map((user) => {
      const topList = user.topList || {};
      return {
        username: user.username,
        name: user.name,
        listCount: user.listCount,
        likeCount: user.likeCount,
        itemCount: user.itemCount,
        topListName: topList.name || "",
        topListId: topList.ids?.trakt || null,
        topListUrl: getListUrl(topList),
      };
    });
}

function compareQuickUsers(a, b) {
  return normalizeCount(b.likeCount) - normalizeCount(a.likeCount)
    || normalizeCount(b.listCount) - normalizeCount(a.listCount)
    || String(a.username).localeCompare(String(b.username), undefined, { sensitivity: "base" });
}

function isBetterTopList(candidate, current) {
  if (!current) return true;
  return normalizeCount(candidate.like_count) > normalizeCount(current.like_count)
    || (
      normalizeCount(candidate.like_count) === normalizeCount(current.like_count)
      && normalizeCount(candidate.item_count) > normalizeCount(current.item_count)
    );
}

function getListUrl(list) {
  const username = list?.user?.username || list?.user?.ids?.slug || "";
  const slug = list?.ids?.slug || "";
  if (username && slug) return `https://trakt.tv/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(slug)}`;
  return "";
}

function normalizeCount(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function getCuratedUserSearchMatches(query, existingResults, clientId) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return [];

  const existingKeys = new Set(existingResults.map(getListKey).filter(Boolean));
  const matches = [];

  for (const fallback of getSearchFallbackUsers(query)) {
    try {
      const payload = await getFilteredUserLists(fallback.username, fallback.filter, clientId);
      payload.data.forEach((list) => {
        const key = getListKey(list);
        if (!key || existingKeys.has(key)) return;
        existingKeys.add(key);
        matches.push(list);
      });
    } catch (error) {
      console.warn("Curated user fallback failed", {
        username: fallback.username,
        message: error.message,
      });
    }
  }

  return rankFallbackLists(matches, terms);
}

function getSearchFallbackUsers(query) {
  const seen = new Set();
  const fallbacks = [
    ...getExplicitUserHints(query),
    ...CURATED_USER_FALLBACKS.map((username) => ({ username, filter: query })),
  ];

  return fallbacks.filter((fallback) => {
    const key = fallback.username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getExplicitUserHints(query) {
  const tokens = String(query || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [];

  return tokens
    .map((token, index) => getExplicitUserHint(token, tokens, index))
    .filter(Boolean);
}

function getExplicitUserHint(token, tokens, index) {
  const explicit = token.startsWith("@");
  const username = token
    .replace(/^@/, "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9_.-]+$/g, "");
  const filter = tokens.filter((_, tokenIndex) => tokenIndex !== index).join(" ");

  if (!username) return "";
  if (!explicit && !/[_.]/.test(username)) return "";
  return isSafePathSegment(username) && filter ? { username, filter } : "";
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
