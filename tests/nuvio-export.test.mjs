import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNuvioExport, buildNuvioExportPayload, createNuvioIdFactory, getSafeHttpsUrl, normalizeNuvioImageUrl, sortNuvioLists } from "../js/nuvio-export.js";
import {
  countImportedSelectedTraktListDuplicates,
  createNuvioImportSource,
  getNuvioDestinationCopy,
  getNuvioExportStatusModel,
  getNuvioImportState,
  getNuvioImportSummary,
  getSelectedListCountText,
  removeNuvioImportSource,
} from "../js/nuvio-export-ui.js";

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
const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const nuvioUiJs = readFileSync(new URL("../js/nuvio-export-ui.js", import.meta.url), "utf8");

assert.equal(getSafeHttpsUrl("http://example.com/cover.jpg"), "");
assert.equal(getSafeHttpsUrl("not a url"), "");
assert.equal(getSafeHttpsUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg");
assert.equal(normalizeNuvioImageUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg");
assert.equal(
  normalizeNuvioImageUrl("https://github.com/davecollections/nuvio-assets/blob/main/assets/collection%20covers/based_on/Comics.jpg?raw=true"),
  "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection%20covers/based_on/Comics.jpg",
);
assert.deepEqual(sortNuvioLists(lists, "likes-desc").map((item) => item.name), ["More Comedy", "Horror Finds", "Comedy Nights"]);
assert.equal(getSelectedListCountText(1), "1 list selected");
assert.equal(getSelectedListCountText(3), "3 lists selected");
assert.ok(!indexHtml.includes("id=\"preview-nuvio-json\""));
assert.ok(!indexHtml.includes("id=\"json-preview-modal\""));
assert.ok(!indexHtml.includes("Export preview"));
assert.match(indexHtml, /id="nuvio-output"[^>]*readonly[^>]*aria-readonly="true"[^>]*hidden/);
assert.match(indexHtml, /id="nuvio-close"[^>]*aria-label="Close Nuvio export"[^>]*>X</);
assert.match(indexHtml, /<h2 id="nuvio-title">Create Nuvio JSON<\/h2>\s*<p id="nuvio-count" class="result-owner"><\/p>/);
assert.match(indexHtml, /Collection details/);
assert.match(indexHtml, /Hero\/backdrop image URL/);
assert.match(indexHtml, /Folder order/);
assert.match(indexHtml, /Sorts generated folders, not the titles inside Trakt lists\./);
assert.match(indexHtml, /Artwork defaults/);
assert.match(indexHtml, /Auto poster images/);
assert.doesNotMatch(indexHtml, /id="nuvio-folder-image-mode"/);
assert.doesNotMatch(indexHtml, /Folder images/);
assert.match(nuvioUiJs, /auto poster images found/);
assert.match(indexHtml, /Folder tile shape/);
assert.match(indexHtml, /data-folder-tile-shape="LANDSCAPE"/);
assert.match(indexHtml, /data-folder-tile-shape="POSTER"/);
assert.match(indexHtml, /Folder titles/);
assert.match(indexHtml, /data-folder-title-mode="show"/);
assert.match(indexHtml, /data-folder-title-mode="hide"/);
assert.match(indexHtml, /id="nuvio-folder-artwork-overrides"/);
assert.match(nuvioUiJs, /Folder artwork overrides/);
assert.doesNotMatch(nuvioUiJs, /Optional custom cover image URLs for generated folders\./);
assert.match(nuvioUiJs, /FOLDER_ARTWORK_MODE_DEFAULT, "Default"/);
assert.match(nuvioUiJs, /FOLDER_ARTWORK_MODE_NONE, "None"/);
assert.match(nuvioUiJs, /FOLDER_ARTWORK_MODE_CUSTOM, "Custom"/);
assert.match(nuvioUiJs, /Cover image URL/);
assert.match(nuvioUiJs, /clearButton\.textContent = "Clear"/);
assert.match(nuvioUiJs, /setFolderArtworkChoice\(input\.dataset\.folderCoverKey, FOLDER_ARTWORK_MODE_CUSTOM, input\.value\)/);
assert.match(nuvioUiJs, /folderArtworkChoices\.clear\(\)/);
assert.match(nuvioUiJs, /input\.select\(\)/);
assert.match(nuvioUiJs, /image\.addEventListener\("error"/);
assert.match(nuvioUiJs, /syncFolderArtworkPreviewShape/);
assert.match(nuvioUiJs, /classList\.toggle\("is-poster", folderTileShape === "POSTER"\)/);
assert.match(indexHtml, /New collection/);
assert.match(indexHtml, /Split into new collections/);
assert.match(indexHtml, /Add to imported collection/);
assert.match(indexHtml, /Choose destination per list/);
assert.match(indexHtml, /Add selected lists to/);
assert.match(indexHtml, /id="nuvio-existing-json"[^>]*placeholder="Paste an existing Nuvio JSON array to append into it\."/);
assert.doesNotMatch(indexHtml, /id="nuvio-existing-json"[^>]*readonly/);
assert.match(indexHtml, /id="nuvio-existing-file"[^>]*multiple/);
assert.match(indexHtml, /id="nuvio-import-summary"[^>]*>No imported JSON</);
assert.match(indexHtml, /id="manage-nuvio-imports"[^>]*>Manage files</);
assert.match(indexHtml, /id="clear-nuvio-imports"[^>]*>Clear imported JSON</);
assert.match(indexHtml, /id="toggle-nuvio-paste"[^>]*>Paste JSON instead</);
assert.match(indexHtml, /id="nuvio-paste-panel"[^>]*hidden/);
assert.match(indexHtml, /id="nuvio-import-manage-title"[^>]*>Manage imported JSON</);
assert.match(indexHtml, /id="open-nuvio-import-help"[^>]*aria-label="Open Nuvio import help"[^>]*>\?/);
assert.match(nuvioUiJs, /appendMappingHeader\(listMapping, "Selected list", "Destination collection"\)/);
assert.match(nuvioUiJs, /appendMappingHeader\(splitMapping, "Selected list", "New collection name"\)/);
assert.match(nuvioUiJs, /Reuse the same name to group lists into one collection\./);

const importedOne = createNuvioImportSource({
  id: "source-a",
  key: "file:a",
  type: "file",
  label: "very-long-existing-nuvio-json-filename-that-should-not-appear-inline.json",
  text: JSON.stringify([{ id: "existing-a", title: "Existing A", folders: [{ id: "folder-a", title: "Folder A", sources: [] }] }]),
});
const importedTwo = createNuvioImportSource({
  id: "source-b",
  key: "file:b",
  type: "file",
  label: "other.json",
  text: JSON.stringify([
    { id: "existing-b", title: "Existing B", folders: [{ id: "folder-b", title: "Folder B", sources: [] }] },
    { id: "existing-c", title: "Existing C", folders: [{ id: "folder-c", title: "Folder C", sources: [] }] },
  ]),
});
const importedPaste = createNuvioImportSource({
  id: "pasted-json",
  key: "pasted-json",
  type: "paste",
  label: "Pasted JSON",
  text: JSON.stringify([{ id: "pasted", title: "Pasted", folders: [] }]),
});
const invalidImport = createNuvioImportSource({
  id: "source-bad",
  key: "file:bad",
  type: "file",
  label: "bad.json",
  text: "not json",
});
assert.equal(getNuvioImportSummary([]), "No imported JSON");
assert.equal(getNuvioImportState([importedOne]).message, "1 file imported · 1 collection · 1 folder");
assert.ok(!getNuvioImportState([importedOne]).message.includes(importedOne.label));
assert.equal(getNuvioImportState([importedOne, importedTwo]).message, "2 files imported · 3 collections · 3 folders");
assert.equal(getNuvioImportState([importedPaste]).message, "Pasted JSON imported · 1 collection · 0 folders");
assert.equal(getNuvioImportState([importedOne, importedPaste]).message, "2 imports added · 2 collections · 1 folder");
assert.equal(getNuvioImportState([importedOne, invalidImport]).message, "2 files imported · 1 needs attention");
assert.match(getNuvioImportState([importedOne, invalidImport]).error, /Remove or fix imported JSON/);
assert.deepEqual(removeNuvioImportSource([importedOne, importedTwo], "source-a").map((source) => source.id), ["source-b"]);

nextId = 0;
const defaultNamePayload = buildNuvioExportPayload({
  lists,
  createId,
});
assert.equal(defaultNamePayload.collections[0].title, "My Collection");

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
const fallbackTitleExport = buildNuvioExport({
  lists,
  collectionName: "",
  createId,
});
assert.equal(fallbackTitleExport[0].title, "My Collection");

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

const noExistingDestinationCopy = getNuvioDestinationCopy();
assert.equal(noExistingDestinationCopy.summary, "Create a new Nuvio collection from selected lists.");
assert.equal(noExistingDestinationCopy.newDescription, "Create one new collection from the selected lists.");
assert.equal(noExistingDestinationCopy.splitDescription, "Create separate new collections from the selected lists.");

const importedDestinationCopy = getNuvioDestinationCopy({ existingCollectionCount: 2 });
assert.equal(importedDestinationCopy.summary, "2 imported collections detected.");
assert.equal(importedDestinationCopy.newDescription, "Create one new collection alongside imported collections.");
assert.equal(importedDestinationCopy.splitDescription, "Create separate new collections alongside imported collections.");
assert.equal(importedDestinationCopy.existingDescription, "Add all selected lists to one imported collection. Existing Trakt lists may be skipped.");
assert.equal(importedDestinationCopy.mappedDescription, "Choose an imported collection for each selected list. Existing Trakt lists may be skipped.");

const mixedCommunityCollection = {
  id: "community-import",
  title: "Community Import",
  community: true,
  titleLogoUrl: "https://example.com/logo.png",
  folders: [
    {
      id: "mixed-folder",
      title: "Mixed Sources",
      coverImageUrl: "https://example.com/folder.jpg",
      sources: [
        { provider: "tmdb", type: "DISCOVER", mediaType: "MOVIE", query: { with_genres: "878" } },
        { provider: "trakt", mediaType: "TV", traktListId: 777 },
      ],
    },
  ],
};
const mixedImportSource = createNuvioImportSource({
  id: "mixed",
  key: "file:mixed",
  type: "file",
  label: "mixed-community.json",
  text: JSON.stringify([mixedCommunityCollection]),
});
nextId = 0;
const mixedImportPayload = buildNuvioExportPayload({
  lists: [list("New Trakt List", 7777)],
  existing: getNuvioImportState([mixedImportSource]).collections,
  mode: "new",
  createId,
});
assert.equal(mixedImportPayload.collections[0].community, true);
assert.equal(mixedImportPayload.collections[0].titleLogoUrl, "https://example.com/logo.png");
assert.equal(mixedImportPayload.collections[0].folders[0].sources[0].provider, "tmdb");
assert.equal(mixedImportPayload.collections[0].folders[0].sources[1].provider, "trakt");

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
assert.equal("id" in imageExport[0].folders[0].sources[0], false);

nextId = 0;
const customCoverExport = buildNuvioExport({
  lists,
  collectionName: "Custom Covers",
  coverUrl: "https://example.com/collection.jpg",
  folderImages: {
    101: "https://example.com/custom-comedy.jpg",
    102: "https://example.com/custom-horror.jpg",
  },
  createId,
});
assert.equal(customCoverExport[0].folders[0].coverImageUrl, "https://example.com/custom-comedy.jpg");
assert.equal(customCoverExport[0].folders[1].coverImageUrl, "https://example.com/custom-horror.jpg");
assert.equal(customCoverExport[0].folders[2].coverImageUrl, "https://example.com/collection.jpg");

nextId = 0;
const githubCoverExport = buildNuvioExport({
  lists,
  folderImages: {
    101: "https://github.com/davecollections/nuvio-assets/blob/main/assets/collection%20covers/based_on/Comics.jpg?raw=true",
  },
  createId,
});
assert.equal(githubCoverExport[0].folders[0].coverImageUrl, "https://raw.githubusercontent.com/davecollections/nuvio-assets/main/assets/collection%20covers/based_on/Comics.jpg");

nextId = 0;
const noCoverChoiceExport = buildNuvioExport({
  lists,
  collectionName: "No Cover Choice",
  coverUrl: "https://example.com/collection.jpg",
  folderImages: {
    101: "",
  },
  createId,
});
assert.equal(noCoverChoiceExport[0].folders[0].coverImageUrl, "");
assert.equal(noCoverChoiceExport[0].folders[1].coverImageUrl, "https://example.com/collection.jpg");

nextId = 0;
const posterTileExport = buildNuvioExport({
  lists,
  folderTileShape: "POSTER",
  hideFolderTitles: false,
  createId,
});
assert.equal(posterTileExport[0].folders[0].tileShape, "POSTER");
assert.equal(posterTileExport[0].folders[0].hideTitle, false);

nextId = 0;
const landscapeTileExport = buildNuvioExport({
  lists,
  folderTileShape: "LANDSCAPE",
  hideFolderTitles: true,
  createId,
});
assert.equal(landscapeTileExport[0].folders[0].tileShape, "LANDSCAPE");
assert.equal(landscapeTileExport[0].folders[0].hideTitle, true);

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
const splitArtworkExport = buildNuvioExport({
  lists,
  mode: "split",
  splitAssignments: {
    101: "Comedy",
    102: "Horror",
    103: "Comedy",
  },
  folderImages: {
    102: "https://example.com/custom-horror.jpg",
  },
  createId,
});
assert.equal(splitArtworkExport[1].folders[0].coverImageUrl, "https://example.com/custom-horror.jpg");

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
const mappedArtworkExport = buildNuvioExport({
  lists,
  existing,
  mode: "mapped",
  mappedAssignments: {
    101: "collection-a",
    102: "collection-b",
    103: "collection-a",
  },
  folderImages: {
    102: "https://example.com/custom-horror.jpg",
  },
  createId,
});
assert.equal(mappedArtworkExport[1].folders[0].coverImageUrl, "https://example.com/custom-horror.jpg");

nextId = 0;
const existingWithDuplicate = [
  {
    id: "collection-a",
    title: "A",
    folders: [
      {
        id: "existing-folder",
        title: "Already Added",
        coverImageUrl: "https://example.com/existing-artwork.jpg",
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
  folderImages: {
    101: "https://example.com/should-not-overwrite.jpg",
    102: "https://example.com/new-horror.jpg",
  },
  createId,
});
assert.equal(duplicateSafeExport[0].folders.length, 2);
assert.deepEqual(duplicateSafeExport[0].folders.map((folder) => folder.title), ["Already Added", "Horror Finds"]);
assert.equal(duplicateSafeExport[0].folders[0].coverImageUrl, "https://example.com/existing-artwork.jpg");
assert.equal(duplicateSafeExport[0].folders[1].coverImageUrl, "https://example.com/new-horror.jpg");

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
