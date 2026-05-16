const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_WEB_BASE = "https://trakt.tv";
const RESULT_LIMIT = 20;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "search";
  const query = (url.searchParams.get("q") || "").trim();

  if (!query) {
    return json({ error: "Missing search query." }, 400);
  }

  const clientId = getClientId(env);

  if (!clientId) {
    return json({ error: "TRAKT_CLIENT_ID is not configured in Cloudflare." }, 500);
  }

  try {
    let results;
    if (mode === "search") {
      results = await searchLists(query, clientId);
    } else if (mode === "user") {
      results = await getUserLists(query, clientId);
    } else if (mode === "url") {
      results = await resolveListUrl(query, clientId);
    } else {
      return json({ error: "Unsupported search mode." }, 400);
    }

    return json({ results: results.map(normalizeList).filter(Boolean) });
  } catch (error) {
    const status = error.status || 502;
    return json({ error: error.message || "Trakt request failed." }, status);
  }
}

async function searchLists(query, clientId) {
  const params = new URLSearchParams({
    query,
    limit: String(RESULT_LIMIT),
    extended: "full",
  });
  const data = await traktFetch(`/search/list?${params.toString()}`, clientId);
  return data.map((item) => item.list).filter(Boolean);
}

async function getUserLists(username, clientId) {
  const safeUsername = encodeURIComponent(username.replace(/^@/, ""));
  return traktFetch(`/users/${safeUsername}/lists?extended=full`, clientId);
}

async function resolveListUrl(value, clientId) {
  const parsed = parseTraktListUrl(value);
  if (!parsed) {
    throw httpError("That does not look like a supported Trakt list URL.", 400);
  }

  if (parsed.kind === "user-list") {
    const username = encodeURIComponent(parsed.username);
    const slug = encodeURIComponent(parsed.slug);
    const list = await traktFetch(`/users/${username}/lists/${slug}?extended=full`, clientId);
    return [list];
  }

  if (parsed.kind === "list-id") {
    const list = await traktFetch(`/lists/${encodeURIComponent(parsed.id)}?extended=full`, clientId);
    return [list];
  }

  throw httpError("Unsupported Trakt list URL.", 400);
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

  return response.json();
}

function getClientId(env) {
  return String(env.TRAKT_CLIENT_ID || "").trim();
}

function parseTraktListUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "trakt.tv") return null;

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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
