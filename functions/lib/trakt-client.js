import {
  getPagination,
  mapWithConcurrency,
  normalizeOptionalCount,
} from "./trakt-api-helpers.js";

const TRAKT_API_BASE = "https://api.trakt.tv";
const LIKE_COUNT_CONCURRENCY = 12;
const LIKE_COUNT_TIMEOUT_MS = 800;
const TRANSIENT_LIKE_ERROR_STATUSES = new Set([429, 500, 502, 503, 504]);

export function getTraktClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
}

export async function traktFetch(path, clientId, { quietStatuses = [], timeoutMs = 0, quietNetworkErrors = false } = {}) {
  let response;
  const controller = timeoutMs > 0 && typeof AbortController !== "undefined"
    ? new AbortController()
    : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    response = await fetch(`${TRAKT_API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
      },
      signal: controller?.signal,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    if (!quietNetworkErrors) {
      console.error(timedOut ? "Trakt API request timed out" : "Trakt API request failed", {
        path,
        message: error.message,
      });
    }
    throw httpError(timedOut ? "Trakt request timed out." : "Trakt request failed.", timedOut ? 504 : 502);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (!quietStatuses.includes(response.status)) {
      const body = await safeReadText(response);
      console.error("Trakt API error", {
        status: response.status,
        path,
        body: body.slice(0, 500),
      });
    }
    throw httpError(getTraktErrorMessage(response.status), response.status);
  }

  return {
    data: await parseJsonResponse(response, path),
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

export async function enrichListsWithLikeCounts(lists, clientId, { likeTimeoutMs = LIKE_COUNT_TIMEOUT_MS } = {}) {
  return mapWithConcurrency(lists, LIKE_COUNT_CONCURRENCY, async (list) => {
    const likeResult = await getListLikeCount(list, clientId, { timeoutMs: likeTimeoutMs });
    const withCount = likeResult.count === null ? list : {
      ...list,
      like_count: likeResult.count,
    };

    if (!likeResult.notFound) return withCount;

    return {
      ...withCount,
      _availabilitySignals: {
        ...(withCount?._availabilitySignals || {}),
        likesNotFound: true,
      },
    };
  });
}

async function getListLikeCount(list, clientId, { timeoutMs = LIKE_COUNT_TIMEOUT_MS } = {}) {
  const existingCount = normalizeOptionalCount(list?.like_count);
  const id = list?.ids?.trakt;
  if (!id) return { count: existingCount, notFound: false };

  try {
    const payload = await traktFetch(`/lists/${encodeURIComponent(id)}/likes?page=1&limit=1`, clientId, {
      quietStatuses: [404, ...TRANSIENT_LIKE_ERROR_STATUSES],
      quietNetworkErrors: true,
      timeoutMs,
    });
    return {
      count: normalizeOptionalCount(payload.pagination?.item_count) ?? existingCount,
      notFound: false,
    };
  } catch (error) {
    if (error.status === 404) {
      return {
        count: existingCount,
        notFound: true,
      };
    }

    if (!TRANSIENT_LIKE_ERROR_STATUSES.has(error.status)) {
      console.warn("Could not fetch Trakt list likes", {
        id,
        status: error.status,
        message: error.message,
      });
    }

    return {
      count: existingCount,
      notFound: false,
    };
  }
}

function getTraktErrorMessage(status) {
  if (status === 401) return "Trakt requires OAuth for that request.";
  if (status === 403) return "Trakt rejected the API key or the app is not approved.";
  if (status === 404) return "No matching Trakt list was found.";
  if (status === 429) return "Trakt rate limit exceeded. Try again shortly.";
  return `Trakt returned HTTP ${status}.`;
}

async function parseJsonResponse(response, path) {
  const contentType = response.headers.get("content-type") || "";
  if (!isJsonContentType(contentType)) {
    console.error("Trakt API returned a non-JSON response", {
      status: response.status,
      path,
      contentType,
    });
    throw httpError("Trakt returned an invalid response.", 502);
  }

  try {
    return await response.json();
  } catch (error) {
    console.error("Could not parse Trakt API JSON", {
      status: response.status,
      path,
      message: error.message,
    });
    throw httpError("Trakt returned an invalid response.", 502);
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isJsonContentType(value) {
  const contentType = value.toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
