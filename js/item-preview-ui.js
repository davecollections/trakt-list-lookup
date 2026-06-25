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
    previewOwner.textContent = getOwnerLabel(result);
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
        ? `Showing a sample of ${formatNumber(posterItems.length)} titles from this list.`
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
    descriptionOwner.textContent = getOwnerLabel(result);
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

function getOwnerLabel(result) {
  const status = String(result?.availabilityStatus || "available").toLowerCase();
  if (status === "unavailable") return "Owner unavailable";
  if (status === "unverified") return "Owner unverified";
  if (result?.isAvailable === false) return "Owner unavailable";
  if (result?.isExportable === false) return "Owner unverified";

  const owner = result?.ownerDisplayName || result?.user?.name || result?.ownerUsername || result?.user?.username || "";
  return owner ? `@${owner}` : "Unknown owner";
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

    const ratingBadge = renderRatingBadge(item);
    if (ratingBadge) posterWrap.append(ratingBadge);

    card.append(posterWrap);
    container.append(card);
  });
}

function renderRatingBadge(item) {
  const rating = Number(item.rating);
  if (!Number.isFinite(rating) || rating <= 0) return null;

  const badge = document.createElement("span");
  badge.className = "preview-rating-badge";
  badge.textContent = rating.toFixed(1);
  badge.title = "Trakt rating";
  return badge;
}
