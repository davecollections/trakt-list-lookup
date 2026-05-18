import assert from "node:assert/strict";
import { buildNuvioExport, getSafeHttpsUrl } from "../nuvio-export.js";

const lists = [
  list("Comedy Nights", 101),
  list("Horror Finds", 102),
  list("More Comedy", 103),
];

let nextId = 0;
const createId = (prefix) => `${prefix}-${++nextId}`;

assert.equal(getSafeHttpsUrl("http://example.com/cover.jpg"), "");
assert.equal(getSafeHttpsUrl("not a url"), "");
assert.equal(getSafeHttpsUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg");

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

function list(name, traktId) {
  return {
    name,
    ids: {
      trakt: traktId,
      slug: name.toLowerCase().replaceAll(" ", "-"),
    },
    user: {
      username: "demo",
    },
  };
}
