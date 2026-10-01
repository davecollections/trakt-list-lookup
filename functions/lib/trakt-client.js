import { budgetError, boundedRetryAfter, rateLimitEvidence } from "./trakt-budget.js";
import { getPagination } from "./trakt-api-helpers.js";

const TRAKT_API_BASE = "https://api.trakt.tv";

export function getTraktClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
}

export async function traktFetch(path, clientId, options = {}) {
  if (!options.accounting?.run) throw budgetError(503, "ACCOUNTING_REQUIRED", "Trakt service is not configured.");
  return options.accounting.run(() => dispatchTraktFetch(path, clientId, options));
}

async function dispatchTraktFetch(path, clientId, options) {
  const { timeoutMs = 0 } = options;
  const controller = timeoutMs > 0 && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchTraktPayload(path, clientId, { ...options, signal: controller?.signal,
      headersReceived: options.strict ? undefined : () => { if (timer) clearTimeout(timer); } });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchTraktPayload(path, clientId, { quietStatuses = [], quietNetworkErrors = false, strict = false, onResponse, onRateLimit, signal, headersReceived } = {}) {
  let response;

  try {
    response = await fetch(`${TRAKT_API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
        "trakt-api-version": "2",
        "trakt-api-key": clientId,
      },
      signal,
      redirect: "manual",
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    if (!quietNetworkErrors && !strict) {
      console.error(timedOut ? "Trakt API request timed out" : "Trakt API request failed");
    }
    throw httpError(timedOut ? "Trakt request timed out." : "Trakt request failed.", timedOut ? 504 : 502);
  }
  headersReceived?.();
  onResponse?.(response.status);
  const evidence = rateLimitEvidence(response.headers.get("x-ratelimit"));
  if (evidence) onRateLimit?.(evidence);

  // Manual mode is supported by workerd and never forwards credentials on redirect.
  if (response.status >= 300 && response.status < 400) {
    throw httpError("Trakt returned an unexpected redirect.", 502);
  }

  if (!response.ok) {
    const retryAfter = boundedRetryAfter(response.headers.get("retry-after"));
    const rateLimit = evidence;
    if (!strict && !quietStatuses.includes(response.status)) {
      console.error("Trakt API error", {
        status: response.status,
        retryAfter,
        rateLimit,
      });
    }
    throw httpError(getTraktErrorMessage(response.status), response.status, {
      retryAfter,
    });
  }

  return {
    data: await parseJsonResponse(response, strict),
    pagination: getPagination(response, { strict }),
  };
}

export async function getListItems(listId, page, limit, clientId, options = {}) {
  const safeListId = encodeURIComponent(listId);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return traktFetch(`/lists/${safeListId}/items/movie,show,episode,season?${params.toString()}`, clientId, options);
}

export async function getListMediaComposition(listId, clientId, options = {}) {
  const safeListId = encodeURIComponent(listId);
  const params = new URLSearchParams({
    page: "1",
    limit: "1",
  });

  const getMovies = () => traktFetch(`/lists/${safeListId}/items/movie?${params.toString()}`, clientId, options);
  const getShows = () => traktFetch(`/lists/${safeListId}/items/show?${params.toString()}`, clientId, options);
  // Strict callers stop after a failed first request, particularly upstream 429.
  const movies = options.strict ? await getMovies() : null;
  if (options.strict) validateMediaPage(movies);
  const [moviePayload, showPayload] = options.strict
    ? [movies, await getShows()]
    : await Promise.all([getMovies(), getShows()]);
  if (options.strict) {
    validateMediaPage(showPayload);
    return { movie_count: moviePayload.pagination.item_count, show_count: showPayload.pagination.item_count };
  }

  const movieCount = Number(moviePayload.pagination?.item_count || 0);
  const showCount = Number(showPayload.pagination?.item_count || 0);

  return {
    movie_count: Number.isFinite(movieCount) ? movieCount : 0,
    show_count: Number.isFinite(showCount) ? showCount : 0,
  };
}

export async function getListItemsByRoute(username, slug, page, limit, clientId, options = {}) {
  const safeUsername = encodeURIComponent(username);
  const safeSlug = encodeURIComponent(slug);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return traktFetch(`/users/${safeUsername}/lists/${safeSlug}/items?${params.toString()}`, clientId, options);
}

function getTraktErrorMessage(status) {
  if (status === 401) return "Trakt requires OAuth for that request.";
  if (status === 403) return "Trakt rejected the API key or the app is not approved.";
  if (status === 404) return "No matching Trakt list was found.";
  if (status === 429) return "Trakt rate limit exceeded. Try again shortly.";
  return `Trakt returned HTTP ${status}.`;
}

async function parseJsonResponse(response, strict) {
  const contentType = response.headers.get("content-type") || "";
  if (!isJsonContentType(contentType, strict)) {
    if (!strict) console.error("Trakt API returned a non-JSON response", {
      status: response.status,
    });
    throw httpError("Trakt returned an invalid response.", 502);
  }

  try {
    return await response.json();
  } catch (error) {
    if (!strict) console.error("Could not parse Trakt API JSON", {
      status: response.status,
    });
    throw httpError("Trakt returned an invalid response.", 502);
  }
}

function isJsonContentType(value, strict = false) {
  if (strict) return /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(value);
  const contentType = value.toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}

function httpError(message, status, { retryAfter = "" } = {}) {
  const error = new Error(message);
  error.status = status;
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
}

function validateMediaPage(payload) {
  const count = payload.pagination?.item_count;
  if (!Array.isArray(payload.data) || !Number.isSafeInteger(count) || count < 0
      || payload.data.length > 1 || (count === 0 && payload.data.length !== 0)
      || (count > 0 && payload.data.length !== 1)) {
    throw httpError("Trakt returned an unresolved media count.", 502);
  }
}
