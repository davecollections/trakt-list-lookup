import assert from "node:assert/strict";
import { buildNuvioExport, buildNuvioExportPayload, createNuvioIdFactory, getSafeHttpsUrl, sortNuvioLists } from "../js/nuvio-export.js";
import { countImportedSelectedTraktListDuplicates, getNuvioExportStatusModel } from "../js/nuvio-export-ui.js";

const lists = [
  list("Comedy Nights", 101),
  list("Horror Finds", 102),
  list("More Comedy", 103),
];
const fiveLists = [
  ...lists,
  list("Documentary Shelf", 104),
  list("Recently Watched", 105),
];

let nextId = 0;
const createId = (prefix) => `${prefix}-${++nextId}`;

assert.equal(getSafeHttpsUrl("http://example.com/cover.jpg"), "");
assert.equal(getSafeHttpsUrl("not a url"), "");
assert.equal(getSafeHttpsUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg");
assert.deepEqual(sortNuvioLists(lists, "likes-desc").map((item) => item.name), ["More Comedy", "Horror Finds", "Comedy Nights"]);

nextId = 0;
const freshExport = buildNuvioExport({
  lists,
  collectionName: "Trakt Picks",
  coverUrl: "https://example.com/cover.jpg",
  createId,
});
assert.equal(freshExport.length, 1);
assert.equal(freshExport[0].title, "Trakt Picks");
assert.equal(freshExport[0].folders.length, 3);
assert.equal(freshExport[0].folders[0].sources[0].provider, "trakt");
assert.equal(freshExport[0].backdropImageUrl, "https://example.com/cover.jpg");
assert.equal(freshExport[0].folders[0].sources[0].mediaType, "MOVIE");

nextId = 0;
const freshPayload = buildNuvioExportPayload({
  lists,
  collectionName: "Trakt Picks",
  createId,
});
assert.ok(freshPayload.json.endsWith("\n"));
assert.deepEqual(JSON.parse(freshPayload.json), freshPayload.collections);
assert.equal(freshPayload.report.collectionCount, 1);
assert.equal(freshPayload.report.folderCount, 3);
assert.equal(freshPayload.report.idFixCount, 0);
assert.equal(freshPayload.report.warningCount, 0);
const freshPayloadStatus = getNuvioExportStatusModel(freshPayload);
assert.equal(freshPayloadStatus.title, "Export ready");
assert.equal(freshPayloadStatus.tone, "success");
assert.ok(freshPayloadStatus.messages.includes("Output contains 3 folders."));

nextId = 0;
const seriesExport = buildNuvioExport({
  lists: [
    {
      ...list("IMDB: Top Rated TV Shows", 2143363),
      nuvioMediaType: "TV",
    },
  ],
  createId,
});
assert.equal(seriesExport[0].folders[0].sources[0].mediaType, "TV");

nextId = 0;
const uncertainMediaExport = buildNuvioExport({
  lists: [
    {
      ...list("Mixed Shelf", 106),
      nuvioMediaType: "MIXED",
    },
    {
      ...list("Unknown Shelf", 107),
      nuvioMediaType: "UNKNOWN",
    },
  ],
  createId,
});
assert.deepEqual(uncertainMediaExport[0].folders.map((folder) => folder.sources[0].mediaType), ["MOVIE", "MOVIE"]);

nextId = 0;
const imageExport = buildNuvioExport({
  lists,
  collectionName: "Image Picks",
  coverUrl: "https://example.com/collection.jpg",
  folderImages: {
    101: "https://image.tmdb.org/t/p/w342/demo.jpg",
  },
  createId,
});
assert.equal(imageExport[0].backdropImageUrl, "https://example.com/collection.jpg");
assert.equal(imageExport[0].folders[0].coverImageUrl, "https://image.tmdb.org/t/p/w342/demo.jpg");
assert.equal(imageExport[0].folders[1].coverImageUrl, "https://example.com/collection.jpg");

nextId = 0;
const noFolderImageExport = buildNuvioExport({
  lists,
  coverUrl: "https://example.com/collection.jpg",
  folderCoverUrl: "",
  createId,
});
assert.equal(noFolderImageExport[0].backdropImageUrl, "https://example.com/collection.jpg");
assert.equal(noFolderImageExport[0].folders[0].coverImageUrl, "");

nextId = 0;
const mostItemsExport = buildNuvioExport({
  lists,
  sortMode: "items-desc",
  createId,
});
assert.deepEqual(mostItemsExport[0].folders.map((folder) => folder.title), ["More Comedy", "Horror Finds", "Comedy Nights"]);

nextId = 0;
const fiveListExport = buildNuvioExport({
  lists: fiveLists,
  sortMode: "selected",
  createId,
});
assert.equal(fiveListExport[0].folders.length, 5);
assert.deepEqual(fiveListExport[0].folders.map((folder) => folder.title), fiveLists.map((item) => item.name));

nextId = 0;
const splitExport = buildNuvioExport({
  lists,
  mode: "split",
  splitAssignments: {
    101: "Comedy",
    102: "Horror",
    103: "Comedy",
  },
  createId,
});
assert.equal(splitExport.length, 2);
assert.deepEqual(splitExport.map((collection) => collection.title), ["Comedy", "Horror"]);
assert.equal(splitExport[0].folders.length, 2);
assert.equal(splitExport[1].folders.length, 1);

nextId = 0;
const existing = [
  { id: "collection-a", title: "A", folders: [] },
  { id: "collection-b", title: "B", folders: [] },
];
const mappedExport = buildNuvioExport({
  lists,
  existing,
  mode: "mapped",
  mappedAssignments: {
    101: "collection-a",
    102: "collection-b",
    103: "collection-a",
  },
  createId,
});
assert.equal(mappedExport.length, 2);
assert.equal(mappedExport[0].folders.length, 2);
assert.equal(mappedExport[1].folders.length, 1);

nextId = 0;
const existingWithDuplicate = [
  {
    id: "collection-a",
    title: "A",
    folders: [
      {
        id: "existing-folder",
        title: "Already Added",
        sources: [
          {
            provider: "trakt",
            mediaType: "MOVIE",
            traktListId: 101,
          },
        ],
      },
    ],
  },
];
const duplicateSafeExport = buildNuvioExport({
  lists: [list("Comedy Nights", 101), list("Horror Finds", 102)],
  existing: existingWithDuplicate,
  mode: "existing",
  targetCollectionKey: "collection-a",
  createId,
});
assert.equal(duplicateSafeExport[0].folders.length, 2);
assert.deepEqual(duplicateSafeExport[0].folders.map((folder) => folder.title), ["Already Added", "Horror Finds"]);

nextId = 0;
const duplicateSafePayload = buildNuvioExportPayload({
  lists: [list("Comedy Nights", 101), list("Horror Finds", 102)],
  existing: existingWithDuplicate,
  mode: "existing",
  targetCollectionKey: "collection-a",
  createId,
});
assert.equal(duplicateSafePayload.collections[0].folders.length, 2);
assert.equal(duplicateSafePayload.report.duplicateSourceFolderCount, 1);
const duplicateSafeStatus = getNuvioExportStatusModel(duplicateSafePayload);
assert.equal(duplicateSafeStatus.title, "Export ready with warnings");
assert.equal(duplicateSafeStatus.tone, "warning");
assert.ok(duplicateSafeStatus.messages.includes("Already-existing Trakt list skipped: 1 selected list already exists or would duplicate existing output."));

nextId = 0;
const existingWithTwoDuplicateTraktLists = [
  {
    id: "collection-a",
    title: "A",
    folders: [
      {
        id: "existing-folder-a",
        title: "Already Added A",
        sources: [
          {
            provider: "trakt",
            mediaType: "MOVIE",
            traktListId: 101,
          },
        ],
      },
      {
        id: "existing-folder-b",
        title: "Already Added B",
        sources: [
          {
            provider: "trakt",
            mediaType: "MOVIE",
            traktListId: 102,
          },
        ],
      },
    ],
  },
];
nextId = 0;
const newCollectionWithImportedDuplicatesPayload = buildNuvioExportPayload({
  lists: [list("Comedy Nights", 101), list("Horror Finds", 102)],
  existing: existingWithTwoDuplicateTraktLists,
  mode: "new",
  createId,
});
const importedDuplicateCount = countImportedSelectedTraktListDuplicates(existingWithTwoDuplicateTraktLists, [
  list("Comedy Nights", 101),
  list("Horror Finds", 102),
]);
assert.equal(importedDuplicateCount, 2);
assert.equal(newCollectionWithImportedDuplicatesPayload.report.duplicateSourceFolderCount, 0);
assert.equal(newCollectionWithImportedDuplicatesPayload.collections.length, 2);
const importedDuplicateStatus = getNuvioExportStatusModel(newCollectionWithImportedDuplicatesPayload, {
  importedDuplicateListCount: importedDuplicateCount,
});
assert.equal(importedDuplicateStatus.title, "Export ready with warnings");
assert.ok(importedDuplicateStatus.messages.includes("2 selected Trakt lists already exist in the imported JSON and will be added again in the new collection."));
assert.ok(!importedDuplicateStatus.messages.some((message) => message.includes("skipped")));

nextId = 0;
const duplicateSafeMappedExport = buildNuvioExport({
  lists,
  existing: [
    existingWithDuplicate[0],
    { id: "collection-b", title: "B", folders: [] },
  ],
  mode: "mapped",
  mappedAssignments: {
    101: "collection-a",
    102: "collection-b",
    103: "collection-a",
  },
  createId,
});
assert.deepEqual(duplicateSafeMappedExport[0].folders.map((folder) => folder.title), ["Already Added", "More Comedy"]);
assert.deepEqual(duplicateSafeMappedExport[1].folders.map((folder) => folder.title), ["Horror Finds"]);

const collidingFactory = createNuvioIdFactory([], (prefix) => `${prefix}-same`);
const collidingIds = [
  collidingFactory.create("collection"),
  collidingFactory.create("folder"),
  collidingFactory.create("folder"),
  collidingFactory.create("folder"),
];
assert.equal(new Set(collidingIds).size, collidingIds.length);

const collidingPayload = buildNuvioExportPayload({
  lists: [list("Comedy Nights", 101), list("Horror Finds", 102)],
  createId: (prefix) => `${prefix}-same`,
});
assert.equal(new Set(getOutputIds(collidingPayload.collections)).size, getOutputIds(collidingPayload.collections).length);

nextId = 0;
const existingWithBadIds = [
  {
    id: "keep-collection",
    title: "Keep",
    folders: [
      { id: "keep-folder", title: "Keep Folder", sources: [] },
      { id: "keep-folder", title: "Duplicate Folder", sources: [] },
      { title: "Missing Folder", sources: [] },
    ],
  },
  {
    id: "keep-collection",
    title: "Duplicate Collection",
    folders: [],
  },
  {
    title: "Missing Collection",
    folders: [],
  },
];
const originalBadIdsJson = JSON.stringify(existingWithBadIds);
const repairedPayload = buildNuvioExportPayload({
  lists: [],
  existing: existingWithBadIds,
  mode: "split",
  createId,
});
assert.equal(JSON.stringify(existingWithBadIds), originalBadIdsJson);
assert.equal(repairedPayload.collections[0].id, "keep-collection");
assert.equal(repairedPayload.collections[0].folders[0].id, "keep-folder");
assert.notEqual(repairedPayload.collections[0].folders[1].id, "keep-folder");
assert.ok(repairedPayload.collections[0].folders[2].id);
assert.notEqual(repairedPayload.collections[1].id, "keep-collection");
assert.ok(repairedPayload.collections[2].id);
assert.equal(new Set(getOutputIds(repairedPayload.collections)).size, getOutputIds(repairedPayload.collections).length);
assert.equal(repairedPayload.report.duplicateCollectionIdsFixed, 1);
assert.equal(repairedPayload.report.missingCollectionIdsFixed, 1);
assert.equal(repairedPayload.report.duplicateFolderIdsFixed, 1);
assert.equal(repairedPayload.report.missingFolderIdsFixed, 1);
assert.equal(repairedPayload.report.idFixCount, 4);
assert.ok(repairedPayload.report.warningCount > 0);
const repairedStatus = getNuvioExportStatusModel(repairedPayload);
assert.equal(repairedStatus.title, "Export ready with warnings");
assert.ok(repairedStatus.messages.includes("IDs repaired: 4 missing or duplicate collection/folder IDs repaired."));
assert.ok(repairedStatus.messages.some((message) => message.startsWith("Some warnings were found, but your export is still valid.")));

nextId = 0;
const skippedUnavailablePayload = buildNuvioExportPayload({
  lists: [
    { name: "Missing Trakt ID", ids: {}, user: { username: "demo" } },
    {
      ...list("Unavailable", 888),
      availabilityStatus: "unavailable",
      isExportable: false,
    },
  ],
  createId,
});
assert.equal(skippedUnavailablePayload.collections[0].folders.length, 0);
assert.equal(skippedUnavailablePayload.report.skippedUnavailableListCount, 2);
assert.equal(skippedUnavailablePayload.report.warningCount, 0);
const skippedUnavailableStatus = getNuvioExportStatusModel(skippedUnavailablePayload);
assert.equal(skippedUnavailableStatus.title, "Export cannot be generated yet");
assert.equal(skippedUnavailableStatus.tone, "error");
assert.ok(skippedUnavailableStatus.messages.includes("Unavailable or unverified selected lists skipped: 2 selected lists were not included."));

const missingPayloadStatus = getNuvioExportStatusModel(null);
assert.equal(missingPayloadStatus.title, "Export cannot be generated yet");
assert.equal(missingPayloadStatus.tone, "error");
assert.ok(missingPayloadStatus.messages.includes("Fix the highlighted export settings before copying or downloading."));

function list(name, traktId) {
  return {
    name,
    item_count: traktId - 100,
    like_count: traktId * 2,
    updated_at: `2026-05-${String(traktId - 100).padStart(2, "0")}T00:00:00.000Z`,
    ids: {
      trakt: traktId,
      slug: name.toLowerCase().replaceAll(" ", "-"),
    },
    user: {
      username: "demo",
    },
  };
}

function getOutputIds(collections) {
  const ids = [];
  for (const collection of collections) {
    ids.push(collection.id);
    for (const folder of collection.folders || []) {
      ids.push(folder.id);
    }
  }
  return ids;
}
