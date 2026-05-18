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

export async function fetchTraktListItems({ user, slug, limit }) {
  const params = new URLSearchParams({
    mode: "items",
    user,
    slug,
    limit: String(limit),
  });

  return fetchTraktJson(params, "Item lookup failed.");
}

async function fetchTraktJson(params, fallbackMessage) {
  const response = await fetch(`/api/trakt?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}
