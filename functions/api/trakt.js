const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_WEB_BASE = "https://trakt.tv";
const SUPPORTED_TRAKT_HOSTS = new Set(["trakt.tv", "app.trakt.tv"]);
const RESULT_LIMIT = 20;
const ITEM_LIMIT = 30;
const MAX_PAGE = 25;
const MAX_ITEM_LIMIT = 50;
const MAX_QUERY_LENGTH = 220;
const SUCCESS_CACHE_SECONDS = 300;
const USER_FILTER_LIMIT = 100;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const query = (url.searchParams.get("q") || "").trim();
  const page = clampPositiveInteger(url.searchParams.get("page"), 1, MAX_PAGE);
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

      const payload = await getListItems(username, slug, page, Math.min(limit, 50), clientId);
      return json({
        items: payload.data.map(normalizeListItem).filter(Boolean),
        pagination: payload.pagination,
      }, 200, true);
    }

    if (!query) {
      return json({ error: "Missing search query." }, 400);
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return json({ error: `Search query is too long. Keep it under ${MAX_QUERY_LENGTH} characters.` }, 400);
    }

    let payload;
    if (mode === "search") {
      payload = await searchLists(query, page, clientId);
    } else if (mode === "user") {
      payload = await getUserLists(query, page, clientId);
    } else if (mode === "url") {
      payload = await resolveListUrl(query, clientId);
    } else {
      return json({ error: "Unsupported search mode." }, 400);
    }

    return json({
      results: payload.data.map(normalizeList).filter(Boolean),
      pagination: payload.pagination,
    }, 200, true);
  } catch (error) {
    const status = error.status || 502;
    return json({ error: getPublicErrorMessage(error, status) }, status);
  }
}

async function searchLists(query, page, clientId) {
  const params = new URLSearchParams({
    query,
    page: String(page),
    limit: String(RESULT_LIMIT),
    extended: "full",
  });
  const payload = await traktFetch(`/search/list?${params.toString()}`, clientId);
  return {
    data: payload.data.map((item) => item.list).filter(Boolean),
    pagination: payload.pagination,
  };
}

async function getUserLists(username, page, clientId) {
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
    limit: String(RESULT_LIMIT),
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

function getClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
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

function getPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
  const pageCount = getPositiveInteger(response.headers.get("x-pagination-page-count"), 1);
  const itemCount = getPositiveInteger(response.headers.get("x-pagination-item-count"), 0);

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
      imdb: media.ids?.imdb,
    },
  };
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
