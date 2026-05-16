const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const clearButton = document.querySelector("#clear-button");
const template = document.querySelector("#result-template");
const DESCRIPTION_LIMIT = 360;

const placeholders = {
  search: "Search public lists by title or description",
  user: "Enter a Trakt username to list their public lists",
  url: "Paste a Trakt list URL",
};

document.querySelectorAll("input[name='mode']").forEach((radio) => {
  radio.addEventListener("change", () => {
    queryInput.placeholder = placeholders[getMode()];
    queryInput.focus();
  });
});

clearButton.addEventListener("click", () => {
  queryInput.value = "";
  setStatus("");
  renderResults([]);
  queryInput.focus();
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

  setLoading(true);
  setStatus("Searching Trakt...");

  try {
    const params = new URLSearchParams({ mode, q: query });
    const response = await fetch(`/api/trakt?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Trakt request failed.");
    }

    renderResults(payload.results || []);
    const total = payload.results?.length || 0;
    setStatus(total ? `Found ${total} ${total === 1 ? "list" : "lists"}.` : "No matching public lists found.");
  } catch (error) {
    renderResults([]);
    setStatus(error.message, true);
  } finally {
    setLoading(false);
  }
});

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

  results.forEach((result) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    const title = result.name || "Untitled list";
    const owner = result.user?.username || result.user?.name || "unknown";
    const url = result.url || "";

    node.querySelector(".result-owner").textContent = `@${owner}`;
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
        const original = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = original;
        }, 900);
      });
    });

    resultsEl.append(node);
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
  if (text.length <= DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, DESCRIPTION_LIMIT).trim()}...`;
}

function formatNumber(value) {
  if (value === undefined || value === null) return "n/a";
  return Number(value).toLocaleString();
}

function getCopyValue(kind, result) {
  if (kind === "id") return result.ids?.trakt ? String(result.ids.trakt) : "";
  if (kind === "slug") return result.ids?.slug || "";
  if (kind === "url") return result.url || "";
  return "";
}
