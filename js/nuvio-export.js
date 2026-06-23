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
  const selectedLists = sortNuvioLists(lists, sortMode || (sortAlpha ? "title-asc" : "selected"));
  const safeCoverUrl = getSafeHttpsUrl(coverUrl);
  const safeFolderCoverUrl = folderCoverUrl === null ? safeCoverUrl : getSafeHttpsUrl(folderCoverUrl);

  if (mode === "split") {
    return [...(existing || []), ...createSplitNuvioCollections(selectedLists, splitAssignments, safeCoverUrl, safeFolderCoverUrl, folderImages, createId)];
  }

  const newCollection = createNuvioCollection({
    title: collectionName || "Trakt Lists",
    lists: selectedLists,
    coverUrl: safeCoverUrl,
    folderCoverUrl: safeFolderCoverUrl,
    folderImages,
    createId,
  });

  if (!existing) return [newCollection];

  if (mode === "existing") {
    return mergeFoldersIntoExistingCollection(existing, newCollection.folders, targetCollectionKey);
  }

  if (mode === "mapped") {
    return mergeFoldersByListMapping(existing, selectedLists, mappedAssignments, targetCollectionKey, safeFolderCoverUrl, folderImages, createId);
  }

  return [...existing, newCollection];
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

function mergeFoldersIntoExistingCollection(existing, foldersToAdd, targetCollectionKey) {
  if (!targetCollectionKey) throw new Error("Choose an existing collection to merge into.");
  let matched = false;

  const merged = existing.map((collection, index) => {
    const collectionKey = getNuvioCollectionKey(collection, index);
    if (collectionKey !== targetCollectionKey) return collection;
    matched = true;
    return {
      ...collection,
      folders: appendUniqueNuvioFolders(collection.folders || [], foldersToAdd),
    };
  });

  if (!matched) throw new Error("Selected collection was not found in the existing JSON.");
  return merged;
}

function mergeFoldersByListMapping(existing, lists, mappedAssignments, targetCollectionKey, coverUrl, folderImages, createId) {
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
      folders: appendUniqueNuvioFolders(collection.folders || [], folders),
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

function appendUniqueNuvioFolders(existingFolders, foldersToAdd) {
  const signatures = new Set(existingFolders.map(getNuvioFolderSignature).filter(Boolean));
  const uniqueFolders = [];

  for (const folder of foldersToAdd) {
    const signature = getNuvioFolderSignature(folder);
    if (signature && signatures.has(signature)) continue;
    if (signature) signatures.add(signature);
    uniqueFolders.push(folder);
  }

  return [...existingFolders, ...uniqueFolders];
}

function getNuvioFolderSignature(folder) {
  const sourceSignatures = (folder?.sources || [])
    .map(getNuvioSourceSignature)
    .filter(Boolean);

  return sourceSignatures.length ? sourceSignatures.join(";") : folder?.id || folder?.title || "";
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
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
