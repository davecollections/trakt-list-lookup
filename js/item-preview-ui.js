import { fetchTraktListItems } from "./api-client.js";
import { formatNumber } from "./formatting.js";

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
    previewModal.hidden = false;
    document.body.classList.add("modal-open");

    try {
      const payload = await fetchTraktListItems({
        user: result.user.username,
        slug: result.ids.slug,
        limit: itemPreviewLimit,
      });

      const items = payload.items || [];
      renderItems(modalItemList, items);
      const total = payload.pagination?.item_count || items.length || 0;
      previewStatus.textContent = total
        ? `Preview only: showing first ${formatNumber(Math.min(itemPreviewLimit, items.length))} of ${formatNumber(total)}.`
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

  function isPreviewOpen() {
    return !previewModal.hidden;
  }

  function isDescriptionOpen() {
    return !descriptionModal.hidden;
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
