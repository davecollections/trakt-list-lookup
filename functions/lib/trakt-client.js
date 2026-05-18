import {
  getPagination,
  mapWithConcurrency,
  normalizeOptionalCount,
} from "./trakt-api-helpers.js";

const TRAKT_API_BASE = "https://api.trakt.tv";
const LIKE_COUNT_CONCURRENCY = 5;

export function getTraktClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
}

export async function traktFetch(path, clientId) {
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

export async function getListItems(username, slug, page, limit, clientId) {
  const safeUsername = encodeURIComponent(username);
  const safeSlug = encodeURIComponent(slug);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    extended: "full",
  });
  return traktFetch(`/users/${safeUsername}/lists/${safeSlug}/items?${params.toString()}`, clientId);
}

export async function enrichListsWithLikeCounts(lists, clientId) {
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

function getTraktErrorMessage(status, body = "") {
  const detail = body ? ` Trakt response: ${body.slice(0, 240)}` : "";
  if (status === 401) return "Trakt requires OAuth for that request.";
  if (status === 403) return `Trakt rejected the API key or the app is not approved.${detail}`;
  if (status === 404) return "No matching Trakt list was found.";
  if (status === 429) return "Trakt rate limit exceeded. Try again shortly.";
  return `Trakt returned HTTP ${status}.${detail}`;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
