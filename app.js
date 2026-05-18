import { compareText, formatNumber } from "./js/formatting.js";
import { fetchTraktListItems, fetchTraktLists } from "./js/api-client.js";
import { getListSelectionKey as getNuvioListSelectionKey } from "./js/nuvio-export.js";
import { createNuvioExportUi } from "./js/nuvio-export-ui.js";
import { createResultsView } from "./js/results-view.js";
import { createSelectionState } from "./js/selection-state.js";

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

const DESCRIPTION_LIMIT = 360;
const ITEMS_PREVIEW_LIMIT = 15;
const POSTER_SAMPLE_LIMIT = 3;

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
  selection: createSelectionState(),
};
const nuvioExportUi = createNuvioExportUi({ selection: state.selection });
const resultsView = createResultsView({
  posterSampleLimit: POSTER_SAMPLE_LIMIT,
  posterSampleConcurrency: 4,
  isSelected: (result) => state.selection.has(result),
  onLoadUserLists: loadUserLists,
  onOpenDescription: openDescription,
  onOpenPreview: openPreview,
  onToggleSelectedList: toggleSelectedList,
});

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
  resultsView.renderResults([]);
  resultsView.renderQuickUsers([]);
  resultsView.renderPagination(null, state.page);
  queryInput.focus();
});

modalCloseButton.addEventListener("click", closePreview);
descriptionCloseButton.addEventListener("click", closeDescription);
selectionCloseButton.addEventListener("click", closeSelectionManager);
manageSelectionButton.addEventListener("click", openSelectionManager);
openNuvioExportButton.addEventListener("click", nuvioExportUi.open);
clearSelectionButton.addEventListener("click", clearSelection);

previewModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closePreview();
});

descriptionModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-description]")) closeDescription();
});

selectionModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-selection]")) closeSelectionManager();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !previewModal.hidden) closePreview();
  if (event.key === "Escape" && !descriptionModal.hidden) closeDescription();
  if (event.key === "Escape" && !selectionModal.hidden) closeSelectionManager();
  if (event.key === "Escape" && nuvioExportUi.isOpen()) nuvioExportUi.close();
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
    renderCurrentResults();
    resultsView.renderQuickUsers(results);
    resultsView.renderPagination(state.pagination, state.page);

    const total = state.pagination?.item_count;
    const countText = total ? `${formatNumber(total)} total` : `${results.length} on this page`;
    setStatus(results.length ? `Found ${countText}.` : "No matching public lists found.");
  } catch (error) {
    resultsView.renderResults([]);
    state.results = [];
    resultsView.renderQuickUsers([]);
    resultsView.renderPagination(null, state.page);
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
}

function renderCurrentResults() {
  resultsView.renderResults(state.results);
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
    const payload = await fetchTraktListItems({
      user: result.user.username,
      slug: result.ids.slug,
      limit: ITEMS_PREVIEW_LIMIT,
    });

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
  state.selection.toggle(result);
  updateSelectionUi();
  renderCurrentResults();
}

function getListSelectionKey(result) {
  return getNuvioListSelectionKey(result);
}

function updateSelectionUi() {
  const count = state.selection.size;
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
  if (nuvioExportUi.isOpen()) nuvioExportUi.update();
}

function renderSelectedListChips() {
  selectedListChips.textContent = "";

  state.selection.values().slice(0, 6).forEach((result) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-chip";
    chip.textContent = result.name || "Untitled list";
    chip.title = "Remove from selection";
    chip.addEventListener("click", () => toggleSelectedList(result));
    selectedListChips.append(chip);
  });

  if (state.selection.size > 6) {
    const more = document.createElement("span");
    more.className = "selected-more";
    more.textContent = `+${formatNumber(state.selection.size - 6)} more`;
    selectedListChips.append(more);
  }
}

function clearSelection() {
  state.selection.clear();
  updateSelectionUi();
  renderCurrentResults();
}

function openSelectionManager() {
  if (!state.selection.size) return;
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
  const lists = state.selection.values().sort((a, b) => compareText(a.name, b.name));
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
