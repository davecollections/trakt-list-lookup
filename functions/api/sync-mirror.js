import { json } from "../lib/http-response.js";

const TRAKT_API_BASE = "https://api.trakt.tv";
const MIRROR_MOVIES_LIST_ID = 34888329;
const DEFAULT_MAX_ITEMS = 200;
const ADD_REMOVE_BATCH_SIZE = 100;

export async function onRequestPost(context) {
  return runSync(context);
}

export async function onRequestGet(context) {
  return runSync(context);
}

async function runSync({ request, env }) {
  const authError = validateSyncAuth(request, env);
  if (authError) return authError;

  const clientId = String(env.TRAKT_CLIENT_ID || "").trim();
  const clientSecret = String(env.TRAKT_CLIENT_SECRET || "").trim();
  const refreshToken = String(env.TRAKT_REFRESH_TOKEN || "").trim();
  const maxItems = normalizeMaxItems(env.MIRROR_MAX_ITEMS);

  if (!clientId) return json({ error: "Missing TRAKT_CLIENT_ID." }, 500);
  if (!clientSecret) return json({ error: "Missing TRAKT_CLIENT_SECRET." }, 500);
  if (!refreshToken) return json({ error: "Missing TRAKT_REFRESH_TOKEN." }, 500);

  try {
    const oauth = await refreshAccessToken(clientId, clientSecret, refreshToken);
    const listId = normalizeListId(env.MIRROR_ANTICIPATED_MOVIES_LIST_ID) || MIRROR_MOVIES_LIST_ID;

    const desiredMovieIds = await fetchAnticipatedMovieIds(clientId, maxItems);
    const existingMovieIds = await fetchCurrentListMovieIds(clientId, oauth.access_token, listId);

    const toAdd = desiredMovieIds.filter((id) => !existingMovieIds.has(id));
    const toRemove = [...existingMovieIds].filter((id) => !desiredMovieIds.includes(id));

    await removeListMovies(clientId, oauth.access_token, listId, toRemove);
    await addListMovies(clientId, oauth.access_token, listId, toAdd);

    return json({
      ok: true,
      list_id: listId,
      target_count: desiredMovieIds.length,
      removed: toRemove.length,
      added: toAdd.length,
      unchanged: desiredMovieIds.length - toAdd.length,
      refresh_token_rotated: oauth.refresh_token && oauth.refresh_token !== refreshToken,
      note: oauth.refresh_token && oauth.refresh_token !== refreshToken
        ? "Trakt returned a new refresh_token. Update TRAKT_REFRESH_TOKEN in Cloudflare."
        : "",
    }, 200, false);
  } catch (error) {
    const status = error.status || 502;
    return json({ error: error.message || "Mirror sync failed." }, status, false);
  }
}

function validateSyncAuth(request, env) {
  const syncSecret = String(env.MIRROR_SYNC_SECRET || "").trim();
  if (!syncSecret) return null;

  const headerSecret = request.headers.get("x-sync-secret") || "";
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret") || "";
  if (headerSecret === syncSecret || querySecret === syncSecret) return null;

  return json({ error: "Unauthorized." }, 401, false);
}

function normalizeListId(value) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeMaxItems(value) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_ITEMS;
  return Math.min(number, 500);
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const response = await fetch(`${TRAKT_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: "https://trakt-list-lookup.pages.dev/api/trakt-oauth-callback",
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw httpError(`Trakt OAuth refresh failed (HTTP ${response.status}). ${body.slice(0, 240)}`, response.status);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw httpError("Trakt OAuth refresh response did not include access_token.", 502);
  }
  return payload;
}

async function fetchAnticipatedMovieIds(clientId, maxItems) {
  const ids = [];
  let page = 1;

  while (ids.length < maxItems) {
    const limit = Math.min(100, maxItems - ids.length);
    const response = await traktApiFetch(`/movies/anticipated?page=${page}&limit=${limit}`, clientId);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) break;

    for (const item of data) {
      const traktId = item?.movie?.ids?.trakt;
      if (Number.isFinite(Number(traktId))) ids.push(Number(traktId));
      if (ids.length >= maxItems) break;
    }

    if (data.length < limit) break;
    page += 1;
  }

  return dedupe(ids);
}

async function fetchCurrentListMovieIds(clientId, accessToken, listId) {
  const ids = new Set();
  let page = 1;
  const limit = 100;

  while (true) {
    const response = await traktAuthedFetch(`/lists/${encodeURIComponent(listId)}/items?page=${page}&limit=${limit}`, clientId, accessToken);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length) break;

    for (const item of data) {
      const traktId = item?.type === "movie" ? item?.movie?.ids?.trakt : null;
      if (Number.isFinite(Number(traktId))) ids.add(Number(traktId));
    }

    if (data.length < limit) break;
    page += 1;
  }

  return ids;
}

async function removeListMovies(clientId, accessToken, listId, movieIds) {
  if (!movieIds.length) return;

  for (const chunk of chunkArray(movieIds, ADD_REMOVE_BATCH_SIZE)) {
    await traktAuthedFetch(`/lists/${encodeURIComponent(listId)}/items/remove`, clientId, accessToken, {
      method: "POST",
      body: JSON.stringify({
        movies: chunk.map((id) => ({ ids: { trakt: id } })),
      }),
    });
  }
}

async function addListMovies(clientId, accessToken, listId, movieIds) {
  if (!movieIds.length) return;

  for (const chunk of chunkArray(movieIds, ADD_REMOVE_BATCH_SIZE)) {
    await traktAuthedFetch(`/lists/${encodeURIComponent(listId)}/items`, clientId, accessToken, {
      method: "POST",
      body: JSON.stringify({
        movies: chunk.map((id) => ({ ids: { trakt: id } })),
      }),
    });
  }
}

async function traktApiFetch(path, clientId) {
  const response = await fetch(`${TRAKT_API_BASE}${path}`, {
    headers: traktHeaders(clientId),
  });
  if (!response.ok) {
    const body = await response.text();
    throw httpError(`Trakt API request failed (HTTP ${response.status}). ${body.slice(0, 240)}`, response.status);
  }
  return response;
}

async function traktAuthedFetch(path, clientId, accessToken, options = {}) {
  const response = await fetch(`${TRAKT_API_BASE}${path}`, {
    ...options,
    headers: {
      ...traktHeaders(clientId),
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw httpError(`Trakt write request failed (HTTP ${response.status}). ${body.slice(0, 240)}`, response.status);
  }
  return response;
}

function traktHeaders(clientId) {
  return {
    "Content-Type": "application/json",
    "User-Agent": "trakt-list-lookup/0.1 (+https://trakt-list-lookup.pages.dev)",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
  };
}

function dedupe(values) {
  return [...new Set(values)];
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
