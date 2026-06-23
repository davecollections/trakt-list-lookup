import { formatNumber } from "./js/formatting.js";
import { fetchTraktLists } from "./js/api-client.js";
import { createItemPreviewUi } from "./js/item-preview-ui.js";
import { canFetchListItems, fetchListMediaType } from "./js/list-item-cache.js";
import { initModalSystem } from "./js/modal-utils.js";
import { createNuvioExportUi } from "./js/nuvio-export-ui.js";
import { createResultsView } from "./js/results-view.js";
import { createSelectionState } from "./js/selection-state.js";
import { createSelectionUi } from "./js/selection-ui.js";

const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const clearButton = document.querySelector("#clear-button");
const firstPageButton = document.querySelector("#first-page");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const lastPageButton = document.querySelector("#last-page");
const themeToggle = document.querySelector("#theme-toggle");
const sortButtons = document.querySelectorAll(".results-header [data-sort]");
const pageSizeSelect = document.querySelector("#page-size-select");
const mediaFilterStatus = document.querySelector("#media-filter-status");

const DESCRIPTION_LIMIT = 360;
const ITEMS_PREVIEW_LIMIT = 15;
const POSTER_SAMPLE_LIMIT = 3;
const MEDIA_TYPE_CONCURRENCY = 4;

const state = {
  mode: "search",
  query: "",
  page: 1,
  pagination: null,
  results: [],
  limit: 30,
  sort: "relevance",
  sortDirection: "desc",
  mediaTypeFilter: "all",
  mediaTypeLoading: false,
  selection: createSelectionState(),
};
const mediaTypeCache = new Map();
let mediaTypeRequestId = 0;
const itemPreviewUi = createItemPreviewUi({ itemPreviewLimit: ITEMS_PREVIEW_LIMIT });
const nuvioExportUi = createNuvioExportUi({ selection: state.selection });
const selectionUi = createSelectionUi({
  selection: state.selection,
  onClearSelection: clearSelection,
  onOpenNuvioExport: nuvioExportUi.open,
  onToggleSelectedList: toggleSelectedList,
});
const resultsView = createResultsView({
  posterSampleLimit: POSTER_SAMPLE_LIMIT,
  posterSampleConcurrency: 4,
  isSelected: (result) => state.selection.has(result),
  onLoadUserLists: loadUserLists,
  onOpenDescription: itemPreviewUi.openDescription,
  onOpenPreview: itemPreviewUi.openPreview,
  onToggleSelectedList: toggleSelectedList,
});

const placeholders = {
  search: "Search public lists by title or description",
  user: "Enter a username, or username plus keywords",
  url: "Paste a Trakt list URL",
  popular: "No search text needed",
  trending: "No search text needed",
};

const savedTheme = getStoredTheme();
const preferredTheme = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
setTheme(savedTheme || preferredTheme);
updateModeControls(getMode());
initModalSystem();

themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll("input[name='mode']").forEach((radio) => {
  radio.addEventListener("change", () => {
    const mode = getMode();
    updateModeControls(mode);
    if (isDiscoveryMode(mode)) {
      state.mode = mode;
      state.query = "";
      queryInput.value = "";
      runSearch(1);
    } else {
      queryInput.focus();
    }
  });
});

document.querySelectorAll("input[name='media-type']").forEach((radio) => {
  radio.addEventListener("change", () => {
    state.mediaTypeFilter = getMediaTypeFilter();
    if (state.mediaTypeFilter !== "all") {
      detectMediaTypesForResults(state.results);
      return;
    }

    state.mediaTypeLoading = false;
    mediaTypeRequestId += 1;
    renderCurrentResults();
    updateMediaFilterStatus();
  });
});

clearButton.addEventListener("click", () => {
  queryInput.value = "";
  state.page = 1;
  state.pagination = null;
  state.results = [];
  state.mediaTypeLoading = false;
  mediaTypeRequestId += 1;
  setStatus("");
  resultsView.renderResults([]);
  resultsView.renderQuickUsers([]);
  resultsView.renderPagination(null, state.page);
  updateMediaFilterStatus();
  queryInput.focus();
});

firstPageButton.addEventListener("click", () => {
  if (state.page > 1) runSearch(1);
});

prevPageButton.addEventListener("click", () => {
  if (state.page > 1) runSearch(state.page - 1);
});

nextPageButton.addEventListener("click", () => {
  const pageCount = state.pagination?.page_count || state.page + 1;
  if (state.page < pageCount) runSearch(state.page + 1);
});

lastPageButton.addEventListener("click", () => {
  const pageCount = state.pagination?.page_count || 1;
  if (state.page < pageCount) runSearch(pageCount);
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSort(button.dataset.sort);
    updateSortButtons();
    runSearch(1);
  });
});

pageSizeSelect.addEventListener("change", () => {
  state.limit = Number(pageSizeSelect.value);
  if (state.query || isDiscoveryMode(state.mode)) runSearch(1);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mode = getMode();
  const query = queryInput.value.trim();
  if (!query && !isDiscoveryMode(mode)) {
    setStatus("Enter a keyword, username, or Trakt list URL.", true);
    queryInput.focus();
    return;
  }

  state.mode = mode;
  state.query = query;
  state.limit = Number(pageSizeSelect.value);
  await runSearch(1);
});

async function runSearch(page) {
  state.page = page;
  state.mediaTypeLoading = false;
  mediaTypeRequestId += 1;
  updateMediaFilterStatus();
  setLoading(true);
  setStatus("Searching Trakt...");

  try {
    const payload = await fetchTraktLists({
      mode: state.mode,
      query: state.query,
      page: state.page,
      limit: state.limit,
      sort: state.sort,
      sortDirection: state.sortDirection,
    });

    const results = payload.results || [];
    state.results = results;
    state.pagination = payload.pagination || null;
    applyCachedMediaTypes(results);
    renderCurrentResults();
    resultsView.renderQuickUsers(results, payload.quickUsers);
    resultsView.renderPagination(state.pagination, state.page);
    if (state.mediaTypeFilter === "all") {
      updateMediaFilterStatus();
    } else {
      detectMediaTypesForResults(results);
    }

    const total = state.pagination?.item_count;
    const countText = total ? `${formatNumber(total)} total` : `${results.length} on this page`;
    setStatus(results.length ? `Found ${countText}.` : "No matching public lists found.");
  } catch (error) {
    resultsView.renderResults([]);
    state.results = [];
    state.mediaTypeLoading = false;
    resultsView.renderQuickUsers([]);
    resultsView.renderPagination(null, state.page);
    updateMediaFilterStatus();
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderCurrentResults() {
  const results = getMediaFilteredResults();
  resultsView.renderResults(results, {
    emptyMessage: getResultsEmptyMessage(),
  });
}

function getMode() {
  return document.querySelector("input[name='mode']:checked").value;
}

function getMediaTypeFilter() {
  return document.querySelector("input[name='media-type']:checked")?.value || "all";
}

function isDiscoveryMode(mode) {
  return mode === "popular" || mode === "trending";
}

function updateModeControls(mode) {
  const discoveryMode = isDiscoveryMode(mode);
  queryInput.placeholder = placeholders[mode];
  queryInput.disabled = discoveryMode;
  form.querySelector("button[type='submit']").textContent = discoveryMode ? "Load" : "Search";
}

function setLoading(isLoading) {
  form.querySelector("button[type='submit']").disabled = isLoading;
  queryInput.disabled = isLoading || isDiscoveryMode(getMode());
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function detectMediaTypesForResults(results) {
  const requestId = ++mediaTypeRequestId;
  applyCachedMediaTypes(results);
  applyUnsampledMediaTypes(results);

  const missing = results.filter((result) => {
    const key = getMediaTypeCacheKey(result);
    return key && !mediaTypeCache.has(key) && canFetchListItems(result);
  });

  if (!missing.length) {
    state.mediaTypeLoading = false;
    renderCurrentResults();
    updateMediaFilterStatus();
    return;
  }

  state.mediaTypeLoading = true;
  renderCurrentResults();
  updateMediaFilterStatus();

  let cursor = 0;
  const workers = Array.from({ length: Math.min(MEDIA_TYPE_CONCURRENCY, missing.length) }, async () => {
    while (cursor < missing.length && requestId === mediaTypeRequestId) {
      const result = missing[cursor];
      cursor += 1;
      const key = getMediaTypeCacheKey(result);
      try {
        mediaTypeCache.set(key, await fetchListMediaType(result));
      } catch {
        mediaTypeCache.set(key, getUnknownMediaTypeMetadata());
      }
    }
  });

  await Promise.all(workers);
  if (requestId !== mediaTypeRequestId) return;

  applyCachedMediaTypes(state.results);
  state.mediaTypeLoading = false;
  renderCurrentResults();
  updateMediaFilterStatus();
}

function applyCachedMediaTypes(results) {
  results.forEach((result) => {
    const key = getMediaTypeCacheKey(result);
    const metadata = normalizeMediaTypeMetadata(mediaTypeCache.get(key));
    if (metadata) applyMediaTypeMetadata(result, metadata);
  });
}

function applyUnsampledMediaTypes(results) {
  results.forEach((result) => {
    if (result.mediaTypeDetection || result.nuvioMediaType || result.mediaType) return;

    const key = getMediaTypeCacheKey(result);
    if (key && canFetchListItems(result)) return;

    const metadata = getUnknownMediaTypeMetadata();
    if (key) mediaTypeCache.set(key, metadata);
    applyMediaTypeMetadata(result, metadata);
  });
}

function getMediaTypeCacheKey(result) {
  return result?.ids?.trakt ? String(result.ids.trakt) : result?.url || "";
}

function normalizeMediaTypeMetadata(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return {
      ...getUnknownMediaTypeMetadata(),
      type: normalizeMediaTypeValue(value),
      confidence: value === "UNKNOWN" ? "unknown" : "sampled",
    };
  }

  return {
    type: normalizeMediaTypeValue(value.type),
    confidence: value.confidence || "sampled",
    scanned: Number(value.scanned || 0),
    total: value.total === null || value.total === undefined ? null : Number(value.total),
    movieCount: Number(value.movieCount || 0),
    tvCount: Number(value.tvCount || 0),
    otherCount: Number(value.otherCount || 0),
  };
}

function applyMediaTypeMetadata(result, metadata) {
  result.nuvioMediaType = metadata.type;
  result.mediaTypeDetection = metadata;
  result.mediaTypeConfidence = metadata.confidence;
  result.mediaTypeScanned = metadata.scanned;
  result.mediaTypeTotal = metadata.total;
  result.mediaTypeCounts = {
    movie: metadata.movieCount,
    tv: metadata.tvCount,
    other: metadata.otherCount,
  };
}

function getResultMediaType(result) {
  return normalizeMediaTypeValue(result?.mediaTypeDetection?.type || result?.nuvioMediaType || result?.mediaType || "UNKNOWN");
}

function getFilterMediaType(value) {
  if (value === "tv") return "TV";
  if (value === "mixed") return "MIXED";
  return "MOVIE";
}

function normalizeMediaTypeValue(value) {
  const type = String(value || "").toUpperCase();
  if (type === "TV" || type === "SHOW" || type === "SERIES") return "TV";
  if (type === "MIXED") return "MIXED";
  if (type === "MOVIE") return "MOVIE";
  return "UNKNOWN";
}

function getUnknownMediaTypeMetadata() {
  return {
    type: "UNKNOWN",
    confidence: "unknown",
    scanned: 0,
    total: null,
    movieCount: 0,
    tvCount: 0,
    otherCount: 0,
  };
}

function getMediaFilteredResults() {
  if (state.mediaTypeFilter === "all") return state.results;
  const target = getFilterMediaType(state.mediaTypeFilter);
  return state.results.filter((result) => getResultMediaType(result) === target);
}

function getResultsEmptyMessage() {
  if (!state.results.length) return "Results will appear here.";
  if (state.mediaTypeFilter === "movie") return state.mediaTypeLoading ? "Checking sampled titles..." : "No movie lists detected from the sampled titles on this page.";
  if (state.mediaTypeFilter === "tv") return state.mediaTypeLoading ? "Checking sampled titles..." : "No series lists detected from the sampled titles on this page.";
  if (state.mediaTypeFilter === "mixed") return state.mediaTypeLoading ? "Checking sampled titles..." : "No mixed lists detected from the sampled titles on this page.";
  return "No matching public lists found.";
}

function updateMediaFilterStatus() {
  if (!state.results.length) {
    mediaFilterStatus.textContent = "";
    return;
  }

  const detected = state.results.filter((result) => result.mediaTypeDetection).length;
  const movieCount = state.results.filter((result) => getResultMediaType(result) === "MOVIE").length;
  const tvCount = state.results.filter((result) => getResultMediaType(result) === "TV").length;
  const mixedCount = state.results.filter((result) => getResultMediaType(result) === "MIXED").length;
  const unknownCount = state.results.filter((result) => getResultMediaType(result) === "UNKNOWN").length;
  const visibleCount = getMediaFilteredResults().length;

  if (state.mediaTypeFilter === "all" && !detected) {
    mediaFilterStatus.textContent = "";
    return;
  }

  if (state.mediaTypeLoading) {
    mediaFilterStatus.textContent = `Checking sampled titles: ${formatNumber(detected)}/${formatNumber(state.results.length)} lists`;
    return;
  }

  const countText = [
    `${formatNumber(movieCount)} movie`,
    `${formatNumber(tvCount)} series`,
    `${formatNumber(mixedCount)} mixed`,
    `${formatNumber(unknownCount)} unknown`,
  ].filter(Boolean).join(", ");
  mediaFilterStatus.textContent = state.mediaTypeFilter === "all"
    ? `Detected from sampled titles on this page: ${countText}`
    : `Showing ${formatNumber(visibleCount)} of ${formatNumber(state.results.length)} on this page`;
}

function setSort(sort) {
  if (state.sort === sort) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    return;
  }

  state.sort = sort;
  state.sortDirection = sort === "title" ? "asc" : "desc";
}

function updateSortButtons() {
  sortButtons.forEach((button) => {
    const active = button.dataset.sort === state.sort;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? state.sortDirection : "";
    button.setAttribute("aria-sort", active ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
  });
}

async function loadUserLists(username) {
  if (!username) return;
  const userRadio = document.querySelector("input[name='mode'][value='user']");
  userRadio.checked = true;
  updateModeControls("user");
  queryInput.value = username;
  state.mode = "user";
  state.query = username;
  state.page = 1;
  await runSearch(1);
}

function toggleSelectedList(result) {
  state.selection.toggle(result);
  updateSelectionUi();
  renderCurrentResults();
}

function updateSelectionUi() {
  selectionUi.render();
  if (nuvioExportUi.isOpen()) nuvioExportUi.update();
}

function clearSelection() {
  state.selection.clear();
  updateSelectionUi();
  renderCurrentResults();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setStoredTheme(theme);
  const isDark = theme === "dark";
  themeToggle.dataset.icon = isDark ? "sun" : "moon";
  themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

function getStoredTheme() {
  try {
    return typeof localStorage === "undefined" ? "" : localStorage.getItem("theme");
  } catch {
    return "";
  }
}

function setStoredTheme(theme) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("theme", theme);
    }
  } catch {
    // Theme persistence is optional; the app should still run when storage is blocked.
  }
}
