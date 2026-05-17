const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_WEB_BASE = "https://trakt.tv";
const SUPPORTED_TRAKT_HOSTS = new Set(["trakt.tv", "app.trakt.tv"]);
const TMDB_API_BASE = "https://api.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const RESULT_LIMIT = 30;
const MAX_RESULT_LIMIT = 50;
const ITEM_LIMIT = 15;
const MAX_PAGE = 25;
const MAX_ITEM_LIMIT = 15;
const MAX_QUERY_LENGTH = 220;
const SUCCESS_CACHE_SECONDS = 300;
const USER_FILTER_LIMIT = 100;
const LIKE_COUNT_CONCURRENCY = 5;
const TMDB_POSTER_CONCURRENCY = 5;
const SORT_FETCH_LIMIT = 50;
const SORT_MAX_ITEMS = 250;
const SORTABLE_FIELDS = new Set(["title", "items", "likes", "updated"]);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const query = (url.searchParams.get("q") || "").trim();
  const page = clampPositiveInteger(url.searchParams.get("page"), 1, MAX_PAGE);
  const resultLimit = clampPositiveInteger(url.searchParams.get("limit"), RESULT_LIMIT, MAX_RESULT_LIMIT);
  const sort = normalizeSort(url.searchParams.get("sort"));
  const order = normalizeSortOrder(url.searchParams.get("order"));
  const clientId = getClientId(env);

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

function sortLists(lists, sort, order) {
  const sorted = [...lists].sort((a, b) => {
    if (sort === "title") return compareText(a.name, b.name);
    if (sort === "items") return compareNumber(b.item_count, a.item_count);
    if (sort === "likes") return compareNumber(b.like_count, a.like_count);
    if (sort === "updated") return compareNumber(Date.parse(b.updated_at || b.updated), Date.parse(a.updated_at || a.updated));
    return 0;
  });

  if (order === "asc" && sort !== "title") sorted.reverse();
  if (order === "desc" && sort === "title") sorted.reverse();
  return sorted;
}

async function searchLists(query, page, limit, clientId) {
  const params = new URLSearchParams({
    query,
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  const payload = await traktFetch(`/search/list?${params.toString()}`, clientId);
  return {
    data: rankSearchResults(payload.data, query).map((item) => item.list).filter(Boolean),
    pagination: payload.pagination,
  };
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

async function getListItems(username, slug, page, limit, clientId) {
  const safeUsername = encodeURIComponent(username);
  const safeSlug = encodeURIComponent(slug);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  return traktFetch(`/users/${safeUsername}/lists/${safeSlug}/items?${params.toString()}`, clientId);
}

async function traktFetch(path, clientId) {
  const response = await fetch(`${TRAKT_API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("Trakt API error", {
      status: response.status,
      path,
      body: body.slice(0, 500),
    });
    throw httpError(getTraktErrorMessage(response.status, body), response.status);
  }

  return {
    data: await response.json(),
    pagination: getPagination(response),
  };
}

async function enrichListsWithLikeCounts(lists, clientId) {
  return mapWithConcurrency(lists, LIKE_COUNT_CONCURRENCY, async (list) => {
    const likeCount = await getListLikeCount(list, clientId);
    if (likeCount === null) return list;
    return {
      ...list,
      like_count: likeCount,
    };
  });
}

async function getListLikeCount(list, clientId) {
  const existingCount = normalizeOptionalCount(list?.like_count);
  if (existingCount !== null) return existingCount;

  const id = list?.ids?.trakt;
  if (!id) return null;

  try {
    const payload = await traktFetch(`/lists/${encodeURIComponent(id)}/likes?page=1&limit=1`, clientId);
    return normalizeOptionalCount(payload.pagination?.item_count);
  } catch (error) {
    console.warn("Could not fetch Trakt list likes", {
      id,
      status: error.status,
      message: error.message,
    });
    return normalizeOptionalCount(list?.like_count);
  }
}

async function enrichItemsWithTmdbPosters(items, env) {
  if (!hasTmdbAuth(env)) return items;

  return mapWithConcurrency(items, TMDB_POSTER_CONCURRENCY, async (item) => {
    const posterPath = await getTmdbPosterPath(item, env);
    if (!posterPath) return item;
    return {
      ...item,
      poster: `${TMDB_IMAGE_BASE}${posterPath}`,
    };
  });
}

async function getTmdbPosterPath(item, env) {
  const lookup = getTmdbPosterLookup(item);
  if (!lookup) return "";

  try {
    const payload = await tmdbFetch(`/3/${lookup.type}/${encodeURIComponent(lookup.id)}`, env);
    return payload?.poster_path || "";
  } catch (error) {
    console.warn("Could not fetch TMDB poster", {
      type: lookup.type,
      id: lookup.id,
      message: error.message,
    });
    return "";
  }
}

function getTmdbPosterLookup(item) {
  if (!item?.ids) return null;
  if (item.type === "movie" && item.ids.tmdb) return { type: "movie", id: item.ids.tmdb };
  if ((item.type === "show" || item.type === "season" || item.type === "episode") && item.ids.show_tmdb) {
    return { type: "tv", id: item.ids.show_tmdb };
  }
  if (item.type === "show" && item.ids.tmdb) return { type: "tv", id: item.ids.tmdb };
  return null;
}

async function tmdbFetch(path, env) {
  const url = new URL(path, TMDB_API_BASE);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
  };

  const bearerToken = getTmdbBearerToken(env);
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  } else {
    url.searchParams.set("api_key", getTmdbApiKey(env));
  }

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw httpError(`TMDB returned HTTP ${response.status}.`, response.status);
  }
  return response.json();
}

function getClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
}

function getTmdbApiKey(env) {
  return String(env.TMDB_API_KEY || env.TMDB_CLIENT_ID || "").trim();
}

function getTmdbBearerToken(env) {
  return String(env.TMDB_ACCESS_TOKEN || env.TMDB_READ_ACCESS_TOKEN || "").trim();
}

function hasTmdbAuth(env) {
  return Boolean(getTmdbApiKey(env) || getTmdbBearerToken(env));
}

function isGlobalListMode(mode) {
  return mode === "popular" || mode === "trending";
}

function parseUserListQuery(value) {
  const parts = value.replace(/^@/, "").trim().split(/\s+/);
  return {
    username: parts.shift() || "",
    filter: parts.join(" ").trim(),
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function listMatchesTerms(list, terms) {
  if (!terms.length) return true;
  const haystack = normalizeSearchText([
    list.name,
    list.ids?.slug,
    list.description,
  ].filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

function rankSearchResults(items, query) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return items;

  return [...items].sort((a, b) => {
    const scoreA = scoreListSearchMatch(a.list, terms, a.score);
    const scoreB = scoreListSearchMatch(b.list, terms, b.score);
    return scoreB - scoreA;
  });
}

function scoreListSearchMatch(list, terms, traktScore = 0) {
  if (!list) return 0;

  const nameTokens = normalizeSearchText(list.name).split(" ").filter(Boolean);
  const slugTokens = normalizeSearchText(list.ids?.slug).split(" ").filter(Boolean);
  const description = normalizeSearchText(list.description);
  const name = nameTokens.join(" ");
  const slug = slugTokens.join(" ");
  let score = Number(traktScore || 0);

  for (const term of terms) {
    if (name === term || slug === term) score += 120;
    if (nameTokens.includes(term)) score += 90;
    if (slugTokens.includes(term)) score += 75;
    if (name.startsWith(term) || slug.startsWith(term)) score += 45;
    if (name.includes(term) || slug.includes(term)) score += 20;
    if (description.includes(term)) score += 8;
  }

  return score;
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareNumber(a, b) {
  const numberA = Number.isFinite(Number(a)) ? Number(a) : 0;
  const numberB = Number.isFinite(Number(b)) ? Number(b) : 0;
  return numberA - numberB;
}

function normalizeSort(value) {
  return SORTABLE_FIELDS.has(value) ? value : "";
}

function normalizeSortOrder(value) {
  return value === "asc" ? "asc" : "desc";
}

function getPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeOptionalCount(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clampPositiveInteger(value, fallback, max) {
  return Math.min(getPositiveInteger(value, fallback), max);
}

function isSafePathSegment(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(value);
}

function getPagination(response) {
  const page = getPositiveInteger(response.headers.get("x-pagination-page"), 1);
  const limit = getPositiveInteger(response.headers.get("x-pagination-limit"), RESULT_LIMIT);
  const itemCount = getPositiveInteger(response.headers.get("x-pagination-item-count"), 0);
  const headerPageCount = getPositiveInteger(response.headers.get("x-pagination-page-count"), 1);
  const calculatedPageCount = itemCount && limit ? Math.ceil(itemCount / limit) : 1;
  const pageCount = Math.max(headerPageCount, calculatedPageCount);

  return {
    page,
    limit,
    page_count: pageCount,
    item_count: itemCount,
  };
}

function singleResultPagination() {
  return {
    page: 1,
    limit: 1,
    page_count: 1,
    item_count: 1,
  };
}

function parseTraktListUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!SUPPORTED_TRAKT_HOSTS.has(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "users" && parts[2] === "lists" && parts[1] && parts[3]) {
    return {
      kind: "user-list",
      username: parts[1],
      slug: parts[3],
    };
  }

  if (parts[0] === "lists" && parts[1] && /^\d+$/.test(parts[1])) {
    return {
      kind: "list-id",
      id: parts[1],
    };
  }

  return null;
}

function normalizeList(list) {
  if (!list) return null;

  const ids = list.ids || {};
  const user = list.user || {};
  const username = user.username || user.ids?.slug || "";
  const url = username && ids.slug
    ? `${TRAKT_WEB_BASE}/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(ids.slug)}`
    : ids.trakt
      ? `${TRAKT_WEB_BASE}/lists/${ids.trakt}`
      : "";

  return {
    name: list.name || "",
    description: list.description || "",
    privacy: list.privacy || "",
    item_count: list.item_count,
    like_count: list.like_count,
    comment_count: list.comment_count,
    updated_at: list.updated_at || list.updated || "",
    ids: {
      trakt: ids.trakt,
      slug: ids.slug,
    },
    user: {
      username,
      name: user.name || "",
    },
    url,
  };
}

function normalizeGlobalListEntry(entry) {
  if (!entry) return null;
  const list = entry.list || entry;
  if (!list) return null;

  return {
    ...list,
    like_count: normalizeOptionalCount(entry.like_count) ?? normalizeOptionalCount(list.like_count) ?? undefined,
    comment_count: normalizeOptionalCount(entry.comment_count) ?? normalizeOptionalCount(list.comment_count) ?? undefined,
  };
}

function normalizeListItem(item) {
  if (!item || !item.type) return null;

  const media = item[item.type] || {};
  const title = item.type === "episode" && item.show?.title
    ? `${item.show.title}: ${media.title || "Untitled episode"}`
    : media.title || media.name || "Untitled";

  return {
    rank: item.rank,
    type: item.type,
    title,
    year: media.year || item.show?.year || "",
    ids: {
      trakt: media.ids?.trakt,
      tmdb: media.ids?.tmdb,
      show_tmdb: item.show?.ids?.tmdb,
      imdb: media.ids?.imdb,
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

function getTraktErrorMessage(status, body = "") {
  const detail = body ? ` Trakt response: ${body.slice(0, 240)}` : "";
  if (status === 401) return "Trakt requires OAuth for that request.";
  if (status === 403) return `Trakt rejected the API key or the app is not approved.${detail}`;
  if (status === 404) return "No matching Trakt list was found.";
  if (status === 429) return "Trakt rate limit exceeded. Try again shortly.";
  return `Trakt returned HTTP ${status}.${detail}`;
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
