import { compareText, formatNumber, slugifyFilename } from "./formatting.js";
import { buildNuvioExport, getListSelectionKey, getSafeHttpsUrl } from "./nuvio-export.js";

export function createNuvioExportUi({ selection }) {
  const modal = document.querySelector("#nuvio-modal");
  const closeButton = document.querySelector("#nuvio-close");
  const count = document.querySelector("#nuvio-count");
  const exportSummary = document.querySelector("#nuvio-export-summary");
  const collectionNameInput = document.querySelector("#nuvio-collection-name");
  const coverUrlInput = document.querySelector("#nuvio-cover-url");
  const coverStatus = document.querySelector("#nuvio-cover-status");
  const sortModeSelect = document.querySelector("#nuvio-sort-mode");
  const existingJsonInput = document.querySelector("#nuvio-existing-json");
  const existingFileInput = document.querySelector("#nuvio-existing-file");
  const existingFileStatus = document.querySelector("#nuvio-file-status");
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

  closeButton.addEventListener("click", close);
  previewJsonButton.addEventListener("click", openJsonPreview);
  copyButton.addEventListener("click", copyJson);
  downloadButton.addEventListener("click", downloadJson);
  jsonPreviewClose.addEventListener("click", closeJsonPreview);
  jsonPreviewCopy.addEventListener("click", copyJsonPreview);
  collectionNameInput.addEventListener("input", update);
  coverUrlInput.addEventListener("input", update);
  sortModeSelect.addEventListener("change", update);
  existingJsonInput.addEventListener("input", update);
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

  return {
    open,
    close,
    update,
    isOpen: () => !modal.hidden || !jsonPreviewModal.hidden,
  };

  function open() {
    if (!selection.size) return;
    count.textContent = `${formatNumber(selection.size)} selected`;
    update();
    modal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function close() {
    modal.hidden = true;
    closeJsonPreview();
    document.body.classList.remove("modal-open");
  }

  async function loadExistingFile() {
    const file = existingFileInput.files?.[0];
    if (!file) return;
    existingJsonInput.value = await file.text();
    existingFileStatus.textContent = file.name;
    update();
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
      const exportJson = createExportJson();
      output.value = JSON.stringify(exportJson, null, 2);
      outputSummary.textContent = `${formatNumber(output.value.length)} chars`;
      updateExportSummary(exportJson);
    } catch (error) {
      output.value = `Could not build JSON: ${error.message}`;
      outputSummary.textContent = "Needs attention";
      exportSummary.textContent = "Fix the highlighted export settings before copying.";
    }
  }

  function createExportJson() {
    const existing = parseExistingJson();
    return buildNuvioExport({
      lists: selection.values(),
      existing,
      mode: getMergeMode(),
      collectionName: collectionNameInput.value.trim() || "Trakt Lists",
      coverUrl: coverUrlInput.value,
      sortMode: sortModeSelect.value,
      splitAssignments: selection.splitAssignmentObject(),
      mappedAssignments: selection.mappedAssignmentObject(),
      targetCollectionKey: targetCollectionSelect.value,
    });
  }

  function parseExistingJson() {
    const text = existingJsonInput.value.trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Existing Nuvio JSON must be an array.");
    return parsed;
  }

  function getExistingCollections() {
    try {
      const existing = parseExistingJson();
      return existing || [];
    } catch {
      return [];
    }
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
    let lists = selection.values();
    lists = sortSelectedLists(lists, sortModeSelect.value);
    return lists;
  }

  function getCoverUrl() {
    return getSafeHttpsUrl(coverUrlInput.value);
  }

  async function copyJson() {
    await navigator.clipboard.writeText(output.value);
    flashButton(copyButton);
  }

  function openJsonPreview() {
    jsonPreviewOutput.value = output.value;
    jsonPreviewModal.hidden = false;
  }

  function closeJsonPreview() {
    jsonPreviewModal.hidden = true;
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

function sortSelectedLists(lists, sortMode) {
  const selectedLists = [...lists];
  if (sortMode === "selected") return selectedLists;
  if (sortMode === "title-desc") return selectedLists.sort((a, b) => compareText(b.name, a.name));
  if (sortMode === "items-desc") return selectedLists.sort((a, b) => compareNumber(b.item_count, a.item_count) || compareText(a.name, b.name));
  if (sortMode === "likes-desc") return selectedLists.sort((a, b) => compareNumber(b.like_count, a.like_count) || compareText(a.name, b.name));
  if (sortMode === "updated-desc") return selectedLists.sort((a, b) => compareDate(b.updated_at, a.updated_at) || compareText(a.name, b.name));
  return selectedLists.sort((a, b) => compareText(a.name, b.name));
}

function compareNumber(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

function compareDate(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

function flashButton(button) {
  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => {
    button.textContent = original;
  }, 900);
}
