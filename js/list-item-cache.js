import { fetchTraktListItems } from "./api-client.js";
import { getListSelectionKey } from "./nuvio-export.js";

const DEFAULT_ITEM_PAGE_LIMIT = 15;
const pageCache = new Map();

export function canFetchListItems(result) {
  return Boolean(result?.user?.username && result?.ids?.slug);
}

export async function fetchPosterPreviewItems(result, {
  targetCount = DEFAULT_ITEM_PAGE_LIMIT,
  pageLimit = DEFAULT_ITEM_PAGE_LIMIT,
  maxPages = 1,
} = {}) {
  const posterItems = [];
  let page = 1;
  let pageCount = 1;
  let scanned = 0;
  let total = 0;

  if (!canFetchListItems(result)) {
    return { items: [], scanned, total };
  }

  while (posterItems.length < targetCount && page <= pageCount && page <= maxPages) {
    const payload = await fetchCachedListItemsPage(result, { page, limit: pageLimit });
    const items = payload.items || [];
    const pagination = payload.pagination || {};

    scanned += items.length;
    total = pagination.item_count || total || items.length;
    pageCount = pagination.page_count || pageCount;
    posterItems.push(...items.filter((item) => item.poster));

    if (!items.length) break;
    page += 1;
  }

  return {
    items: posterItems.slice(0, targetCount),
    scanned,
    total,
  };
}

export async function fetchPosterSampleUrls(result, { targetCount = 3 } = {}) {
  const preview = await fetchPosterPreviewItems(result, {
    pageLimit: Math.max(targetCount * 2, targetCount),
    targetCount,
    maxPages: 1,
  });
  return preview.items.map((item) => item.poster).filter(Boolean).slice(0, targetCount);
}

export async function fetchFirstPosterUrl(result, { maxPages = 3 } = {}) {
  try {
    const preview = await fetchPosterPreviewItems(result, {
      targetCount: 1,
      maxPages,
    });
    return preview.items[0]?.poster || "";
  } catch {
    return "";
  }
}

export function clearListItemCache() {
  pageCache.clear();
}

async function fetchCachedListItemsPage(result, { page, limit, posters = true }) {
  const key = getListSelectionKey(result);
  const cacheKey = `${key}:${page}:${limit}:${posters ? "posters" : "types"}`;
  if (pageCache.has(cacheKey)) return pageCache.get(cacheKey);

  const request = fetchTraktListItems({
    user: result.user.username,
    slug: result.ids.slug,
    limit,
    page,
    posters,
  }).catch((error) => {
    pageCache.delete(cacheKey);
    throw error;
  });

  pageCache.set(cacheKey, request);
  return request;
}
