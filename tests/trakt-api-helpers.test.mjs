import assert from "node:assert/strict";
import { getPublicErrorMessage } from "../functions/lib/http-response.js";
import {
  clampPositiveInteger,
  dedupeLists,
  getPagination,
  isListAvailabilitySuspicious,
  isSafePathSegment,
  listMatchesTerms,
  normalizeGlobalListEntry,
  normalizeList,
  normalizeListItem,
  normalizeOptionalCount,
  normalizeSearchText,
  normalizeSort,
  normalizeSortOrder,
  parseTraktListId,
  parseTraktListUrl,
  parseUserListQuery,
  rankSearchResults,
  singleResultPagination,
  sortLists,
  shouldValidateListAvailability,
  withListAvailability,
} from "../functions/lib/trakt-api-helpers.js";

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
assert.equal(parseTraktListId("33753562"), "33753562");
assert.equal(parseTraktListId(" 33753562 "), "33753562");
assert.equal(parseTraktListId("0"), "");
assert.equal(parseTraktListId("33753562 aliens"), "");

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
assert.equal(listMatchesTerms(list({ name: "It's Aliens", slug: "it-s-aliens" }), normalizeSearchText("its aliens").split(" ")), true);

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
assert.equal(normalized.availabilityStatus, "available");
assert.equal(normalized.isAvailable, true);
assert.equal(normalized.isExportable, true);
assert.equal(normalized.ownerUsername, "snoak");
assert.equal(normalized.ownerDisplayName, "snoak");
assert.equal(normalized.canOpen, true);
assert.equal(normalized.canPreview, true);

const normalizedDisplayOwner = normalizeList(listWithDisplayOwner({
  trakt: 6652017,
  name: "Attenborough Documentaries",
  listSlug: "attenborough-documentaries",
  username: "Hammers Lists",
  userSlug: "hammers-lists",
  displayName: "Hammers lists",
}));
assert.equal(normalizedDisplayOwner.user.username, "hammers-lists");
assert.equal(normalizedDisplayOwner.user.name, "Hammers lists");
assert.equal(normalizedDisplayOwner.ownerUsername, "hammers-lists");
assert.equal(normalizedDisplayOwner.ownerDisplayName, "Hammers lists");
assert.equal(normalizedDisplayOwner.url, "https://trakt.tv/users/hammers-lists/lists/attenborough-documentaries");
assert.equal(normalizedDisplayOwner.isExportable, true);
assert.equal(normalizedDisplayOwner.canOpen, true);
assert.equal(normalizedDisplayOwner.canPreview, true);

const normalizedWithoutOwnerSlug = normalizeList({
  name: "ID Only",
  ids: {
    trakt: 456,
  },
});
assert.equal(normalizedWithoutOwnerSlug.ids.trakt, 456);
assert.equal(normalizedWithoutOwnerSlug.url, "");
assert.equal(normalizedWithoutOwnerSlug.availabilityStatus, "unverified");
assert.equal(normalizedWithoutOwnerSlug.isExportable, false);
assert.equal(normalizedWithoutOwnerSlug.availabilityMessage, "Could not verify public status");
assert.equal(normalizedWithoutOwnerSlug.ownerUsername, "");
assert.equal(normalizedWithoutOwnerSlug.ownerDisplayName, "Owner unverified");
assert.equal(normalizedWithoutOwnerSlug.canOpen, false);
assert.equal(normalizedWithoutOwnerSlug.canPreview, false);

const routeUnavailableButExportable = normalizeList(withListAvailability({
  name: "ID Valid Route Unavailable",
  ids: {
    trakt: 6652017,
    slug: "attenborough-documentaries",
  },
  user: {
    username: "Hammers Lists",
    name: "Hammers lists",
  },
}, "available"));
assert.equal(routeUnavailableButExportable.isExportable, true);
assert.equal(routeUnavailableButExportable.url, "");
assert.equal(routeUnavailableButExportable.canOpen, false);
assert.equal(routeUnavailableButExportable.canPreview, false);

assert.equal(isListAvailabilitySuspicious(list({ username: "unknown", trakt: 789 })), true);
assert.equal(shouldValidateListAvailability(list({ username: "unknown", trakt: 789 })), true);
assert.equal(shouldValidateListAvailability(withListAvailability(list({ username: "unknown", trakt: 789 }), "available")), false);

const unavailable = normalizeList(withListAvailability(list({ name: "Gone", trakt: 999 }), "unavailable", "Unavailable or not public"));
assert.equal(unavailable.availabilityStatus, "unavailable");
assert.equal(unavailable.isAvailable, false);
assert.equal(unavailable.isExportable, false);
assert.equal(unavailable.ownerUsername, "");
assert.equal(unavailable.ownerDisplayName, "Owner unavailable");
assert.equal(unavailable.url, "");
assert.equal(unavailable.canOpen, false);
assert.equal(unavailable.canPreview, false);

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
    rating: 7.4,
    ids: {
      trakt: 10,
      tmdb: 20,
      imdb: "tt123",
      slug: "demo-movie-2024",
    },
  },
});
assert.deepEqual(movieItem, {
  rank: 1,
  type: "movie",
  title: "Demo Movie",
  year: 2024,
  rating: 7.4,
  season: "",
  number: "",
  ids: {
    trakt: 10,
    tmdb: 20,
    show_tmdb: undefined,
    imdb: "tt123",
    slug: "demo-movie-2024",
    show_slug: undefined,
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
      slug: "demo-show",
    },
  },
  episode: {
    title: "Pilot",
    rating: 8.2,
    season: 1,
    number: 1,
    ids: {
      trakt: 30,
      tmdb: 40,
    },
  },
});
assert.equal(episodeItem.title, "Demo Show: Pilot");
assert.equal(episodeItem.rating, 8.2);
assert.equal(episodeItem.ids.show_tmdb, 999);
assert.equal(episodeItem.ids.show_slug, "demo-show");
assert.equal(episodeItem.season, 1);
assert.equal(episodeItem.number, 1);

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

function listWithDisplayOwner({
  name,
  trakt,
  listSlug,
  username,
  userSlug,
  displayName,
}) {
  return {
    name,
    description: "",
    item_count: 1,
    like_count: 0,
    updated_at: "2024-01-01T00:00:00.000Z",
    ids: {
      trakt,
      slug: listSlug,
    },
    user: {
      username,
      name: displayName,
      ids: {
        slug: userSlug,
      },
    },
  };
}
