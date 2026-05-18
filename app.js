const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const resultsHeader = document.querySelector(".results-header");
const quickUsers = document.querySelector("#quick-users");
const quickUserButtons = document.querySelector("#quick-user-buttons");
const clearButton = document.querySelector("#clear-button");
const template = document.querySelector("#result-template");
const pager = document.querySelector("#pager");
const firstPageButton = document.querySelector("#first-page");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const lastPageButton = document.querySelector("#last-page");
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
const manageSelectionButton = document.querySelector("#manage-selection");
const openNuvioExportButton = document.querySelector("#open-nuvio-export");
const clearSelectionButton = document.querySelector("#clear-selection");
const selectionModal = document.querySelector("#selection-modal");
const selectionCloseButton = document.querySelector("#selection-close");
const selectionModalCount = document.querySelector("#selection-modal-count");
const selectedTableBody = document.querySelector("#selected-table-body");
const nuvioModal = document.querySelector("#nuvio-modal");
const nuvioCloseButton = document.querySelector("#nuvio-close");
const nuvioCount = document.querySelector("#nuvio-count");
const nuvioExportSummary = document.querySelector("#nuvio-export-summary");
const nuvioCollectionNameInput = document.querySelector("#nuvio-collection-name");
const nuvioCoverUrlInput = document.querySelector("#nuvio-cover-url");
const nuvioSortAlphaInput = document.querySelector("#nuvio-sort-alpha");
const nuvioExistingJsonInput = document.querySelector("#nuvio-existing-json");
const nuvioExistingFileInput = document.querySelector("#nuvio-existing-file");
const nuvioMergeOptions = document.querySelector("#nuvio-merge-options");
const nuvioExistingSummary = document.querySelector("#nuvio-existing-summary");
const nuvioTargetCollectionSelect = document.querySelector("#nuvio-target-collection");
const nuvioListMapping = document.querySelector("#nuvio-list-mapping");
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
  renderQuickUsers([]);
  renderPagination(null);
  queryInput.focus();
});

modalCloseButton.addEventListener("click", closePreview);
descriptionCloseButton.addEventListener("click", closeDescription);
selectionCloseButton.addEventListener("click", closeSelectionManager);
manageSelectionButton.addEventListener("click", openSelectionManager);
nuvioCloseButton.addEventListener("click", closeNuvioExport);
openNuvioExportButton.addEventListener("click", openNuvioExport);
clearSelectionButton.addEventListener("click", clearSelection);
copyNuvioJsonButton.addEventListener("click", copyNuvioJson);
downloadNuvioJsonButton.addEventListener("click", downloadNuvioJson);
nuvioCollectionNameInput.addEventListener("input", updateNuvioOutput);
nuvioCoverUrlInput.addEventListener("input", updateNuvioOutput);
nuvioSortAlphaInput.addEventListener("change", updateNuvioOutput);
nuvioExistingJsonInput.addEventListener("input", updateNuvioOutput);
nuvioExistingFileInput.addEventListener("change", loadNuvioExistingFile);
nuvioTargetCollectionSelect.addEventListener("change", updateNuvioOutput);
nuvioListMapping.addEventListener("change", updateNuvioOutput);
document.querySelectorAll("input[name='nuvio-merge-mode']").forEach((radio) => {
  radio.addEventListener("change", () => {
    updateNuvioMergeControls();
    updateNuvioOutput();
  });
});

previewModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closePreview();
});

descriptionModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-description]")) closeDescription();
});

selectionModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-selection]")) closeSelectionManager();
});

nuvioModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-nuvio]")) closeNuvioExport();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewModal.hidden) closePreview();
  if (event.key === "Escape" && !descriptionModal.hidden) closeDescription();
  if (event.key === "Escape" && !selectionModal.hidden) closeSelectionManager();
  if (event.key === "Escape" && !nuvioModal.hidden) closeNuvioExport();
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
  setLoading(true);
  setStatus("Searching Trakt...");

  try {
    const params = new URLSearchParams({
      mode: state.mode,
      q: state.query,
      page: String(state.page),
      limit: String(state.limit),
    });
    if (state.sort !== "relevance") {
      params.set("sort", state.sort);
      params.set("order", state.sortDirection);
    }
    const response = await fetch(`/api/trakt?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Trakt request failed.");
    }

    const results = payload.results || [];
    state.results = results;
    state.pagination = payload.pagination || null;
    renderCurrentResults();
    renderQuickUsers(results);
    renderPagination(state.pagination);

    const total = state.pagination?.item_count;
    const countText = total ? `${formatNumber(total)} total` : `${results.length} on this page`;
    setStatus(results.length ? `Found ${countText}.` : "No matching public lists found.");
  } catch (error) {
    renderResults([]);
    state.results = [];
    renderQuickUsers([]);
    renderPagination(null);
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderCurrentResults() {
  renderResults(state.results);
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

function renderQuickUsers(results) {
  quickUserButtons.textContent = "";
  const users = getPopularUsersFromResults(results);
  quickUsers.hidden = users.length === 0;

  users.forEach((user) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `@${user.username}`;
    button.title = `${formatNumber(user.lists)} list${user.lists === 1 ? "" : "s"} in results`;
    button.addEventListener("click", () => loadUserLists(user.username));
    quickUserButtons.append(button);
  });
}

function getPopularUsersFromResults(results) {
  const users = new Map();
  results.forEach((result) => {
    const username = result.user?.username;
    if (!username) return;
    const existing = users.get(username) || { username, lists: 0, likes: 0 };
    existing.lists += 1;
    existing.likes += Number(result.like_count || 0);
    users.set(username, existing);
  });

  return [...users.values()]
    .sort((a, b) => compareNumber(b.likes, a.likes) || compareNumber(b.lists, a.lists) || compareText(a.username, b.username))
    .slice(0, 6);
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
  firstPageButton.disabled = page <= 1;
  prevPageButton.disabled = page <= 1;
  nextPageButton.disabled = page >= pageCount;
  lastPageButton.disabled = page >= pageCount;
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
  renderSelectedTable();
  manageSelectionButton.disabled = count === 0;
  openNuvioExportButton.disabled = count === 0;
  clearSelectionButton.disabled = count === 0;
  if (!selectionModal.hidden && count === 0) closeSelectionManager();
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

function openSelectionManager() {
  if (!state.selectedLists.size) return;
  renderSelectedTable();
  selectionModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeSelectionManager() {
  selectionModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function renderSelectedTable() {
  if (!selectedTableBody) return;
  const lists = [...state.selectedLists.values()].sort((a, b) => compareText(a.name, b.name));
  selectionModalCount.textContent = `${formatNumber(lists.length)} selected`;
  selectedTableBody.textContent = "";

  lists.forEach((result) => {
    const row = document.createElement("tr");

    const listCell = document.createElement("td");
    const title = document.createElement("strong");
    title.textContent = result.name || "Untitled list";
    listCell.append(title);

    const userCell = document.createElement("td");
    userCell.textContent = result.user?.username ? `@${result.user.username}` : "n/a";

    const idCell = document.createElement("td");
    const idButton = document.createElement("button");
    idButton.type = "button";
    idButton.className = "table-copy-button";
    idButton.textContent = result.ids?.trakt || "n/a";
    idButton.disabled = !result.ids?.trakt;
    idButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(String(result.ids.trakt));
      flashButton(idButton);
    });
    idCell.append(idButton);

    const itemsCell = document.createElement("td");
    itemsCell.textContent = formatNumber(result.item_count);

    const likesCell = document.createElement("td");
    likesCell.textContent = formatNumber(result.like_count);

    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-selected-button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => toggleSelectedList(result));
    actionCell.append(removeButton);

    row.append(listCell, userCell, idCell, itemsCell, likesCell, actionCell);
    selectedTableBody.append(row);
  });
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
    updateNuvioMergeControls();
    const exportJson = createNuvioExportJson();
    nuvioOutput.value = JSON.stringify(exportJson, null, 2);
    updateNuvioExportSummary(exportJson);
  } catch (error) {
    nuvioOutput.value = `Could not build JSON: ${error.message}`;
    nuvioExportSummary.textContent = "Fix the highlighted export settings before copying.";
  }
}

function createNuvioExportJson() {
  const existing = parseExistingNuvioJson();
  const mode = getNuvioMergeMode();
  if (mode === "split") {
    return [...(existing || []), ...createSplitNuvioCollections()];
  }

  const newCollection = createNuvioCollection();
  if (!existing) return [newCollection];
  if (mode === "existing") {
    return mergeFoldersIntoExistingCollection(existing, newCollection);
  }
  if (mode === "mapped") {
    return mergeFoldersByListMapping(existing);
  }
  return [...existing, newCollection];
}

function parseExistingNuvioJson() {
  const text = nuvioExistingJsonInput.value.trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("Existing Nuvio JSON must be an array.");
  return parsed;
}

function getExistingNuvioCollections() {
  try {
    const existing = parseExistingNuvioJson();
    return existing || [];
  } catch {
    return [];
  }
}

function getNuvioMergeMode() {
  return document.querySelector("input[name='nuvio-merge-mode']:checked")?.value || "new";
}

function updateNuvioExportSummary(exportJson) {
  const mode = getNuvioMergeMode();
  const selectedCount = state.selectedLists.size;
  const coverUrl = getNuvioCoverUrl();
  const existingCount = getExistingNuvioCollections().length;
  const collectionCount = Array.isArray(exportJson) ? exportJson.length : 0;

  if (mode === "split") {
    nuvioExportSummary.textContent = `${formatNumber(selectedCount)} list${selectedCount === 1 ? "" : "s"} will become ${formatNumber(selectedCount)} new collection${selectedCount === 1 ? "" : "s"}${coverUrl ? " with a cover URL" : ""}.`;
    return;
  }

  if (mode === "existing") {
    nuvioExportSummary.textContent = `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} will be added to one existing collection.`;
    return;
  }

  if (mode === "mapped") {
    const mappedCollections = new Set(getNuvioListMappingValues().values());
    nuvioExportSummary.textContent = `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} mapped across ${formatNumber(mappedCollections.size || existingCount)} existing collection${(mappedCollections.size || existingCount) === 1 ? "" : "s"}.`;
    return;
  }

  nuvioExportSummary.textContent = existingCount
    ? `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} will be added as one new collection. Output contains ${formatNumber(collectionCount)} total collections.`
    : `${formatNumber(selectedCount)} selected list${selectedCount === 1 ? "" : "s"} will be exported as folders in one collection${coverUrl ? " with a cover URL" : ""}.`;
}

function updateNuvioMergeControls() {
  const collections = getExistingNuvioCollections();
  nuvioMergeOptions.hidden = false;
  nuvioExistingSummary.textContent = collections.length
    ? `Detected ${formatNumber(collections.length)} collection${collections.length === 1 ? "" : "s"} in the existing JSON.`
    : "No existing collections detected. You can still export one new collection or split selected lists into separate collections.";

  const existingOnlyInputs = nuvioMergeOptions.querySelectorAll(".existing-json-option input, .existing-json-option select");
  existingOnlyInputs.forEach((input) => {
    input.disabled = collections.length === 0;
  });

  if (!collections.length && (getNuvioMergeMode() === "existing" || getNuvioMergeMode() === "mapped")) {
    document.querySelector("input[name='nuvio-merge-mode'][value='new']").checked = true;
  }

  populateCollectionSelect(nuvioTargetCollectionSelect, collections);

  const mergeMode = getNuvioMergeMode();
  const mergeIntoExisting = mergeMode === "existing" && collections.length > 0;
  nuvioTargetCollectionSelect.disabled = !mergeIntoExisting;
  renderNuvioListMapping(collections, mergeMode);
}

function populateCollectionSelect(select, collections, selectedValue = select.value) {
  select.textContent = "";
  collections.forEach((collection, index) => {
    const option = document.createElement("option");
    option.value = getNuvioCollectionKey(collection, index);
    option.textContent = collection.title || `Collection ${index + 1}`;
    select.append(option);
  });
  if (selectedValue && [...select.options].some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function renderNuvioListMapping(collections, mergeMode) {
  if (!nuvioListMapping) return;
  nuvioListMapping.hidden = mergeMode !== "mapped" || collections.length === 0;
  if (nuvioListMapping.hidden) {
    nuvioListMapping.textContent = "";
    return;
  }

  const previous = getNuvioListMappingValues();
  nuvioListMapping.textContent = "";

  getSelectedListsForExport().forEach((result) => {
    const row = document.createElement("label");
    row.className = "nuvio-map-row";

    const title = document.createElement("span");
    title.textContent = result.name || "Untitled list";

    const select = document.createElement("select");
    select.dataset.listKey = getListSelectionKey(result);
    populateCollectionSelect(select, collections, previous.get(getListSelectionKey(result)) || nuvioTargetCollectionSelect.value);

    row.append(title, select);
    nuvioListMapping.append(row);
  });
}

function getNuvioListMappingValues() {
  const values = new Map();
  nuvioListMapping?.querySelectorAll("select[data-list-key]").forEach((select) => {
    values.set(select.dataset.listKey, select.value);
  });
  return values;
}

function getNuvioCollectionKey(collection, index) {
  return collection.id || String(index);
}

function mergeFoldersIntoExistingCollection(existing, newCollection) {
  const targetId = nuvioTargetCollectionSelect.value;
  if (!targetId) throw new Error("Choose an existing collection to merge into.");
  let matched = false;

  const merged = existing.map((collection, index) => {
    const collectionId = collection.id || String(index);
    if (collectionId !== targetId) return collection;
    matched = true;
    return {
      ...collection,
      folders: [...(collection.folders || []), ...newCollection.folders],
    };
  });

  if (!matched) throw new Error("Selected collection was not found in the existing JSON.");
  return merged;
}

function mergeFoldersByListMapping(existing) {
  const collections = getExistingNuvioCollections();
  if (!collections.length) throw new Error("Provide existing Nuvio JSON before mapping lists.");
  const mapping = getNuvioListMappingValues();

  const foldersByCollection = new Map();
  getSelectedListsForExport().forEach((result) => {
    const targetId = mapping.get(getListSelectionKey(result)) || nuvioTargetCollectionSelect.value;
    if (!targetId) throw new Error(`Choose a target collection for ${result.name || "a selected list"}.`);
    const folders = foldersByCollection.get(targetId) || [];
    folders.push(createNuvioFolder(result));
    foldersByCollection.set(targetId, folders);
  });

  return existing.map((collection, index) => {
    const collectionId = getNuvioCollectionKey(collection, index);
    const folders = foldersByCollection.get(collectionId);
    if (!folders?.length) return collection;
    return {
      ...collection,
      folders: [...(collection.folders || []), ...folders],
    };
  });
}

function createNuvioCollection() {
  const title = nuvioCollectionNameInput.value.trim() || "Trakt Lists";
  const lists = getSelectedListsForExport();
  const coverUrl = getNuvioCoverUrl();

  return {
    id: createNuvioId("collection"),
    title,
    folders: lists.map(createNuvioFolder),
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: false,
    backdropImageUrl: coverUrl,
    focusGlowEnabled: true,
  };
}

function createSplitNuvioCollections() {
  return getSelectedListsForExport().map((result) => ({
    id: createNuvioId("collection"),
    title: result.name || "Trakt List",
    folders: [createNuvioFolder(result)],
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: false,
    backdropImageUrl: getNuvioCoverUrl(),
    focusGlowEnabled: true,
  }));
}

function getSelectedListsForExport() {
  let lists = [...state.selectedLists.values()];
  if (nuvioSortAlphaInput.checked) {
    lists = lists.sort((a, b) => compareText(a.name, b.name));
  }
  return lists;
}

function createNuvioFolder(result) {
  return {
    id: createNuvioId("folder"),
    title: result.name || "Trakt List",
    sources: [createNuvioTraktSource(result)],
    hideTitle: true,
    tileShape: "LANDSCAPE",
    coverEmoji: "",
    focusGifUrl: "",
    heroVideoUrl: "",
    titleLogoUrl: "",
    coverImageUrl: getNuvioCoverUrl(),
    catalogSources: [],
    focusGifEnabled: false,
    heroBackdropUrl: "",
  };
}

function getNuvioCoverUrl() {
  const value = nuvioCoverUrlInput.value.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function createNuvioTraktSource(result) {
  return {
    title: result.name || "Trakt List",
    sortBy: "rank",
    sortHow: "asc",
    provider: "trakt",
    mediaType: "MOVIE",
    traktListId: Number(result.ids?.trakt || 0) || null,
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
