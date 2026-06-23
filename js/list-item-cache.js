import { fetchTraktListItems } from "./api-client.js";
import { getListSelectionKey } from "./nuvio-export.js";

const DEFAULT_ITEM_PAGE_LIMIT = 15;
const DEFAULT_MEDIA_TYPE_MAX_PAGES = 3;
const MIXED_MINOR_TYPE_RATIO = 0.2;
const pageCache = new Map();
const TV_ITEM_TYPES = new Set(["show", "season", "episode"]);

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

export async function fetchListMediaType(result, {
  pageLimit = DEFAULT_ITEM_PAGE_LIMIT,
  maxPages = DEFAULT_MEDIA_TYPE_MAX_PAGES,
} = {}) {
  if (!canFetchListItems(result)) return createMediaTypeMetadata({ type: "UNKNOWN" });

  let page = 1;
  let pageCount = 1;
  let scanned = 0;
  let total = null;
  let movieCount = 0;
  let tvCount = 0;
  let otherCount = 0;

  try {
    while (page <= pageCount && page <= maxPages) {
      const payload = await fetchCachedListItemsPage(result, { page, limit: pageLimit, posters: false });
      const items = payload.items || [];
      const pagination = payload.pagination || {};

      scanned += items.length;
      total = pagination.item_count ?? total;
      items.forEach((item) => {
        if (item.type === "movie") {
          movieCount += 1;
        } else if (TV_ITEM_TYPES.has(item.type)) {
          tvCount += 1;
        } else {
          otherCount += 1;
        }
      });

      pageCount = pagination.page_count || pageCount;
      if (!items.length) break;
      page += 1;
    }
  } catch {
    return createMediaTypeMetadata({ type: "UNKNOWN", confidence: "unknown" });
  }

  return classifyMediaType({
    scanned,
    total,
    movieCount,
    tvCount,
    otherCount,
  });
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

function classifyMediaType({ scanned, total, movieCount, tvCount, otherCount }) {
  const recognizedCount = movieCount + tvCount;
  if (!scanned || !recognizedCount) {
    return createMediaTypeMetadata({
      type: "UNKNOWN",
      confidence: "unknown",
      scanned,
      total,
      movieCount,
      tvCount,
      otherCount,
    });
  }

  if (movieCount > 0 && tvCount > 0) {
    const minorityRatio = Math.min(movieCount, tvCount) / recognizedCount;
    if (minorityRatio >= MIXED_MINOR_TYPE_RATIO) {
      return createMediaTypeMetadata({
        type: "MIXED",
        scanned,
        total,
        movieCount,
        tvCount,
        otherCount,
      });
    }
  }

  return createMediaTypeMetadata({
    type: tvCount > movieCount ? "TV" : "MOVIE",
    scanned,
    total,
    movieCount,
    tvCount,
    otherCount,
  });
}

function createMediaTypeMetadata({
  type,
  confidence = "",
  scanned = 0,
  total = null,
  movieCount = 0,
  tvCount = 0,
  otherCount = 0,
}) {
  const recognizedCount = movieCount + tvCount;
  return {
    type,
    confidence: confidence || getMediaTypeConfidence(type, scanned, total, recognizedCount),
    scanned,
    total: Number.isFinite(Number(total)) ? Number(total) : null,
    movieCount,
    tvCount,
    otherCount,
  };
}

function getMediaTypeConfidence(type, scanned, total, recognizedCount) {
  if (type === "UNKNOWN") return "unknown";
  if (scanned < 5 || recognizedCount < 3) return "low";
  return "sampled";
}
