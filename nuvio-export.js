export function buildNuvioExport({
  lists,
  existing = null,
  mode = "new",
  collectionName = "Trakt Lists",
  coverUrl = "",
  sortAlpha = true,
  splitAssignments = {},
  mappedAssignments = {},
  targetCollectionKey = "",
  createId = createNuvioId,
} = {}) {
  const selectedLists = getSelectedLists(lists, sortAlpha);
  const safeCoverUrl = getSafeHttpsUrl(coverUrl);

  if (mode === "split") {
    return [...(existing || []), ...createSplitNuvioCollections(selectedLists, splitAssignments, safeCoverUrl, createId)];
  }

  const newCollection = createNuvioCollection({
    title: collectionName || "Trakt Lists",
    lists: selectedLists,
    coverUrl: safeCoverUrl,
    createId,
  });

  if (!existing) return [newCollection];

  if (mode === "existing") {
    return mergeFoldersIntoExistingCollection(existing, newCollection.folders, targetCollectionKey);
  }

  if (mode === "mapped") {
    return mergeFoldersByListMapping(existing, selectedLists, mappedAssignments, targetCollectionKey, safeCoverUrl, createId);
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

function getSelectedLists(lists, sortAlpha) {
  const selectedLists = [...(lists || [])];
  if (!sortAlpha) return selectedLists;
  return selectedLists.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
}

function createNuvioCollection({ title, lists, coverUrl, createId }) {
  return {
    id: createId("collection"),
    title,
    folders: lists.map((result) => createNuvioFolder(result, coverUrl, createId)),
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: false,
    backdropImageUrl: coverUrl,
    focusGlowEnabled: true,
  };
}

function createSplitNuvioCollections(lists, splitAssignments, coverUrl, createId) {
  return [...getNuvioSplitGroups(lists, splitAssignments)].map(([title, groupedLists]) => createNuvioCollection({
    title,
    lists: groupedLists,
    coverUrl,
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
      folders: [...(collection.folders || []), ...foldersToAdd],
    };
  });

  if (!matched) throw new Error("Selected collection was not found in the existing JSON.");
  return merged;
}

function mergeFoldersByListMapping(existing, lists, mappedAssignments, targetCollectionKey, coverUrl, createId) {
  if (!existing?.length) throw new Error("Provide existing Nuvio JSON before mapping lists.");

  const foldersByCollection = new Map();
  lists.forEach((result) => {
    const targetKey = mappedAssignments[getListSelectionKey(result)] || targetCollectionKey;
    if (!targetKey) throw new Error(`Choose a target collection for ${result.name || "a selected list"}.`);
    const folders = foldersByCollection.get(targetKey) || [];
    folders.push(createNuvioFolder(result, coverUrl, createId));
    foldersByCollection.set(targetKey, folders);
  });

  return existing.map((collection, index) => {
    const collectionKey = getNuvioCollectionKey(collection, index);
    const folders = foldersByCollection.get(collectionKey);
    if (!folders?.length) return collection;
    return {
      ...collection,
      folders: [...(collection.folders || []), ...folders],
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

function createNuvioTraktSource(result) {
  return {
    title: result.name || "Trakt List",
    sortBy: "rank",
    sortHow: "asc",
    provider: "trakt",
    mediaType: "MOVIE",
    traktListId: Number(result.ids?.trakt || 0) || null,
  };
}

function createNuvioId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
