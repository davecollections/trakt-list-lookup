import { fetchTraktListItems } from "./api-client.js";
import { cleanDescription, compareNumber, compareText, formatDate, formatNumber, hasDescription } from "./formatting.js";
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

  return {
    renderResults,
    renderQuickUsers,
    renderPagination,
  };

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
      ownerButton.addEventListener("click", () => onLoadUserLists(result.user.username));
      node.querySelector(".result-title").textContent = title;
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
      return key && !posterSamples.has(key) && result.user?.username && result.ids?.slug;
    });

    if (!queue.length) {
      results.forEach((result) => renderPosterSamples(result));
      return;
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(posterSampleConcurrency, queue.length) }, async () => {
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
      const payload = await fetchTraktListItems({
        user: result.user.username,
        slug: result.ids.slug,
        limit: posterSampleLimit,
      });
      const posters = (payload.items || []).map((item) => item.poster).filter(Boolean).slice(0, posterSampleLimit);
      posterSamples.set(key, posters);
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
