export async function fetchTraktLists({ mode, query, page, limit, sort, sortDirection }) {
  const params = new URLSearchParams({
    mode,
    q: query,
    page: String(page),
    limit: String(limit),
  });

  if (sort && sort !== "relevance") {
    params.set("sort", sort);
    params.set("order", sortDirection);
  }

  return fetchTraktJson(params, "Trakt request failed.");
}

export async function fetchTraktListItems({ user, slug, limit, page = 1, posters = true }) {
  const params = new URLSearchParams({
    mode: "items",
    user,
    slug,
    page: String(page),
    limit: String(limit),
  });

  if (!posters) params.set("posters", "0");

  return fetchTraktJson(params, "Item lookup failed.");
}

async function fetchTraktJson(params, fallbackMessage) {
  const response = await fetch(`/api/trakt?${params.toString()}`);
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(fallbackMessage);
  }

  return payload;
}

async function readJsonPayload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!isJsonContentType(contentType)) return null;

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isJsonContentType(value) {
  const contentType = value.toLowerCase();
  return contentType.includes("application/json") || contentType.includes("+json");
}
