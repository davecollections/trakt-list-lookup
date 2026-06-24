import { cleanDescription, compareNumber, compareText, formatDate, formatNumber, hasDescription } from "./formatting.js";
import { canFetchListItems, fetchPosterSampleUrls } from "./list-item-cache.js";
import { getListSelectionKey } from "./nuvio-export.js";

export function createResultsView({
  posterSampleLimit,
  posterSampleConcurrency,
  isSelected,
  onLoadUserLists,
  onOpenDescription,
  onOpenPreview,
  onToggleSelectedList,
}) {
  const resultsEl = document.querySelector("#results");
  const resultsHeader = document.querySelector(".results-header");
  const quickUsers = document.querySelector("#quick-users");
  const quickUserButtons = document.querySelector("#quick-user-buttons");
  const template = document.querySelector("#result-template");
  const pager = document.querySelector("#pager");
  const firstPageButton = document.querySelector("#first-page");
  const prevPageButton = document.querySelector("#prev-page");
  const nextPageButton = document.querySelector("#next-page");
  const lastPageButton = document.querySelector("#last-page");
  const pageLabel = document.querySelector("#page-label");
  const posterSamples = new Map();
  const observedPosterCards = new Map();
  const queuedPosterKeys = new Set();
  const loadingPosterKeys = new Set();
  let posterSampleObserver = null;
  let posterSampleQueue = [];
  let posterSampleActive = 0;
  let posterSampleRenderId = 0;

  return {
    renderResults,
    renderQuickUsers,
    renderPagination,
  };

  function renderResults(results, { emptyMessage = "Results will appear here." } = {}) {
    resetPosterSampleLoading();
    resultsEl.textContent = "";
    resultsEl.classList.toggle("empty-state", results.length === 0);
    resultsHeader.hidden = results.length === 0;

    if (!results.length) {
      const empty = document.createElement("p");
      empty.textContent = emptyMessage;
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
      ownerButton.addEventListener("click", () => onLoadUserLists(result.user.username));
      const titleNode = node.querySelector(".result-title");
      titleNode.textContent = title;
      const fullDescription = cleanDescription(result.description);
      const readMoreButton = node.querySelector(".read-more-button");
      readMoreButton.hidden = !hasDescription(result.description);
      readMoreButton.addEventListener("click", () => onOpenDescription(result, fullDescription));
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
      posterButton.addEventListener("click", () => onOpenPreview(result, posterButton));

      const selectListButton = node.querySelector(".select-list-button");
      updateSelectListButton(selectListButton, result);
      selectListButton.addEventListener("click", () => onToggleSelectedList(result));

      resultsEl.append(node);
      renderPosterSamples(result);
      schedulePosterSampleLoad(card, result);
    });
  }

  function renderQuickUsers(results, serverQuickUsers = null) {
    quickUserButtons.textContent = "";
    const users = normalizeQuickUsers(serverQuickUsers) || getPopularUsersFromResults(results);
    quickUsers.hidden = users.length === 0;

    users.forEach((user) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `@${user.username}`;
      button.title = getQuickUserTitle(user);
      button.addEventListener("click", () => onLoadUserLists(user.username));
      quickUserButtons.append(button);
    });
  }

  function renderPagination(pagination, currentPage) {
    const page = pagination?.page || currentPage;
    const pageCount = pagination?.page_count || 1;
    pager.hidden = pageCount <= 1;
    pageLabel.textContent = `Page ${formatNumber(page)} of ${formatNumber(pageCount)}`;
    firstPageButton.disabled = page <= 1;
    prevPageButton.disabled = page <= 1;
    nextPageButton.disabled = page >= pageCount;
    lastPageButton.disabled = page >= pageCount;
  }

  function getPopularUsersFromResults(results) {
    const users = new Map();
    results.forEach((result) => {
      const username = result.user?.username;
      if (!username) return;
      const existing = users.get(username) || { username, listCount: 0, likeCount: 0 };
      existing.listCount += 1;
      existing.likeCount += Number(result.like_count || 0);
      users.set(username, existing);
    });

    return [...users.values()]
      .sort((a, b) => compareNumber(b.likeCount, a.likeCount) || compareNumber(b.listCount, a.listCount) || compareText(a.username, b.username))
      .slice(0, 6);
  }

  function normalizeQuickUsers(value) {
    if (!Array.isArray(value)) return null;
    return value
      .filter((user) => user?.username)
      .map((user) => ({
        username: user.username,
        name: user.name || "",
        listCount: Number(user.listCount || 0),
        likeCount: Number(user.likeCount || 0),
        itemCount: Number(user.itemCount || 0),
        topListName: user.topListName || "",
      }));
  }

  function getQuickUserTitle(user) {
    const listText = `${formatNumber(user.listCount)} list${user.listCount === 1 ? "" : "s"} in sampled matching results`;
    const likeText = user.likeCount ? `${formatNumber(user.likeCount)} likes` : "";
    const topListText = user.topListName ? `Top list: ${user.topListName}` : "";
    return [user.name || "", listText, likeText, topListText].filter(Boolean).join(" | ");
  }

  function resetPosterSampleLoading() {
    posterSampleRenderId += 1;
    posterSampleQueue = [];
    queuedPosterKeys.clear();
    observedPosterCards.clear();
    if (posterSampleObserver) {
      posterSampleObserver.disconnect();
      posterSampleObserver = null;
    }
  }

  function schedulePosterSampleLoad(card, result) {
    const key = getPosterSampleKey(result);
    if (!key || posterSamples.has(key) || !canFetchListItems(result)) return;

    if (typeof IntersectionObserver === "undefined") {
      enqueuePosterSampleLoad(result, posterSampleRenderId);
      return;
    }

    observedPosterCards.set(card, result);
    getPosterSampleObserver().observe(card);
  }

  function getPosterSampleObserver() {
    if (posterSampleObserver) return posterSampleObserver;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const result = observedPosterCards.get(entry.target);
        observedPosterCards.delete(entry.target);
        observer.unobserve(entry.target);
        if (result) enqueuePosterSampleLoad(result, posterSampleRenderId);
      });
    }, {
      rootMargin: "420px 0px",
      threshold: 0.01,
    });

    posterSampleObserver = observer;
    return posterSampleObserver;
  }

  function enqueuePosterSampleLoad(result, renderId) {
    const key = getPosterSampleKey(result);
    if (!key || posterSamples.has(key) || queuedPosterKeys.has(key) || loadingPosterKeys.has(key)) return;

    queuedPosterKeys.add(key);
    posterSampleQueue.push({ key, renderId, result });
    processPosterSampleQueue();
  }

  function processPosterSampleQueue() {
    while (posterSampleActive < posterSampleConcurrency && posterSampleQueue.length) {
      const item = posterSampleQueue.shift();
      queuedPosterKeys.delete(item.key);
      if (item.renderId !== posterSampleRenderId) continue;

      posterSampleActive += 1;
      loadingPosterKeys.add(item.key);
      setPosterSamplesLoading(item.result, true);

      loadPosterSamples(item.result).finally(() => {
        posterSampleActive -= 1;
        loadingPosterKeys.delete(item.key);
        renderPosterSamples(item.result);
        processPosterSampleQueue();
      });
    }
  }

  async function loadPosterSamples(result) {
    const key = getPosterSampleKey(result);
    if (!key) return;

    try {
      posterSamples.set(key, await fetchPosterSampleUrls(result, { targetCount: posterSampleLimit }));
    } catch {
      posterSamples.set(key, []);
    }
  }

  function renderPosterSamples(result) {
    const key = getPosterSampleKey(result);
    if (!key) return;
    const card = resultsEl.querySelector(`[data-sample-key="${CSS.escape(key)}"]`);
    if (!card) return;

    const sampleWrap = card.querySelector(".poster-samples");
    const posters = posterSamples.get(key) || [];
    sampleWrap.textContent = "";
    sampleWrap.classList.toggle("loading", loadingPosterKeys.has(key));

    for (let index = 0; index < posterSampleLimit; index += 1) {
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

  function setPosterSamplesLoading(result, isLoading) {
    const key = getPosterSampleKey(result);
    if (!key) return;

    const card = resultsEl.querySelector(`[data-sample-key="${CSS.escape(key)}"]`);
    const sampleWrap = card?.querySelector(".poster-samples");
    sampleWrap?.classList.toggle("loading", isLoading);
  }

  function getPosterSampleKey(result) {
    return getListSelectionKey(result);
  }

  function updateSelectListButton(button, result) {
    const selected = isSelected(result);
    button.textContent = selected ? "Remove" : "Add";
    button.classList.toggle("selected", selected);
  }
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
