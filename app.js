const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const clearButton = document.querySelector("#clear-button");
const template = document.querySelector("#result-template");
const jumpNav = document.querySelector("#result-jumps");
const pager = document.querySelector("#pager");
const prevPageButton = document.querySelector("#prev-page");
const nextPageButton = document.querySelector("#next-page");
const pageLabel = document.querySelector("#page-label");
const themeToggle = document.querySelector("#theme-toggle");

const DESCRIPTION_LIMIT = 360;
const ITEMS_PREVIEW_LIMIT = 30;

const state = {
  mode: "search",
  query: "",
  page: 1,
  pagination: null,
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
  renderJumps([]);
  queryInput.focus();
});

prevPageButton.addEventListener("click", () => {
  if (state.page > 1) runSearch(state.page - 1);
});

nextPageButton.addEventListener("click", () => {
  const pageCount = state.pagination?.page_count || state.page + 1;
  if (state.page < pageCount) runSearch(state.page + 1);
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
    state.pagination = payload.pagination || null;
    renderResults(results);
    renderJumps(results);
    renderPagination(state.pagination);

    const total = state.pagination?.item_count;
    const countText = total ? `${formatNumber(total)} total` : `${results.length} on this page`;
    setStatus(results.length ? `Found ${countText}.` : "No matching public lists found.");
  } catch (error) {
    renderResults([]);
    renderJumps([]);
    renderPagination(null);
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
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
    node.querySelector(".result-owner").textContent = `#${index + 1} @${owner}`;
    node.querySelector(".result-title").textContent = title;
    node.querySelector(".description").textContent = cleanDescription(result.description);
    node.querySelector(".trakt-id").textContent = result.ids?.trakt || "n/a";
    node.querySelector(".slug").textContent = result.ids?.slug || "n/a";
    node.querySelector(".items").textContent = formatNumber(result.item_count);
    node.querySelector(".comments").textContent = formatNumber(result.comment_count);

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

function renderJumps(results) {
  jumpNav.textContent = "";
  jumpNav.hidden = results.length === 0;

  results.forEach((result, index) => {
    const link = document.createElement("a");
    link.href = `#result-${index + 1}`;
    link.textContent = String(index + 1);
    link.title = result.name || `Result ${index + 1}`;
    jumpNav.append(link);
  });
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
    status.textContent = total ? `Showing ${Math.min(ITEMS_PREVIEW_LIMIT, items.length)} of ${formatNumber(total)}` : "No items found.";
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
    const title = document.createElement("strong");
    title.textContent = item.title || "Untitled";
    const meta = document.createElement("span");
    meta.textContent = [item.type, item.year].filter(Boolean).join(" - ");

    const ids = document.createElement("code");
    ids.textContent = buildItemIdText(item);

    body.append(title, meta, ids);
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

function getCopyValue(kind, result) {
  if (kind === "id") return result.ids?.trakt ? String(result.ids.trakt) : "";
  if (kind === "slug") return result.ids?.slug || "";
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
  themeToggle.textContent = isDark ? "Light" : "Dark";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}
