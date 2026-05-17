const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const resultsHeader = document.querySelector(".results-header");
const clearButton = document.querySelector("#clear-button");
const template = document.querySelector("#result-template");
const pager = document.querySelector("#pager");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageLabel = document.querySelector("#page-label");
const themeToggle = document.querySelector("#theme-toggle");
const sortButtons = document.querySelectorAll(".results-header [data-sort]");
const pageSizeSelect = document.querySelector("#page-size-select");
const previewModal = document.querySelector("#preview-modal");
const previewTitle = document.querySelector("#preview-title");
const previewOwner = document.querySelector("#preview-owner");
const previewStatus = document.querySelector("#preview-status");
const modalItemList = document.querySelector("#modal-item-list");
const modalCloseButton = document.querySelector("#modal-close");
const descriptionModal = document.querySelector("#description-modal");
const descriptionTitle = document.querySelector("#description-title");
const descriptionOwner = document.querySelector("#description-owner");
const descriptionFull = document.querySelector("#description-full");
const descriptionCloseButton = document.querySelector("#description-close");
const selectionPanel = document.querySelector("#selection-panel");
const selectionSummary = document.querySelector("#selection-summary");
const selectedListChips = document.querySelector("#selected-list-chips");
const openNuvioExportButton = document.querySelector("#open-nuvio-export");
const clearSelectionButton = document.querySelector("#clear-selection");
const nuvioModal = document.querySelector("#nuvio-modal");
const nuvioCloseButton = document.querySelector("#nuvio-close");
const nuvioCount = document.querySelector("#nuvio-count");
const nuvioCollectionNameInput = document.querySelector("#nuvio-collection-name");
const nuvioSortAlphaInput = document.querySelector("#nuvio-sort-alpha");
const nuvioExistingJsonInput = document.querySelector("#nuvio-existing-json");
const nuvioExistingFileInput = document.querySelector("#nuvio-existing-file");
const nuvioOutput = document.querySelector("#nuvio-output");
const copyNuvioJsonButton = document.querySelector("#copy-nuvio-json");
const downloadNuvioJsonButton = document.querySelector("#download-nuvio-json");

const DESCRIPTION_LIMIT = 360;
const ITEMS_PREVIEW_LIMIT = 15;
const POSTER_SAMPLE_LIMIT = 3;
const POSTER_SAMPLE_CONCURRENCY = 4;

const state = {
  mode: "search",
  query: "",
  page: 1,
  pagination: null,
  results: [],
  limit: 30,
  activePreviewButton: null,
  sort: "relevance",
  sortDirection: "desc",
  selectedLists: new Map(),
  posterSamples: new Map(),
};

const placeholders = {
  search: "Search public lists by title or description",
  user: "Enter a username, or username plus keywords",
  url: "Paste a Trakt list URL",
  popular: "No search text needed",
  trending: "No search text needed",
};

const savedTheme = localStorage.getItem("theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
setTheme(savedTheme || preferredTheme);
updateModeControls(getMode());

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

clearButton.addEventListener("click", () => {
  queryInput.value = "";
  state.page = 1;
  state.pagination = null;
  setStatus("");
  renderResults([]);
  renderPagination(null);
  queryInput.focus();
});

modalCloseButton.addEventListener("click", closePreview);
descriptionCloseButton.addEventListener("click", closeDescription);
nuvioCloseButton.addEventListener("click", closeNuvioExport);
openNuvioExportButton.addEventListener("click", openNuvioExport);
clearSelectionButton.addEventListener("click", clearSelection);
copyNuvioJsonButton.addEventListener("click", copyNuvioJson);
downloadNuvioJsonButton.addEventListener("click", downloadNuvioJson);
nuvioCollectionNameInput.addEventListener("input", updateNuvioOutput);
nuvioSortAlphaInput.addEventListener("change", updateNuvioOutput);
nuvioExistingJsonInput.addEventListener("input", updateNuvioOutput);
nuvioExistingFileInput.addEventListener("change", loadNuvioExistingFile);

previewModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closePreview();
});

descriptionModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-description]")) closeDescription();
});

nuvioModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-nuvio]")) closeNuvioExport();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewModal.hidden) closePreview();
  if (event.key === "Escape" && !descriptionModal.hidden) closeDescription();
  if (event.key === "Escape" && !nuvioModal.hidden) closeNuvioExport();
});

prevPageButton.addEventListener("click", () => {
  if (state.page > 1) runSearch(state.page - 1);
});

nextPageButton.addEventListener("click", () => {
  const pageCount = state.pagination?.page_count || state.page + 1;
  if (state.page < pageCount) runSearch(state.page + 1);
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSort(button.dataset.sort);
    updateSortButtons();
    renderCurrentResults();
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
  setLoading(true);
  setStatus("Searching Trakt...");

  try {
    const params = new URLSearchParams({
      mode: state.mode,
      q: state.query,
      page: String(state.page),
      limit: String(state.limit),
    });
    const response = await fetch(`/api/trakt?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Trakt request failed.");
    }

    const results = payload.results || [];
    state.results = results;
    state.pagination = payload.pagination || null;
    renderCurrentResults();
    renderPagination(state.pagination);

    const total = state.pagination?.item_count;
    const countText = total ? `${formatNumber(total)} total` : `${results.length} on this page`;
    setStatus(results.length ? `Found ${countText}.` : "No matching public lists found.");
  } catch (error) {
    renderResults([]);
    state.results = [];
    renderPagination(null);
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderCurrentResults() {
  const results = getSortedResults(state.results);
  renderResults(results);
}

function getMode() {
  return document.querySelector("input[name='mode']:checked").value;
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

function renderResults(results) {
  resultsEl.textContent = "";
  resultsEl.classList.toggle("empty-state", results.length === 0);
  resultsHeader.hidden = results.length === 0;

  if (!results.length) {
    const empty = document.createElement("p");
    empty.textContent = "Results will appear here.";
    resultsEl.append(empty);
    return;
  }

  results.forEach((result, index) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    const title = result.name || "Untitled list";
    const owner = result.user?.username || result.user?.name || "unknown";
    const url = result.url || "";

    card.id = `result-${index + 1}`;
    card.dataset.sampleKey = getPosterSampleKey(result);
    const ownerButton = node.querySelector(".result-owner");
    ownerButton.textContent = `@${owner}`;
    ownerButton.disabled = !result.user?.username;
    ownerButton.addEventListener("click", () => loadUserLists(result.user.username));
    node.querySelector(".result-title").textContent = title;
    const fullDescription = cleanDescription(result.description);
    const readMoreButton = node.querySelector(".read-more-button");
    readMoreButton.hidden = !hasDescription(result.description);
    readMoreButton.addEventListener("click", () => openDescription(result, fullDescription));
    node.querySelector(".trakt-id-button").textContent = result.ids?.trakt || "n/a";
    node.querySelector(".items").textContent = formatNumber(result.item_count);
    node.querySelector(".likes").textContent = formatNumber(result.like_count);
    node.querySelector(".updated").textContent = formatDate(result.updated_at);

    const openLink = node.querySelector(".open-link");
    openLink.href = url;
    openLink.hidden = !url;

    card.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const value = getCopyValue(button.dataset.copy, result);
        if (!value) return;
        await navigator.clipboard.writeText(value);
        flashButton(button);
      });
    });

    const posterButton = node.querySelector(".poster-samples");
    posterButton.disabled = !result.user?.username || !result.ids?.slug;
    posterButton.addEventListener("click", () => openPreview(result, posterButton));

    const selectListButton = node.querySelector(".select-list-button");
    updateSelectListButton(selectListButton, result);
    selectListButton.addEventListener("click", () => toggleSelectedList(result));

    resultsEl.append(node);
  });

  loadPosterSamplesForResults(results);
}

async function loadPosterSamplesForResults(results) {
  const queue = results.filter((result) => {
    const key = getPosterSampleKey(result);
    return key && !state.posterSamples.has(key) && result.user?.username && result.ids?.slug;
  });

  if (!queue.length) {
    results.forEach((result) => renderPosterSamples(result));
    return;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.min(POSTER_SAMPLE_CONCURRENCY, queue.length) }, async () => {
    while (cursor < queue.length) {
      const result = queue[cursor];
      cursor += 1;
      await loadPosterSamples(result);
      renderPosterSamples(result);
    }
  });

  await Promise.all(workers);
  results.forEach((result) => renderPosterSamples(result));
}

async function loadPosterSamples(result) {
  const key = getPosterSampleKey(result);
  if (!key) return;

  try {
    const params = new URLSearchParams({
      mode: "items",
      user: result.user.username,
      slug: result.ids.slug,
      limit: String(POSTER_SAMPLE_LIMIT),
    });
    const response = await fetch(`/api/trakt?${params.toString()}`);
    const payload = await response.json();
    const posters = response.ok
      ? (payload.items || []).map((item) => item.poster).filter(Boolean).slice(0, POSTER_SAMPLE_LIMIT)
      : [];
    state.posterSamples.set(key, posters);
  } catch {
    state.posterSamples.set(key, []);
  }
}

function renderPosterSamples(result) {
  const key = getPosterSampleKey(result);
  if (!key) return;
  const card = resultsEl.querySelector(`[data-sample-key="${CSS.escape(key)}"]`);
  if (!card) return;

  const sampleWrap = card.querySelector(".poster-samples");
  const posters = state.posterSamples.get(key) || [];
  sampleWrap.textContent = "";

  for (let index = 0; index < POSTER_SAMPLE_LIMIT; index += 1) {
    const poster = document.createElement("div");
    poster.className = posters[index] ? "sample-poster" : "sample-poster placeholder";
    if (posters[index]) {
      const image = document.createElement("img");
      image.src = posters[index];
      image.alt = "";
      image.loading = "lazy";
      poster.append(image);
    }
    sampleWrap.append(poster);
  }
}

function getPosterSampleKey(result) {
  return getListSelectionKey(result);
}

function getSortedResults(results) {
  const sort = state.sort;
  const sorted = [...results];
  if (sort === "title") {
    sorted.sort((a, b) => compareText(a.name, b.name));
  } else if (sort === "items") {
    sorted.sort((a, b) => compareNumber(b.item_count, a.item_count));
  } else if (sort === "likes") {
    sorted.sort((a, b) => compareNumber(b.like_count, a.like_count));
  } else if (sort === "updated") {
    sorted.sort((a, b) => compareNumber(Date.parse(b.updated_at), Date.parse(a.updated_at)));
  }

  if (state.sortDirection === "asc" && sort !== "relevance") {
    sorted.reverse();
  }
  return sorted;
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

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareNumber(a, b) {
  return Number(a || 0) - Number(b || 0);
}

function renderPagination(pagination) {
  const page = pagination?.page || state.page;
  const pageCount = pagination?.page_count || 1;
  pager.hidden = pageCount <= 1;
  pageLabel.textContent = `Page ${formatNumber(page)} of ${formatNumber(pageCount)}`;
  prevPageButton.disabled = page <= 1;
  nextPageButton.disabled = page >= pageCount;
}

async function openPreview(result, button) {
  state.activePreviewButton = button;
  if (button) {
    button.disabled = true;
    button.classList.add("loading");
  }
  previewTitle.textContent = result.name || "List Preview";
  previewOwner.textContent = result.user?.username ? `@${result.user.username}` : "Unknown owner";
  previewStatus.textContent = "Loading preview...";
  modalItemList.textContent = "";
  previewModal.hidden = false;
  document.body.classList.add("modal-open");

  try {
    const params = new URLSearchParams({
      mode: "items",
      user: result.user.username,
      slug: result.ids.slug,
      limit: String(ITEMS_PREVIEW_LIMIT),
    });
    const response = await fetch(`/api/trakt?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Item lookup failed.");
    }

    const items = payload.items || [];
    renderItems(modalItemList, items);
    const total = payload.pagination?.item_count || items.length || 0;
    previewStatus.textContent = total
      ? `Preview only: showing first ${formatNumber(Math.min(ITEMS_PREVIEW_LIMIT, items.length))} of ${formatNumber(total)}.`
      : "No items found.";
  } catch (error) {
    previewStatus.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove("loading");
    }
  }
}

function closePreview() {
  previewModal.hidden = true;
  document.body.classList.remove("modal-open");
  previewTitle.textContent = "List Preview";
  previewOwner.textContent = "";
  previewStatus.textContent = "";
  modalItemList.textContent = "";
  state.activePreviewButton = null;
}

function openDescription(result, text) {
  descriptionTitle.textContent = result.name || "Description";
  descriptionOwner.textContent = result.user?.username ? `@${result.user.username}` : "Unknown owner";
  descriptionFull.textContent = text;
  descriptionModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDescription() {
  descriptionModal.hidden = true;
  document.body.classList.remove("modal-open");
  descriptionTitle.textContent = "Description";
  descriptionOwner.textContent = "";
  descriptionFull.textContent = "";
}

function toggleSelectedList(result) {
  const key = getListSelectionKey(result);
  if (!key) return;

  if (state.selectedLists.has(key)) {
    state.selectedLists.delete(key);
  } else {
    state.selectedLists.set(key, result);
  }

  updateSelectionUi();
  renderCurrentResults();
}

function updateSelectListButton(button, result) {
  const selected = state.selectedLists.has(getListSelectionKey(result));
  button.textContent = selected ? "Remove" : "Add";
  button.classList.toggle("selected", selected);
}

function getListSelectionKey(result) {
  return result.ids?.trakt ? String(result.ids.trakt) : result.url || "";
}

function updateSelectionUi() {
  const count = state.selectedLists.size;
  selectionPanel.hidden = count === 0;
  selectionSummary.textContent = count
    ? `${formatNumber(count)} list${count === 1 ? "" : "s"} selected.`
    : "No lists selected.";
  renderSelectedListChips();
  openNuvioExportButton.disabled = count === 0;
  clearSelectionButton.disabled = count === 0;
  if (!nuvioModal.hidden) updateNuvioOutput();
}

function renderSelectedListChips() {
  selectedListChips.textContent = "";

  [...state.selectedLists.values()].slice(0, 6).forEach((result) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-chip";
    chip.textContent = result.name || "Untitled list";
    chip.title = "Remove from selection";
    chip.addEventListener("click", () => toggleSelectedList(result));
    selectedListChips.append(chip);
  });

  if (state.selectedLists.size > 6) {
    const more = document.createElement("span");
    more.className = "selected-more";
    more.textContent = `+${formatNumber(state.selectedLists.size - 6)} more`;
    selectedListChips.append(more);
  }
}

function clearSelection() {
  state.selectedLists.clear();
  updateSelectionUi();
  renderCurrentResults();
}

function openNuvioExport() {
  if (!state.selectedLists.size) return;
  nuvioCount.textContent = `${formatNumber(state.selectedLists.size)} selected`;
  updateNuvioOutput();
  nuvioModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeNuvioExport() {
  nuvioModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function loadNuvioExistingFile() {
  const file = nuvioExistingFileInput.files?.[0];
  if (!file) return;
  nuvioExistingJsonInput.value = await file.text();
  updateNuvioOutput();
}

function updateNuvioOutput() {
  try {
    nuvioOutput.value = JSON.stringify(createNuvioExportJson(), null, 2);
  } catch (error) {
    nuvioOutput.value = `Could not build JSON: ${error.message}`;
  }
}

function createNuvioExportJson() {
  const newCollection = createNuvioCollection();
  const existing = parseExistingNuvioJson();
  return existing ? [...existing, newCollection] : [newCollection];
}

function parseExistingNuvioJson() {
  const text = nuvioExistingJsonInput.value.trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Existing Nuvio JSON must be an array.");
  return parsed;
}

function createNuvioCollection() {
  const title = nuvioCollectionNameInput.value.trim() || "Trakt Lists";
  let lists = [...state.selectedLists.values()];
  if (nuvioSortAlphaInput.checked) {
    lists = lists.sort((a, b) => compareText(a.name, b.name));
  }

  return {
    id: createNuvioId("collection"),
    title,
    folders: lists.map(createNuvioFolder),
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: false,
    backdropImageUrl: "",
    focusGlowEnabled: true,
  };
}

function createNuvioFolder(result) {
  return {
    id: createNuvioId("folder"),
    title: result.name || "Trakt List",
    sources: [createNuvioTraktSource(result)],
    hideTitle: false,
    tileShape: "POSTER",
    coverEmoji: "",
    focusGifUrl: "",
    heroVideoUrl: "",
    titleLogoUrl: "",
    coverImageUrl: "",
    catalogSources: [],
    focusGifEnabled: false,
    heroBackdropUrl: "",
  };
}

function createNuvioTraktSource(result) {
  return {
    title: result.name || "Trakt List",
    sortBy: "rank.asc",
    traktId: Number(result.ids?.trakt || 0) || null,
    traktSlug: result.ids?.slug || "",
    traktUrl: result.url || "",
    traktUser: result.user?.username || "",
    filters: {},
    provider: "trakt",
    mediaType: "MIXED",
    traktSourceType: "LIST",
  };
}

function createNuvioId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function copyNuvioJson() {
  await navigator.clipboard.writeText(nuvioOutput.value);
  flashButton(copyNuvioJsonButton);
}

function downloadNuvioJson() {
  const blob = new Blob([`${nuvioOutput.value}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slugifyFilename(nuvioCollectionNameInput.value || "trakt-lists")}.nuvio.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderItems(container, items) {
  container.textContent = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "item-empty";
    empty.textContent = "No preview items returned for this list.";
    container.append(empty);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "preview-item";
    card.title = item.title || "";

    const posterWrap = document.createElement("div");
    posterWrap.className = "preview-poster";
    if (item.poster) {
      const image = document.createElement("img");
      image.src = item.poster;
      image.alt = "";
      image.loading = "lazy";
      posterWrap.append(image);
    } else {
      posterWrap.textContent = "No poster";
    }

    const traktId = document.createElement("code");
    traktId.className = "preview-trakt-id";
    traktId.textContent = item.ids?.trakt ? `trakt:${item.ids.trakt}` : "trakt:n/a";

    card.append(posterWrap, traktId);
    container.append(card);
  });
}

function cleanDescription(value) {
  if (!value) return "No description provided.";
  const text = String(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\*\*|__|[_`~]/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/[-_]{5,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "No description provided.";
  return text;
}

function hasDescription(value) {
  return cleanDescription(value) !== "No description provided.";
}

function formatNumber(value) {
  if (value === undefined || value === null || value === "") return "n/a";
  return Number(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function slugifyFilename(value) {
  return String(value || "trakt-lists")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "trakt-lists";
}

function getCopyValue(kind, result) {
  if (kind === "id") return result.ids?.trakt ? String(result.ids.trakt) : "";
  if (kind === "url") return result.url || "";
  return "";
}

function flashButton(button) {
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 900);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  const isDark = theme === "dark";
  themeToggle.dataset.icon = isDark ? "sun" : "moon";
  themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}
