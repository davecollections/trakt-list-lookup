import { formatNumber, slugifyFilename } from "./formatting.js";
import { canFetchListItems, fetchFirstPosterUrl } from "./list-item-cache.js";
import { closeModal, isModalOpen, openModal } from "./modal-utils.js";
import { buildNuvioExport, getListSelectionKey, getSafeHttpsUrl, sortNuvioLists } from "./nuvio-export.js";

const FOLDER_IMAGE_MAX_PAGES = 3;
const FOLDER_IMAGE_CONCURRENCY = 3;
const MAX_EXISTING_JSON_BYTES = 2 * 1024 * 1024;

export function createNuvioExportUi({ selection }) {
  const modal = document.querySelector("#nuvio-modal");
  const closeButton = document.querySelector("#nuvio-close");
  const count = document.querySelector("#nuvio-count");
  const exportSummary = document.querySelector("#nuvio-export-summary");
  const collectionNameInput = document.querySelector("#nuvio-collection-name");
  const coverUrlInput = document.querySelector("#nuvio-cover-url");
  const coverStatus = document.querySelector("#nuvio-cover-status");
  const sortModeSelect = document.querySelector("#nuvio-sort-mode");
  const folderImageModeSelect = document.querySelector("#nuvio-folder-image-mode");
  const folderImageStatus = document.querySelector("#nuvio-folder-image-status");
  const existingJsonInput = document.querySelector("#nuvio-existing-json");
  const existingFileInput = document.querySelector("#nuvio-existing-file");
  const existingFileStatus = document.querySelector("#nuvio-file-status");
  const existingJsonStatus = document.querySelector("#nuvio-existing-status");
  const mergeOptions = document.querySelector("#nuvio-merge-options");
  const existingSummary = document.querySelector("#nuvio-existing-summary");
  const targetCollectionSelect = document.querySelector("#nuvio-target-collection");
  const splitMapping = document.querySelector("#nuvio-split-mapping");
  const listMapping = document.querySelector("#nuvio-list-mapping");
  const output = document.querySelector("#nuvio-output");
  const outputSummary = document.querySelector("#nuvio-output-summary");
  const previewJsonButton = document.querySelector("#preview-nuvio-json");
  const copyButton = document.querySelector("#copy-nuvio-json");
  const downloadButton = document.querySelector("#download-nuvio-json");
  const jsonPreviewModal = document.querySelector("#json-preview-modal");
  const jsonPreviewOutput = document.querySelector("#json-preview-output");
  const jsonPreviewClose = document.querySelector("#json-preview-close");
  const jsonPreviewCopy = document.querySelector("#copy-json-preview");
  const importHelpModal = document.querySelector("#nuvio-import-help-modal");
  const importHelpOpen = document.querySelector("#open-nuvio-import-help");
  const importHelpClose = document.querySelector("#nuvio-import-help-close");
  const folderImageCache = new Map();
  let folderImageRequestId = 0;

  closeButton.addEventListener("click", close);
  previewJsonButton.addEventListener("click", openJsonPreview);
  copyButton.addEventListener("click", copyJson);
  downloadButton.addEventListener("click", downloadJson);
  jsonPreviewClose.addEventListener("click", closeJsonPreview);
  jsonPreviewCopy.addEventListener("click", copyJsonPreview);
  importHelpOpen.addEventListener("click", openImportHelp);
  importHelpClose.addEventListener("click", closeImportHelp);
  collectionNameInput.addEventListener("input", update);
  coverUrlInput.addEventListener("input", update);
  sortModeSelect.addEventListener("change", update);
  folderImageModeSelect.addEventListener("change", () => {
    update();
    refreshFolderImages();
  });
  existingJsonInput.addEventListener("input", () => {
    existingFileStatus.classList.remove("invalid");
    if (!existingFileInput.files?.length) existingFileStatus.textContent = "No file selected";
    update();
  });
  existingFileInput.addEventListener("change", loadExistingFile);
  targetCollectionSelect.addEventListener("change", refreshGeneratedOutput);
  splitMapping.addEventListener("input", (event) => {
    if (event.target.matches("input[data-list-key]")) {
      selection.setSplitAssignment(event.target.dataset.listKey, event.target.value.trim());
    }
    refreshGeneratedOutput();
  });
  listMapping.addEventListener("change", (event) => {
    if (event.target.matches("select[data-list-key]")) {
      selection.setMappedAssignment(event.target.dataset.listKey, event.target.value);
    }
    refreshGeneratedOutput();
  });
  document.querySelectorAll("input[name='nuvio-merge-mode']").forEach((radio) => {
    radio.addEventListener("change", () => {
      updateMergeControls();
      update();
    });
  });
  modal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-nuvio]")) close();
  });
  jsonPreviewModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-json-preview]")) closeJsonPreview();
  });
  importHelpModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-nuvio-import-help]")) closeImportHelp();
  });

  return {
    open,
    close,
    update,
    isOpen: () => isModalOpen(modal) || isModalOpen(jsonPreviewModal) || isModalOpen(importHelpModal),
  };

  function open() {
    if (!selection.size) return;
    count.textContent = `${formatNumber(selection.size)} selected`;
    update();
    refreshFolderImages();
    openModal(modal, {
      focusTarget: collectionNameInput,
      onClose: close,
    });
  }

  function close() {
    closeJsonPreview();
    closeImportHelp();
    closeModal(modal);
  }

  async function loadExistingFile() {
    const file = existingFileInput.files?.[0];
    if (!file) return;

    if (file.size > MAX_EXISTING_JSON_BYTES) {
      existingJsonInput.value = "";
      existingFileStatus.textContent = "File is too large. Keep JSON under 2 MB.";
      existingFileStatus.classList.add("invalid");
      update();
      return;
    }

    try {
      existingJsonInput.value = await file.text();
      existingFileStatus.textContent = file.name;
      existingFileStatus.classList.remove("invalid");
      update();
    } catch {
      existingJsonInput.value = "";
      existingFileStatus.textContent = "Could not read that file.";
      existingFileStatus.classList.add("invalid");
      update();
    }
  }

  function update() {
    try {
      updateMergeControls();
      refreshGeneratedOutput();
    } catch (error) {
      output.value = `Could not build JSON: ${error.message}`;
      exportSummary.textContent = "Fix the highlighted export settings before copying.";
    }
  }

  function refreshGeneratedOutput() {
    try {
      updateCoverStatus();
      updateExistingJsonStatus();
      updateFolderImageStatus();
      const exportJson = createExportJson();
      output.value = JSON.stringify(exportJson, null, 2);
      outputSummary.textContent = `${formatNumber(output.value.length)} chars`;
      updateExportSummary(exportJson);
      setJsonActionsDisabled(false);
    } catch (error) {
      output.value = `Could not build JSON: ${error.message}`;
      outputSummary.textContent = "Needs attention";
      exportSummary.textContent = "Fix the highlighted export settings before copying.";
      setJsonActionsDisabled(true);
    }
  }

  function createExportJson() {
    const existing = parseExistingJson();
    return buildNuvioExport({
      lists: getSelectedListsForExport(),
      existing,
      mode: getMergeMode(),
      collectionName: collectionNameInput.value.trim() || "Trakt Lists",
      coverUrl: coverUrlInput.value,
      folderCoverUrl: getFolderCoverFallbackUrl(),
      folderImages: getFolderImageObject(),
      sortMode: sortModeSelect.value,
      splitAssignments: selection.splitAssignmentObject(),
      mappedAssignments: selection.mappedAssignmentObject(),
      targetCollectionKey: targetCollectionSelect.value,
    });
  }

  function parseExistingJson() {
    const state = getExistingJsonState();
    if (state.error) throw new Error(state.error);
    return state.collections.length ? state.collections : null;
  }

  function getExistingCollections() {
    return getExistingJsonState().collections;
  }

  function getMergeMode() {
    return document.querySelector("input[name='nuvio-merge-mode']:checked")?.value || "new";
  }

  function updateExportSummary(exportJson) {
    const mode = getMergeMode();
    const selectedCount = selection.size;
    const coverUrl = getCoverUrl();
    const existingCount = getExistingCollections().length;
    const collectionCount = Array.isArray(exportJson) ? exportJson.length : 0;

    if (mode === "split") {
      const splitCount = getSplitGroups().size;
      exportSummary.textContent = `${formatNumber(selectedCount)} list${selectedCount === 1 ? "" : "s"} will become ${formatNumber(splitCount)} new collection${splitCount === 1 ? "" : "s"}${coverUrl ? " with a cover URL" : ""}.`;
      return;
    }

    if (mode === "existing") {
      exportSummary.textContent = `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} will be added to one existing collection.`;
      return;
    }

    if (mode === "mapped") {
      const mappedCollections = new Set(selection.mappedAssignments.values());
      exportSummary.textContent = `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} mapped across ${formatNumber(mappedCollections.size || existingCount)} existing collection${(mappedCollections.size || existingCount) === 1 ? "" : "s"}.`;
      return;
    }

    exportSummary.textContent = existingCount
      ? `${formatNumber(selectedCount)} folder${selectedCount === 1 ? "" : "s"} will be added as one new collection. Output contains ${formatNumber(collectionCount)} total collections.`
      : `${formatNumber(selectedCount)} selected list${selectedCount === 1 ? "" : "s"} will be exported as folders in one collection${coverUrl ? " with a cover URL" : ""}.`;
  }

  function updateCoverStatus() {
    const value = coverUrlInput.value.trim();
    if (!value) {
      coverStatus.textContent = "";
      coverStatus.classList.remove("invalid");
      return;
    }

    const safeUrl = getCoverUrl();
    coverStatus.textContent = safeUrl ? "Cover URL will be included." : "Use a valid https:// URL.";
    coverStatus.classList.toggle("invalid", !safeUrl);
  }

  function updateExistingJsonStatus() {
    const state = getExistingJsonState();
    existingJsonStatus.classList.toggle("invalid", Boolean(state.error));
    existingJsonStatus.textContent = state.message;
  }

  function getExistingJsonState() {
    const text = existingJsonInput.value.trim();
    if (!text) {
      return {
        collections: [],
        error: "",
        message: "",
      };
    }

    if (text.length > MAX_EXISTING_JSON_BYTES) {
      return {
        collections: [],
        error: "Existing Nuvio JSON is too large.",
        message: "Existing Nuvio JSON is too large. Keep it under 2 MB.",
      };
    }

    try {
      const parsed = JSON.parse(text);
      const validationError = getExistingJsonValidationError(parsed);
      if (validationError) {
        return {
          collections: [],
          error: validationError,
          message: validationError,
        };
      }

      const folderCount = parsed.reduce((count, collection) => count + (Array.isArray(collection?.folders) ? collection.folders.length : 0), 0);
      return {
        collections: parsed,
        error: "",
        message: `Detected ${formatNumber(parsed.length)} collection${parsed.length === 1 ? "" : "s"} and ${formatNumber(folderCount)} folder${folderCount === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      return {
        collections: [],
        error: error.message,
        message: "Could not read that as JSON.",
      };
    }
  }

  function getExistingJsonValidationError(value) {
    if (!Array.isArray(value)) return "Existing Nuvio JSON must be an array.";
    if (!value.length) return "Existing Nuvio JSON must include at least one collection.";

    const invalidIndex = value.findIndex((collection) => !collection || typeof collection !== "object" || !Array.isArray(collection.folders));
    if (invalidIndex !== -1) return `Collection ${formatNumber(invalidIndex + 1)} is missing a folders array.`;

    return "";
  }

  function updateFolderImageStatus(isLoading = false) {
    const mode = folderImageModeSelect.value;
    if (mode === "none") {
      folderImageStatus.textContent = "Folder image fields will be blank.";
      return;
    }
    if (mode === "cover") {
      folderImageStatus.textContent = getCoverUrl() ? "Folder covers will use the collection cover URL." : "Add a cover URL to apply it to folders.";
      return;
    }

    if (isLoading) {
      folderImageStatus.textContent = "Finding list poster images...";
      return;
    }

    const selected = getSelectedListsForExport();
    const found = selected.filter((result) => folderImageCache.get(getListSelectionKey(result))).length;
    folderImageStatus.textContent = selected.length
      ? `${formatNumber(found)}/${formatNumber(selected.length)} folder images found.`
      : "";
  }

  function updateMergeControls() {
    const collections = getExistingCollections();
    const hasExistingJson = collections.length > 0;
    const canSplit = selection.size > 1;
    mergeOptions.hidden = false;
    existingSummary.textContent = collections.length
      ? `${formatNumber(collections.length)} existing collection${collections.length === 1 ? "" : "s"} detected.`
      : "Create new collection output.";

    mergeOptions.querySelectorAll(".existing-json-option").forEach((element) => {
      element.hidden = !hasExistingJson;
    });
    mergeOptions.querySelector(".split-option").hidden = !canSplit;
    mergeOptions.querySelectorAll(".existing-json-option input, .existing-json-option select").forEach((input) => {
      input.disabled = !hasExistingJson;
    });

    if (!hasExistingJson && (getMergeMode() === "existing" || getMergeMode() === "mapped")) {
      document.querySelector("input[name='nuvio-merge-mode'][value='new']").checked = true;
    }
    if (!canSplit && getMergeMode() === "split") {
      document.querySelector("input[name='nuvio-merge-mode'][value='new']").checked = true;
    }

    populateCollectionSelect(targetCollectionSelect, collections);

    const mergeMode = getMergeMode();
    const mergeIntoExisting = mergeMode === "existing" && hasExistingJson;
    targetCollectionSelect.disabled = !mergeIntoExisting;
    targetCollectionSelect.closest(".nuvio-target-field").hidden = !mergeIntoExisting;
    renderSplitMapping(mergeMode);
    renderListMapping(collections, mergeMode);
  }

  function populateCollectionSelect(select, collections, selectedValue = select.value) {
    select.textContent = "";
    collections.forEach((collection, index) => {
      const option = document.createElement("option");
      option.value = getCollectionKey(collection, index);
      option.textContent = collection.title || `Collection ${index + 1}`;
      select.append(option);
    });
    if (selectedValue && [...select.options].some((option) => option.value === selectedValue)) {
      select.value = selectedValue;
    }
  }

  function renderListMapping(collections, mergeMode) {
    listMapping.hidden = mergeMode !== "mapped" || collections.length === 0;
    if (listMapping.hidden) {
      listMapping.textContent = "";
      return;
    }

    listMapping.textContent = "";
    getSelectedListsForExport().forEach((result) => {
      const row = document.createElement("label");
      row.className = "nuvio-map-row";

      const title = document.createElement("span");
      title.textContent = result.name || "Untitled list";

      const select = document.createElement("select");
      select.dataset.listKey = getListSelectionKey(result);
      populateCollectionSelect(select, collections, selection.getMappedAssignment(getListSelectionKey(result)) || targetCollectionSelect.value);

      row.append(title, select);
      listMapping.append(row);
    });
  }

  function renderSplitMapping(mergeMode) {
    splitMapping.hidden = mergeMode !== "split";
    if (splitMapping.hidden) {
      splitMapping.textContent = "";
      return;
    }

    splitMapping.textContent = "";
    getSelectedListsForExport().forEach((result) => {
      const row = document.createElement("label");
      row.className = "nuvio-map-row";

      const title = document.createElement("span");
      title.textContent = result.name || "Untitled list";

      const input = document.createElement("input");
      input.type = "text";
      input.dataset.listKey = getListSelectionKey(result);
      input.value = selection.getSplitAssignment(getListSelectionKey(result)) || result.name || "Trakt List";
      input.placeholder = "Collection name";

      row.append(title, input);
      splitMapping.append(row);
    });
  }

  function getSplitGroups() {
    const groups = new Map();
    getSelectedListsForExport().forEach((result) => {
      const key = getListSelectionKey(result);
      const title = selection.getSplitAssignment(key) || result.name || "Trakt List";
      const normalizedTitle = title.trim() || result.name || "Trakt List";
      const lists = groups.get(normalizedTitle) || [];
      lists.push(result);
      groups.set(normalizedTitle, lists);
    });
    return groups;
  }

  function getCollectionKey(collection, index) {
    return collection.id || String(index);
  }

  function getSelectedListsForExport() {
    return sortNuvioLists(selection.values(), sortModeSelect.value);
  }

  function getCoverUrl() {
    return getSafeHttpsUrl(coverUrlInput.value);
  }

  function getFolderCoverFallbackUrl() {
    if (folderImageModeSelect.value === "none") return "";
    return getCoverUrl();
  }

  function getFolderImageObject() {
    if (folderImageModeSelect.value !== "auto") return {};
    return Object.fromEntries(
      getSelectedListsForExport()
        .map((result) => [getListSelectionKey(result), folderImageCache.get(getListSelectionKey(result)) || ""])
        .filter(([, value]) => value),
    );
  }

  async function refreshFolderImages() {
    const requestId = ++folderImageRequestId;
    if (folderImageModeSelect.value !== "auto") {
      updateFolderImageStatus();
      refreshGeneratedOutput();
      return;
    }

    const selectedLists = getSelectedListsForExport();
    const missing = selectedLists.filter((result) => {
      const key = getListSelectionKey(result);
      return key && !folderImageCache.has(key) && canFetchListItems(result);
    });

    if (!missing.length) {
      updateFolderImageStatus();
      refreshGeneratedOutput();
      return;
    }

    updateFolderImageStatus(true);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(FOLDER_IMAGE_CONCURRENCY, missing.length) }, async () => {
      while (cursor < missing.length && requestId === folderImageRequestId) {
        const result = missing[cursor];
        cursor += 1;
        folderImageCache.set(getListSelectionKey(result), await fetchFirstPosterUrl(result, {
          maxPages: FOLDER_IMAGE_MAX_PAGES,
        }));
      }
    });

    await Promise.all(workers);
    if (requestId !== folderImageRequestId) return;
    updateFolderImageStatus();
    refreshGeneratedOutput();
  }

  function setJsonActionsDisabled(disabled) {
    previewJsonButton.disabled = disabled;
    copyButton.disabled = disabled;
    downloadButton.disabled = disabled;
  }

  async function copyJson() {
    await navigator.clipboard.writeText(output.value);
    flashButton(copyButton);
  }

  function openJsonPreview() {
    jsonPreviewOutput.value = output.value;
    openModal(jsonPreviewModal, {
      focusTarget: jsonPreviewClose,
      onClose: closeJsonPreview,
    });
  }

  function closeJsonPreview() {
    closeModal(jsonPreviewModal);
  }

  function openImportHelp() {
    openModal(importHelpModal, {
      focusTarget: importHelpClose,
      onClose: closeImportHelp,
    });
  }

  function closeImportHelp() {
    closeModal(importHelpModal);
  }

  async function copyJsonPreview() {
    await navigator.clipboard.writeText(jsonPreviewOutput.value);
    flashButton(jsonPreviewCopy);
  }

  function downloadJson() {
    const blob = new Blob([`${output.value}\n`], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${slugifyFilename(collectionNameInput.value || "trakt-lists")}.nuvio.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

function flashButton(button) {
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 900);
}
