import { formatNumber } from "./formatting.js";
import { fetchPosterPreviewItems } from "./list-item-cache.js";
import { closeModal, isModalOpen, openModal } from "./modal-utils.js";

const MAX_PREVIEW_ITEM_PAGES = 5;

export function createItemPreviewUi({ itemPreviewLimit }) {
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

  modalCloseButton.addEventListener("click", closePreview);
  descriptionCloseButton.addEventListener("click", closeDescription);

  previewModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-modal]")) closePreview();
  });

  descriptionModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-description]")) closeDescription();
  });

  async function openPreview(result, button) {
    if (button) {
      button.disabled = true;
      button.classList.add("loading");
    }

    previewTitle.textContent = result.name || "List Preview";
    previewOwner.textContent = result.user?.username ? `@${result.user.username}` : "Unknown owner";
    previewStatus.textContent = "Loading preview...";
    modalItemList.textContent = "";
    openModal(previewModal, {
      focusTarget: modalCloseButton,
      onClose: closePreview,
    });

    try {
      const preview = await fetchPosterPreviewItems(result, {
        targetCount: itemPreviewLimit,
        maxPages: MAX_PREVIEW_ITEM_PAGES,
      });
      const posterItems = preview.items;
      renderItems(modalItemList, posterItems);
      previewStatus.textContent = posterItems.length
        ? `Preview only: showing ${formatNumber(posterItems.length)}/${formatNumber(itemPreviewLimit)} poster previews.`
        : preview.total
          ? `No poster previews available in the first ${formatNumber(preview.scanned)} of ${formatNumber(preview.total)}.`
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
    closeModal(previewModal);
    previewTitle.textContent = "List Preview";
    previewOwner.textContent = "";
    previewStatus.textContent = "";
    modalItemList.textContent = "";
  }

  function openDescription(result, text) {
    descriptionTitle.textContent = result.name || "Description";
    descriptionOwner.textContent = result.user?.username ? `@${result.user.username}` : "Unknown owner";
    descriptionFull.textContent = text;
    openModal(descriptionModal, {
      focusTarget: descriptionCloseButton,
      onClose: closeDescription,
    });
  }

  function closeDescription() {
    closeModal(descriptionModal);
    descriptionTitle.textContent = "Description";
    descriptionOwner.textContent = "";
    descriptionFull.textContent = "";
  }

  function isPreviewOpen() {
    return isModalOpen(previewModal);
  }

  function isDescriptionOpen() {
    return isModalOpen(descriptionModal);
  }

  return {
    closeDescription,
    closePreview,
    isDescriptionOpen,
    isPreviewOpen,
    openDescription,
    openPreview,
  };
}

function renderItems(container, items) {
  container.textContent = "";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "item-empty";
    empty.textContent = "No poster previews available for this list sample.";
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

    posterWrap.append(renderSourceLinks(item));

    card.append(posterWrap);
    container.append(card);
  });
}

function renderSourceLinks(item) {
  const links = document.createElement("div");
  links.className = "preview-source-links";
  let linkCount = 0;

  const traktUrl = getTraktItemUrl(item);
  if (traktUrl) {
    links.append(createSourceLink({
      className: "trakt-source",
      href: traktUrl,
      iconSrc: "./assets/trakt.ico",
      label: "Trakt",
    }));
    linkCount += 1;
  }

  const tmdbUrl = getTmdbItemUrl(item);
  if (tmdbUrl) {
    links.append(createSourceLink({
      className: "tmdb-source",
      href: tmdbUrl,
      label: "TMDB",
    }));
    linkCount += 1;
  }

  const imdbUrl = getImdbItemUrl(item);
  if (imdbUrl) {
    links.append(createSourceLink({
      className: "imdb-source",
      href: imdbUrl,
      label: "IMDb",
    }));
    linkCount += 1;
  }

  if (!links.children.length) {
    const empty = document.createElement("span");
    empty.className = "preview-source-empty";
    empty.textContent = "No source IDs";
    links.append(empty);
  }

  links.style.setProperty("--source-count", String(Math.max(linkCount, 1)));
  return links;
}

function createSourceLink({ className, href, iconSrc = "", label }) {
  const link = document.createElement("a");
  link.className = `preview-source-link ${className}`;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = `Open on ${label}`;
  link.setAttribute("aria-label", `Open on ${label}`);

  if (iconSrc) {
    const icon = document.createElement("img");
    icon.src = iconSrc;
    icon.alt = "";
    icon.loading = "lazy";
    link.append(icon);
  } else {
    link.append(createSourceBadge(label));
  }

  return link;
}

function createSourceBadge(label) {
  const icon = document.createElement("span");
  icon.className = "preview-source-badge";
  icon.textContent = label;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function getTraktItemUrl(item) {
  const slug = item.ids?.slug;
  const showSlug = item.ids?.show_slug;
  if (item.type === "movie" && slug) return `https://trakt.tv/movies/${encodeURIComponent(slug)}`;
  if (item.type === "show" && slug) return `https://trakt.tv/shows/${encodeURIComponent(slug)}`;
  if (item.type === "season" && showSlug && item.number) {
    return `https://trakt.tv/shows/${encodeURIComponent(showSlug)}/seasons/${encodeURIComponent(item.number)}`;
  }
  if (item.type === "episode" && showSlug && item.season && item.number) {
    return `https://trakt.tv/shows/${encodeURIComponent(showSlug)}/seasons/${encodeURIComponent(item.season)}/episodes/${encodeURIComponent(item.number)}`;
  }
  return item.ids?.trakt ? `https://trakt.tv/search/trakt/${encodeURIComponent(item.ids.trakt)}` : "";
}

function getTmdbItemUrl(item) {
  const id = getTmdbIdForUrl(item);
  if (!id) return "";
  if (item.type === "movie") return `https://www.themoviedb.org/movie/${encodeURIComponent(id)}`;
  if (item.type === "show" || item.type === "season" || item.type === "episode") return `https://www.themoviedb.org/tv/${encodeURIComponent(id)}`;
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(id)}`;
}

function getTmdbIdForUrl(item) {
  if (item.type === "movie" || item.type === "show") return item.ids?.tmdb || "";
  if (item.type === "season" || item.type === "episode") return item.ids?.show_tmdb || "";
  return item.ids?.tmdb || "";
}

function getImdbItemUrl(item) {
  return item.ids?.imdb ? `https://www.imdb.com/title/${encodeURIComponent(item.ids.imdb)}/` : "";
}
