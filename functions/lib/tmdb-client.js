import { mapWithConcurrency } from "./trakt-api-helpers.js";

const TMDB_API_BASE = "https://api.themoviedb.org";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const TMDB_POSTER_CONCURRENCY = 5;

export async function enrichItemsWithTmdbPosters(items, env) {
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

  let response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch (error) {
    throw httpError(`TMDB request failed: ${error.message}`, 502);
  }

  if (!response.ok) {
    throw httpError(`TMDB returned HTTP ${response.status}.`, response.status);
  }
  return parseJsonResponse(response, path);
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

async function parseJsonResponse(response, path) {
  const contentType = response.headers.get("content-type") || "";
  if (!isJsonContentType(contentType)) {
    throw httpError(`TMDB returned a non-JSON response for ${path}.`, 502);
  }

  try {
    return await response.json();
  } catch (error) {
    throw httpError(`Could not parse TMDB JSON for ${path}: ${error.message}`, 502);
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
