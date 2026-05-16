const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const clearButton = document.querySelector("#clear-button");
const template = document.querySelector("#result-template");
const pager = document.querySelector("#pager");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageLabel = document.querySelector("#page-label");
const themeToggle = document.querySelector("#theme-toggle");
const sortSelect = document.querySelector("#sort-select");

const DESCRIPTION_LIMIT = 360;
const ITEMS_PREVIEW_LIMIT = 15;

const state = {
  mode: "search",
  query: "",
  page: 1,
  pagination: null,
  results: [],
};

const placeholders = {
  search: "Search public lists by title or description",
  user: "Enter a username, or username plus keywords",
  url: "Paste a Trakt list URL",
};

const savedTheme = localStorage.getItem("theme");
const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
setTheme(savedTheme || preferredTheme);

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
    queryInput.placeholder = placeholders[getMode()];
    queryInput.focus();
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

prevPageButton.addEventListener("click", () => {
  if (state.page > 1) runSearch(state.page - 1);
});

nextPageButton.addEventListener("click", () => {
  const pageCount = state.pagination?.page_count || state.page + 1;
  if (state.page < pageCount) runSearch(state.page + 1);
});

sortSelect.addEventListener("change", () => {
  renderCurrentResults();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mode = getMode();
  const query = queryInput.value.trim();
  if (!query) {
    setStatus("Enter a keyword, username, or Trakt list URL.", true);
    queryInput.focus();
    return;
  }

  state.mode = mode;
  state.query = query;
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

function setLoading(isLoading) {
  form.querySelector("button[type='submit']").disabled = isLoading;
  queryInput.disabled = isLoading;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderResults(results) {
  resultsEl.textContent = "";
  resultsEl.classList.toggle("empty-state", results.length === 0);

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
    const ownerLink = node.querySelector(".result-owner a");
    ownerLink.textContent = `#${index + 1} @${owner}`;
    ownerLink.href = getUserProfileUrl(result);
    ownerLink.hidden = !result.user?.username;
    node.querySelector(".result-title").textContent = title;
    node.querySelector(".description").textContent = cleanDescription(result.description);
    node.querySelector(".trakt-id").textContent = result.ids?.trakt || "n/a";
    node.querySelector(".items").textContent = formatNumber(result.item_count);
    node.querySelector(".likes").textContent = formatNumber(result.like_count);
    node.querySelector(".updated").textContent = formatDate(result.updated_at);
    const commentsLink = node.querySelector(".comments a");
    commentsLink.textContent = formatNumber(result.comment_count);
    commentsLink.href = getCommentsUrl(result);
    commentsLink.hidden = !result.url;

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

    const viewItemsButton = node.querySelector(".view-items-button");
    viewItemsButton.disabled = !result.user?.username || !result.ids?.slug;
    viewItemsButton.addEventListener("click", () => loadItems(card, result, viewItemsButton));

    resultsEl.append(node);
  });
}

function getSortedResults(results) {
  const sort = sortSelect.value;
  const sorted = [...results];
  if (sort === "title") {
    sorted.sort((a, b) => compareText(a.name, b.name));
  } else if (sort === "owner") {
    sorted.sort((a, b) => compareText(a.user?.username, b.user?.username) || compareText(a.name, b.name));
  } else if (sort === "items-desc") {
    sorted.sort((a, b) => compareNumber(b.item_count, a.item_count));
  } else if (sort === "comments-desc") {
    sorted.sort((a, b) => compareNumber(b.comment_count, a.comment_count));
  } else if (sort === "likes-desc") {
    sorted.sort((a, b) => compareNumber(b.like_count, a.like_count));
  } else if (sort === "id-desc") {
    sorted.sort((a, b) => compareNumber(b.ids?.trakt, a.ids?.trakt));
  }
  return sorted;
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

async function loadItems(card, result, button) {
  const panel = card.querySelector(".item-panel");
  const itemList = card.querySelector(".item-list");
  const status = card.querySelector(".item-status");

  if (!panel.hidden && panel.dataset.loaded === "true") {
    panel.hidden = true;
    button.textContent = "View Items";
    return;
  }

  if (panel.hidden && panel.dataset.loaded === "true") {
    panel.hidden = false;
    button.textContent = "Hide Items";
    return;
  }

  panel.hidden = false;
  button.disabled = true;
  button.textContent = "Loading";
  status.textContent = "Loading items...";
  itemList.textContent = "";

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
    renderItems(itemList, items);
    const total = payload.pagination?.item_count || items.length || 0;
    status.textContent = total ? `Previewing ${Math.min(ITEMS_PREVIEW_LIMIT, items.length)} of ${formatNumber(total)}` : "No items found.";
    panel.dataset.loaded = "true";
    button.textContent = "Hide Items";
  } catch (error) {
    status.textContent = error.message;
    button.textContent = "View Items";
  } finally {
    button.disabled = false;
  }
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
    card.className = "poster-card";
    card.title = item.title || "";

    const posterWrap = document.createElement("div");
    posterWrap.className = "poster-wrap";
    if (item.poster) {
      const image = document.createElement("img");
      image.src = item.poster;
      image.alt = "";
      image.loading = "lazy";
      posterWrap.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.textContent = "No Poster";
      posterWrap.append(placeholder);
    }

    const body = document.createElement("div");
    body.className = "poster-body";
    const meta = document.createElement("span");
    meta.textContent = item.year || "Year n/a";

    const ids = document.createElement("code");
    ids.textContent = buildItemIdText(item);

    body.append(meta, ids);
    card.append(posterWrap, body);
    container.append(card);
  });
}

function buildItemIdText(item) {
  const parts = [];
  if (item.ids?.trakt) parts.push(`trakt:${item.ids.trakt}`);
  if (item.ids?.tmdb) parts.push(`tmdb:${item.ids.tmdb}`);
  if (item.ids?.imdb) parts.push(`imdb:${item.ids.imdb}`);
  return parts.join("  ") || "ids:n/a";
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
  if (text.length <= DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, DESCRIPTION_LIMIT).trim()}...`;
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

function getCopyValue(kind, result) {
  if (kind === "id") return result.ids?.trakt ? String(result.ids.trakt) : "";
  if (kind === "slug") return result.ids?.slug || "";
  if (kind === "url") return result.url || "";
  return "";
}

function getUserProfileUrl(result) {
  return result.user?.username ? `https://app.trakt.tv/users/${encodeURIComponent(result.user.username)}` : "";
}

function getCommentsUrl(result) {
  if (!result.user?.username || !result.ids?.slug) return "";
  return `https://app.trakt.tv/users/${encodeURIComponent(result.user.username)}/lists/${encodeURIComponent(result.ids.slug)}/comments`;
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
  themeToggle.textContent = isDark ? "Light" : "Dark";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}
