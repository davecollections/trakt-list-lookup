const TRAKT_WEB_BASE = "https://trakt.tv";
const SUPPORTED_TRAKT_HOSTS = new Set(["trakt.tv", "app.trakt.tv"]);
export const RESULT_LIMIT = 30;

const SORTABLE_FIELDS = new Set(["title", "items", "likes", "updated"]);

export function sortLists(lists, sort, order) {
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

export function dedupeLists(lists) {
  const seen = new Set();
  return lists.filter((list) => {
    const key = getListKey(list);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getListKey(list) {
  return list?.ids?.trakt ? `id:${list.ids.trakt}` : list?.user?.username && list?.ids?.slug ? `${list.user.username}/${list.ids.slug}` : "";
}

export function parseUserListQuery(value) {
  const parts = value.replace(/^@/, "").trim().split(/\s+/);
  return {
    username: parts.shift() || "",
    filter: parts.join(" ").trim(),
  };
}

export function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function listMatchesTerms(list, terms) {
  if (!terms.length) return true;
  const haystack = normalizeSearchText([
    list.name,
    list.ids?.slug,
    list.description,
  ].filter(Boolean).join(" "));
  const compactHaystack = haystack.replace(/\s+/g, "");
  return terms.every((term) => normalizedTextIncludesTerm(haystack, compactHaystack, term));
}

export function rankSearchResults(items, query) {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return items;

  return [...items].sort((a, b) => {
    const scoreA = scoreListSearchMatch(a.list, terms, a.score);
    const scoreB = scoreListSearchMatch(b.list, terms, b.score);
    return scoreB - scoreA;
  });
}

export function scoreListSearchMatch(list, terms, traktScore = 0) {
  if (!list) return 0;

  const nameTokens = normalizeSearchText(list.name).split(" ").filter(Boolean);
  const slugTokens = normalizeSearchText(list.ids?.slug).split(" ").filter(Boolean);
  const description = normalizeSearchText(list.description);
  const name = nameTokens.join(" ");
  const slug = slugTokens.join(" ");
  const compactName = name.replace(/\s+/g, "");
  const compactSlug = slug.replace(/\s+/g, "");
  let score = Number(traktScore || 0);

  for (const term of terms) {
    if (name === term || slug === term) score += 120;
    if (nameTokens.includes(term)) score += 90;
    if (slugTokens.includes(term)) score += 75;
    if (name.startsWith(term) || slug.startsWith(term)) score += 45;
    if (term.length >= 3 && (compactName.includes(term) || compactSlug.includes(term))) score += 35;
    if (name.includes(term) || slug.includes(term)) score += 20;
    if (description.includes(term)) score += 8;
  }

  return score;
}

export function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

export function compareNumber(a, b) {
  const numberA = Number.isFinite(Number(a)) ? Number(a) : 0;
  const numberB = Number.isFinite(Number(b)) ? Number(b) : 0;
  return numberA - numberB;
}

export function normalizeSort(value) {
  return SORTABLE_FIELDS.has(value) ? value : "";
}

export function normalizeSortOrder(value) {
  return value === "asc" ? "asc" : "desc";
}

export function getPositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizeOptionalCount(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function clampPositiveInteger(value, fallback, max) {
  return Math.min(getPositiveInteger(value, fallback), max);
}

export function isSafePathSegment(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(value);
}

export function getPagination(response) {
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

export function singleResultPagination() {
  return {
    page: 1,
    limit: 1,
    page_count: 1,
    item_count: 1,
  };
}

export function parseTraktListUrl(value) {
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

export function normalizeList(list) {
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

export function normalizeGlobalListEntry(entry) {
  if (!entry) return null;
  const list = entry.list || entry;
  if (!list) return null;

  return {
    ...list,
    like_count: normalizeOptionalCount(entry.like_count) ?? normalizeOptionalCount(list.like_count) ?? undefined,
    comment_count: normalizeOptionalCount(entry.comment_count) ?? normalizeOptionalCount(list.comment_count) ?? undefined,
  };
}

export function normalizeListItem(item) {
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
    rating: Number.isFinite(Number(media.rating)) ? Number(media.rating) : null,
    season: media.season ?? item.episode?.season ?? "",
    number: media.number ?? "",
    ids: {
      trakt: media.ids?.trakt,
      tmdb: media.ids?.tmdb,
      show_tmdb: item.show?.ids?.tmdb,
      imdb: media.ids?.imdb,
      slug: media.ids?.slug,
      show_slug: item.show?.ids?.slug,
    },
  };
}

function normalizedTextIncludesTerm(haystack, compactHaystack, term) {
  if (haystack.includes(term)) return true;
  return term.length >= 3 && compactHaystack.includes(term);
}

export async function mapWithConcurrency(items, concurrency, mapper) {
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
