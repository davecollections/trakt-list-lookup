import assert from "node:assert/strict";
import { __testables } from "../functions/api/trakt.js";
import {
  clampPositiveInteger,
  dedupeLists,
  getPagination,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeList,
  normalizeListItem,
  normalizeOptionalCount,
  normalizeSearchText,
  normalizeSort,
  normalizeSortOrder,
  parseTraktListUrl,
  parseUserListQuery,
  rankSearchResults,
  singleResultPagination,
  sortLists,
} from "../functions/lib/trakt-api-helpers.js";

const { getPublicErrorMessage } = __testables;

assert.deepEqual(parseUserListQuery("@snoak horror movies"), {
  username: "snoak",
  filter: "horror movies",
});
assert.deepEqual(parseUserListQuery("snoak"), {
  username: "snoak",
  filter: "",
});

assert.deepEqual(parseTraktListUrl("https://trakt.tv/users/snoak/lists/watchlist-finds"), {
  kind: "user-list",
  username: "snoak",
  slug: "watchlist-finds",
});
assert.deepEqual(parseTraktListUrl("https://app.trakt.tv/lists/12345"), {
  kind: "list-id",
  id: "12345",
});
assert.equal(parseTraktListUrl("https://example.com/users/snoak/lists/demo"), null);
assert.equal(parseTraktListUrl("not a url"), null);

assert.equal(isSafePathSegment("demo.user-123"), true);
assert.equal(isSafePathSegment("../demo"), false);
assert.equal(isSafePathSegment(""), false);

assert.equal(clampPositiveInteger("20", 10, 50), 20);
assert.equal(clampPositiveInteger("0", 10, 50), 10);
assert.equal(clampPositiveInteger("999", 10, 50), 50);
assert.equal(normalizeOptionalCount("12"), 12);
assert.equal(normalizeOptionalCount(""), null);
assert.equal(normalizeSort("likes"), "likes");
assert.equal(normalizeSort("unknown"), "");
assert.equal(normalizeSortOrder("asc"), "asc");
assert.equal(normalizeSortOrder("sideways"), "desc");

assert.equal(normalizeSearchText(" Horror: Films / 2024! "), "horror films 2024");
assert.equal(listMatchesTerms(list({ name: "Best Horror", description: "Slashers and ghosts" }), ["horror"]), true);
assert.equal(listMatchesTerms(list({ name: "Best Horror", description: "Slashers and ghosts" }), ["comedy"]), false);

const ranked = rankSearchResults([
  { score: 1, list: list({ name: "General Picks", slug: "general-picks" }) },
  { score: 1, list: list({ name: "Horror Picks", slug: "horror-picks" }) },
], "horror");
assert.equal(ranked[0].list.name, "Horror Picks");

const sortedByLikes = sortLists([
  list({ name: "B", likes: 2 }),
  list({ name: "A", likes: 8 }),
], "likes", "desc");
assert.deepEqual(sortedByLikes.map((item) => item.name), ["A", "B"]);

const sortedByTitle = sortLists([
  list({ name: "B" }),
  list({ name: "A" }),
], "title", "asc");
assert.deepEqual(sortedByTitle.map((item) => item.name), ["A", "B"]);

const deduped = dedupeLists([
  list({ trakt: 1, name: "One" }),
  list({ trakt: 1, name: "Duplicate" }),
  list({ trakt: 2, name: "Two" }),
]);
assert.deepEqual(deduped.map((item) => item.name), ["One", "Two"]);

assert.deepEqual(singleResultPagination(), {
  page: 1,
  limit: 1,
  page_count: 1,
  item_count: 1,
});

const pagination = getPagination(new Response("{}", {
  headers: {
    "x-pagination-page": "2",
    "x-pagination-limit": "30",
    "x-pagination-item-count": "95",
    "x-pagination-page-count": "1",
  },
}));
assert.deepEqual(pagination, {
  page: 2,
  limit: 30,
  page_count: 4,
  item_count: 95,
});

const normalized = normalizeList(list({
  name: "Demo",
  slug: "demo",
  username: "snoak",
  trakt: 123,
  likes: 7,
}));
assert.equal(normalized.url, "https://trakt.tv/users/snoak/lists/demo");
assert.equal(normalized.ids.trakt, 123);
assert.equal(normalized.like_count, 7);

const globalEntry = normalizeGlobalListEntry({
  like_count: "11",
  comment_count: "3",
  list: list({ name: "Popular" }),
});
assert.equal(globalEntry.like_count, 11);
assert.equal(globalEntry.comment_count, 3);

const movieItem = normalizeListItem({
  rank: 1,
  type: "movie",
  movie: {
    title: "Demo Movie",
    year: 2024,
    ids: {
      trakt: 10,
      tmdb: 20,
      imdb: "tt123",
    },
  },
});
assert.deepEqual(movieItem, {
  rank: 1,
  type: "movie",
  title: "Demo Movie",
  year: 2024,
  ids: {
    trakt: 10,
    tmdb: 20,
    show_tmdb: undefined,
    imdb: "tt123",
  },
});

const episodeItem = normalizeListItem({
  rank: 2,
  type: "episode",
  show: {
    title: "Demo Show",
    year: 2020,
    ids: {
      tmdb: 999,
    },
  },
  episode: {
    title: "Pilot",
    ids: {
      trakt: 30,
      tmdb: 40,
    },
  },
});
assert.equal(episodeItem.title, "Demo Show: Pilot");
assert.equal(episodeItem.ids.show_tmdb, 999);

assert.equal(getPublicErrorMessage(new Error("Bad request"), 400), "Bad request");
assert.equal(getPublicErrorMessage(new Error("Upstream details"), 502), "Trakt request failed. Try again shortly.");

function list({
  name = "Demo List",
  description = "",
  slug = "demo-list",
  username = "snoak",
  trakt = 100,
  likes = 0,
  items = 3,
  updated = "2024-01-01T00:00:00.000Z",
} = {}) {
  return {
    name,
    description,
    item_count: items,
    like_count: likes,
    updated_at: updated,
    ids: {
      trakt,
      slug,
    },
    user: {
      username,
    },
  };
}
