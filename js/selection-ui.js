import { compareText, formatNumber } from "./formatting.js";
import { closeModal, isModalOpen, openModal } from "./modal-utils.js";

export function createSelectionUi({ selection, onClearSelection, onOpenNuvioExport, onToggleSelectedList }) {
  const selectionPanel = document.querySelector("#selection-panel");
  const selectionSummary = document.querySelector("#selection-summary");
  const manageSelectionButton = document.querySelector("#manage-selection");
  const openNuvioExportButton = document.querySelector("#open-nuvio-export");
  const clearSelectionButton = document.querySelector("#clear-selection");
  const selectionModal = document.querySelector("#selection-modal");
  const selectionCloseButton = document.querySelector("#selection-close");
  const selectionModalCount = document.querySelector("#selection-modal-count");
  const selectedTableBody = document.querySelector("#selected-table-body");

  selectionCloseButton.addEventListener("click", close);
  manageSelectionButton.addEventListener("click", open);
  openNuvioExportButton.addEventListener("click", onOpenNuvioExport);
  clearSelectionButton.addEventListener("click", onClearSelection);

  selectionModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-selection]")) close();
  });

  function render() {
    const count = selection.size;
    selectionPanel.hidden = count === 0;
    selectionSummary.textContent = count
      ? `${formatNumber(count)} list${count === 1 ? "" : "s"} selected.`
      : "No lists selected.";
    renderTable();
    manageSelectionButton.disabled = count === 0;
    openNuvioExportButton.disabled = count === 0;
    clearSelectionButton.disabled = count === 0;
    if (isOpen() && count === 0) close();
  }

  function renderTable() {
    if (!selectedTableBody) return;
    const lists = selection.values().sort((a, b) => compareText(a.name, b.name));
    selectionModalCount.textContent = `${formatNumber(lists.length)} selected`;
    selectedTableBody.textContent = "";

    lists.forEach((result) => {
      const row = document.createElement("tr");

      const listCell = document.createElement("td");
      const title = document.createElement("strong");
      title.textContent = result.name || "Untitled list";
      listCell.append(title);

      const userCell = document.createElement("td");
      userCell.textContent = getOwnerLabel(result);

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
      removeButton.addEventListener("click", () => onToggleSelectedList(result));
      actionCell.append(removeButton);

      row.append(listCell, userCell, idCell, itemsCell, likesCell, actionCell);
      selectedTableBody.append(row);
    });
  }

  function open() {
    if (!selection.size) return;
    renderTable();
    openModal(selectionModal, {
      focusTarget: selectionCloseButton,
      onClose: close,
    });
  }

  function close() {
    closeModal(selectionModal);
  }

  function isOpen() {
    return isModalOpen(selectionModal);
  }

  return {
    close,
    isOpen,
    render,
  };
}

function getOwnerLabel(result) {
  const status = String(result?.availabilityStatus || "available").toLowerCase();
  if (status === "unavailable") return "Owner unavailable";
  if (status === "unverified") return "Owner unverified";
  if (result?.isAvailable === false) return "Owner unavailable";
  if (result?.isExportable === false) return "Owner unverified";

  const owner = result?.ownerDisplayName || result?.user?.name || result?.ownerUsername || result?.user?.username || "";
  return owner ? `@${owner}` : "n/a";
}

function flashButton(button) {
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 900);
}
