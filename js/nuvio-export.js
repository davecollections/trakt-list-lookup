export function buildNuvioExport({
  lists,
  existing = null,
  mode = "new",
  collectionName = "Trakt Lists",
  coverUrl = "",
  folderCoverUrl = null,
  sortAlpha = true,
  sortMode = "",
  splitAssignments = {},
  mappedAssignments = {},
  targetCollectionKey = "",
  folderImages = {},
  createId = createNuvioId,
} = {}) {
  return buildNuvioExportPayload({
    lists,
    existing,
    mode,
    collectionName,
    coverUrl,
    folderCoverUrl,
    sortAlpha,
    sortMode,
    splitAssignments,
    mappedAssignments,
    targetCollectionKey,
    folderImages,
    createId,
  }).collections;
}

export function buildNuvioExportPayload({
  lists,
  existing = null,
  mode = "new",
  collectionName = "Trakt Lists",
  coverUrl = "",
  folderCoverUrl = null,
  sortAlpha = true,
  sortMode = "",
  splitAssignments = {},
  mappedAssignments = {},
  targetCollectionKey = "",
  folderImages = {},
  createId = createNuvioId,
} = {}) {
  const report = createNuvioExportReport();
  const existingCollections = cloneNuvioJson(existing);
  const idFactory = createNuvioIdFactory(getNuvioOutputIds(existingCollections), createId);
  const requestedLists = sortNuvioLists(lists, sortMode || (sortAlpha ? "title-asc" : "selected"));
  const selectedLists = requestedLists.filter(isNuvioListExportable);
  report.skippedUnavailableListCount = requestedLists.length - selectedLists.length;
  const safeCoverUrl = getSafeHttpsUrl(coverUrl);
  const safeFolderCoverUrl = folderCoverUrl === null ? safeCoverUrl : getSafeHttpsUrl(folderCoverUrl);
  let collections;

  if (mode === "split") {
    collections = [...(existingCollections || []), ...createSplitNuvioCollections(selectedLists, splitAssignments, safeCoverUrl, safeFolderCoverUrl, folderImages, idFactory.create)];
  } else {
    const newCollection = createNuvioCollection({
      title: collectionName || "Trakt Lists",
      lists: selectedLists,
      coverUrl: safeCoverUrl,
      folderCoverUrl: safeFolderCoverUrl,
      folderImages,
      createId: idFactory.create,
    });

    if (!existingCollections) {
      collections = [newCollection];
    } else if (mode === "existing") {
      collections = mergeFoldersIntoExistingCollection(existingCollections, newCollection.folders, targetCollectionKey, report);
    } else if (mode === "mapped") {
      collections = mergeFoldersByListMapping(existingCollections, selectedLists, mappedAssignments, targetCollectionKey, safeFolderCoverUrl, folderImages, idFactory.create, report);
    } else {
      collections = [...existingCollections, newCollection];
    }
  }

  normalizeNuvioOutputIds(collections, createId, report);
  report.collectionCount = collections.length;
  report.folderCount = getNuvioFolderCount(collections);
  report.warnings = getNuvioExportWarnings(collections);
  report.warningCount = report.warnings.length;

  return {
    collections,
    json: `${JSON.stringify(collections, null, 2)}\n`,
    report,
  };
}

export function getSafeHttpsUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function getListSelectionKey(result) {
  return result?.ids?.trakt ? String(result.ids.trakt) : result?.url || "";
}

export function sortNuvioLists(lists, sortMode) {
  const selectedLists = [...(lists || [])];
  const mode = sortMode || "title-asc";
  if (mode === "selected") return selectedLists;
  return selectedLists.sort((a, b) => compareLists(a, b, mode));
}

function compareLists(a, b, sortMode) {
  if (sortMode === "title-desc") return compareText(b.name, a.name);
  if (sortMode === "items-desc") return compareNumber(b.item_count, a.item_count) || compareText(a.name, b.name);
  if (sortMode === "likes-desc") return compareNumber(b.like_count, a.like_count) || compareText(a.name, b.name);
  if (sortMode === "updated-desc") return compareDate(b.updated_at, a.updated_at) || compareText(a.name, b.name);
  return compareText(a.name, b.name);
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

function compareNumber(a, b) {
  return (Number(a) || 0) - (Number(b) || 0);
}

function compareDate(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

function createNuvioExportReport() {
  return {
    collectionCount: 0,
    folderCount: 0,
    skippedUnavailableListCount: 0,
    duplicateSourceFolderCount: 0,
    missingCollectionIdsFixed: 0,
    duplicateCollectionIdsFixed: 0,
    missingFolderIdsFixed: 0,
    duplicateFolderIdsFixed: 0,
    idFixCount: 0,
    warningCount: 0,
    warnings: [],
  };
}

export function createNuvioIdFactory(existingIds = [], createId = createNuvioId) {
  const seenIds = new Set((existingIds || []).map(getTrimmedId).filter(Boolean));
  let fallbackCounter = 0;

  return {
    add(id) {
      const value = getTrimmedId(id);
      if (!value || seenIds.has(value)) return false;
      seenIds.add(value);
      return true;
    },
    create(prefix = "id") {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const value = getTrimmedId(createId(prefix));
        if (value && !seenIds.has(value)) {
          seenIds.add(value);
          return value;
        }
      }

      let fallbackId;
      do {
        fallbackCounter += 1;
        fallbackId = `${prefix}-${fallbackCounter}`;
      } while (seenIds.has(fallbackId));

      seenIds.add(fallbackId);
      return fallbackId;
    },
    has(id) {
      return seenIds.has(getTrimmedId(id));
    },
  };
}

function cloneNuvioJson(value) {
  if (!Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function getNuvioOutputIds(collections) {
  const ids = [];
  for (const collection of collections || []) {
    ids.push(collection?.id);
    const folders = Array.isArray(collection?.folders) ? collection.folders : [];
    for (const folder of folders) {
      ids.push(folder?.id);
    }
  }
  return ids;
}

function getNuvioFolderCount(collections) {
  return (collections || []).reduce((count, collection) => count + (Array.isArray(collection?.folders) ? collection.folders.length : 0), 0);
}

function normalizeNuvioOutputIds(collections, createId, report) {
  const idFactory = createNuvioIdFactory([], createId);

  for (const collection of collections || []) {
    if (!collection || typeof collection !== "object") continue;

    const collectionId = getTrimmedId(collection?.id);
    if (!collectionId) {
      collection.id = idFactory.create("collection");
      report.missingCollectionIdsFixed += 1;
    } else if (!idFactory.add(collectionId)) {
      collection.id = idFactory.create("collection");
      report.duplicateCollectionIdsFixed += 1;
    } else {
      collection.id = collectionId;
    }

    const folders = Array.isArray(collection?.folders) ? collection.folders : [];
    for (const folder of folders) {
      if (!folder || typeof folder !== "object") continue;

      const folderId = getTrimmedId(folder?.id);
      if (!folderId) {
        folder.id = idFactory.create("folder");
        report.missingFolderIdsFixed += 1;
      } else if (!idFactory.add(folderId)) {
        folder.id = idFactory.create("folder");
        report.duplicateFolderIdsFixed += 1;
      } else {
        folder.id = folderId;
      }
    }
  }

  report.idFixCount = report.missingCollectionIdsFixed
    + report.duplicateCollectionIdsFixed
    + report.missingFolderIdsFixed
    + report.duplicateFolderIdsFixed;
}

function getTrimmedId(id) {
  return String(id || "").trim();
}

function getNuvioExportWarnings(collections) {
  const warnings = new Map();

  for (const collection of collections || []) {
    if (!collection || typeof collection !== "object") {
      addNuvioExportWarning(warnings, "Collection is not an object.");
      continue;
    }

    if (!hasValue(collection.title)) {
      addNuvioExportWarning(warnings, "Collection missing title.");
    }

    if (!Array.isArray(collection.folders)) {
      addNuvioExportWarning(warnings, "Collection missing folders.");
      continue;
    }

    for (const folder of collection.folders) {
      validateNuvioFolder(folder, warnings);
    }
  }

  return [...warnings.entries()].map(([message, count]) => (count === 1 ? message : `${message} (${count})`));
}

function validateNuvioFolder(folder, warnings) {
  if (!folder || typeof folder !== "object") {
    addNuvioExportWarning(warnings, "Folder is not an object.");
    return;
  }

  if (!hasValue(folder.title)) {
    addNuvioExportWarning(warnings, "Folder missing title.");
  }

  if (!Array.isArray(folder.sources)) {
    addNuvioExportWarning(warnings, "Folder missing sources.");
    return;
  }

  if (!folder.sources.length) {
    addNuvioExportWarning(warnings, "Folder has no sources.");
  }

  for (const source of folder.sources) {
    validateNuvioSource(source, warnings);
  }
}

function validateNuvioSource(source, warnings) {
  if (!source || typeof source !== "object") {
    addNuvioExportWarning(warnings, "Source is not an object.");
    return;
  }

  if (!hasValue(source.provider)) {
    addNuvioExportWarning(warnings, "Source missing provider.");
    return;
  }

  if (source.provider !== "trakt") return;

  if (!hasValue(source.traktListId)) {
    addNuvioExportWarning(warnings, "Trakt source missing list ID.");
  }

  if (!hasValue(source.mediaType)) {
    addNuvioExportWarning(warnings, "Trakt source missing media type.");
  }
}

function addNuvioExportWarning(warnings, message) {
  warnings.set(message, (warnings.get(message) || 0) + 1);
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isNuvioListExportable(result) {
  if (!result?.ids?.trakt) return false;
  if (result.isExportable === false || result.isAvailable === false) return false;
  const status = String(result.availabilityStatus || "available").toLowerCase();
  return status !== "unavailable" && status !== "unverified";
}

function createNuvioCollection({ title, lists, coverUrl, folderCoverUrl, folderImages = {}, createId }) {
  return {
    id: createId("collection"),
    title,
    folders: lists.map((result) => createNuvioFolder(result, getFolderCoverUrl(result, folderImages, folderCoverUrl), createId)),
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: false,
    backdropImageUrl: coverUrl,
    focusGlowEnabled: true,
  };
}

function createSplitNuvioCollections(lists, splitAssignments, coverUrl, folderCoverUrl, folderImages, createId) {
  return [...getNuvioSplitGroups(lists, splitAssignments)].map(([title, groupedLists]) => createNuvioCollection({
    title,
    lists: groupedLists,
    coverUrl,
    folderCoverUrl,
    folderImages,
    createId,
  }));
}

function getNuvioSplitGroups(lists, splitAssignments) {
  const groups = new Map();
  lists.forEach((result) => {
    const key = getListSelectionKey(result);
    const title = String(splitAssignments[key] || result.name || "Trakt List").trim() || result.name || "Trakt List";
    const groupedLists = groups.get(title) || [];
    groupedLists.push(result);
    groups.set(title, groupedLists);
  });
  return groups;
}

function mergeFoldersIntoExistingCollection(existing, foldersToAdd, targetCollectionKey, report) {
  if (!targetCollectionKey) throw new Error("Choose an existing collection to merge into.");
  let matched = false;

  const merged = existing.map((collection, index) => {
    const collectionKey = getNuvioCollectionKey(collection, index);
    if (collectionKey !== targetCollectionKey) return collection;
    matched = true;
    return {
      ...collection,
      folders: appendUniqueNuvioFolders(getCollectionFolders(collection), foldersToAdd, report),
    };
  });

  if (!matched) throw new Error("Selected collection was not found in the existing JSON.");
  return merged;
}

function mergeFoldersByListMapping(existing, lists, mappedAssignments, targetCollectionKey, coverUrl, folderImages, createId, report) {
  if (!existing?.length) throw new Error("Provide existing Nuvio JSON before mapping lists.");

  const foldersByCollection = new Map();
  lists.forEach((result) => {
    const targetKey = mappedAssignments[getListSelectionKey(result)] || targetCollectionKey;
    if (!targetKey) throw new Error(`Choose a target collection for ${result.name || "a selected list"}.`);
    const folders = foldersByCollection.get(targetKey) || [];
    folders.push(createNuvioFolder(result, getFolderCoverUrl(result, folderImages, coverUrl), createId));
    foldersByCollection.set(targetKey, folders);
  });

  return existing.map((collection, index) => {
    const collectionKey = getNuvioCollectionKey(collection, index);
    const folders = foldersByCollection.get(collectionKey);
    if (!folders?.length) return collection;
    return {
      ...collection,
      folders: appendUniqueNuvioFolders(getCollectionFolders(collection), folders, report),
    };
  });
}

function getNuvioCollectionKey(collection, index) {
  return collection?.id || String(index);
}

function createNuvioFolder(result, coverUrl, createId) {
  return {
    id: createId("folder"),
    title: result.name || "Trakt List",
    sources: [createNuvioTraktSource(result)],
    hideTitle: true,
    tileShape: "LANDSCAPE",
    coverEmoji: "",
    focusGifUrl: "",
    heroVideoUrl: "",
    titleLogoUrl: "",
    coverImageUrl: coverUrl,
    catalogSources: [],
    focusGifEnabled: false,
    heroBackdropUrl: "",
  };
}

function getFolderCoverUrl(result, folderImages, fallbackCoverUrl) {
  return getSafeHttpsUrl(folderImages[getListSelectionKey(result)]) || fallbackCoverUrl;
}

function createNuvioTraktSource(result) {
  return {
    title: result.name || "Trakt List",
    sortBy: "rank",
    sortHow: "asc",
    provider: "trakt",
    mediaType: getNuvioMediaType(result),
    traktListId: Number(result.ids?.trakt || 0) || null,
  };
}

function appendUniqueNuvioFolders(existingFolders, foldersToAdd, report) {
  const signatures = new Set(existingFolders.map(getNuvioFolderSignature).filter(Boolean));
  const uniqueFolders = [];

  for (const folder of foldersToAdd) {
    const signature = getNuvioFolderSignature(folder);
    if (signature && signatures.has(signature)) {
      if (report) report.duplicateSourceFolderCount += 1;
      continue;
    }
    if (signature) signatures.add(signature);
    uniqueFolders.push(folder);
  }

  return [...existingFolders, ...uniqueFolders];
}

function getNuvioFolderSignature(folder) {
  const sources = Array.isArray(folder?.sources) ? folder.sources : [];
  const sourceSignatures = sources
    .map(getNuvioSourceSignature)
    .filter(Boolean);

  return sourceSignatures.length ? sourceSignatures.join(";") : folder?.id || folder?.title || "";
}

function getCollectionFolders(collection) {
  return Array.isArray(collection?.folders) ? collection.folders : [];
}

function getNuvioSourceSignature(source) {
  if (!source) return "";

  if (source.provider === "trakt" && source.traktListId) {
    return JSON.stringify({
      mediaType: source.mediaType || "",
      provider: "trakt",
      traktListId: Number(source.traktListId),
    });
  }

  return JSON.stringify({
    mediaType: source.mediaType || "",
    provider: source.provider || "",
    sortBy: source.sortBy || "",
    sortHow: source.sortHow || "",
    title: source.title || "",
    traktListId: source.traktListId || "",
  });
}

function getNuvioMediaType(result) {
  const value = String(result?.nuvioMediaType || result?.mediaType || "").toUpperCase();
  if (value === "TV" || value === "SHOW" || value === "SERIES") return "TV";
  if (value === "MIXED" || value === "UNKNOWN") return "MOVIE";
  return "MOVIE";
}

function createNuvioId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
