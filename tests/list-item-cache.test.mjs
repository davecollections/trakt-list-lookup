import assert from "node:assert/strict";
import {
  clearListItemCache,
  fetchFirstPosterUrl,
  fetchListMediaType,
  fetchPosterPreviewItems,
  fetchPosterSampleUrls,
} from "../js/list-item-cache.js";

const originalFetch = globalThis.fetch;

try {
  clearListItemCache();
  const calls = [];
  globalThis.fetch = async (value) => {
    const url = new URL(value, "https://example.test");
    calls.push(url);
    const page = Number(url.searchParams.get("page"));
    return jsonResponse({
      items: page === 1
        ? [
          { title: "Missing poster" },
          { title: "Poster one", poster: "https://image.test/one.jpg" },
        ]
        : [
          { title: "Poster two", poster: "https://image.test/two.jpg" },
        ],
      pagination: {
        page,
        limit: 15,
        page_count: 2,
        item_count: 3,
      },
    });
  };

  const preview = await fetchPosterPreviewItems(list(), {
    targetCount: 2,
    maxPages: 2,
  });

  assert.deepEqual(preview.items.map((item) => item.title), ["Poster one", "Poster two"]);
  assert.equal(preview.scanned, 3);
  assert.equal(preview.total, 3);
  assert.equal(calls.length, 2);

  const firstPoster = await fetchFirstPosterUrl(list());
  assert.equal(firstPoster, "https://image.test/one.jpg");
  assert.equal(calls.length, 2);

  const samples = await fetchPosterSampleUrls(list(), { targetCount: 1 });
  assert.deepEqual(samples, ["https://image.test/one.jpg"]);
  assert.equal(calls.length, 3);

  await testMediaTypeClassification();
} finally {
  globalThis.fetch = originalFetch;
  clearListItemCache();
}

async function testMediaTypeClassification() {
  await assertMediaType({
    items: [{ type: "movie" }, { type: "movie" }, { type: "movie" }],
    expected: {
      type: "MOVIE",
      movieCount: 3,
      tvCount: 0,
      otherCount: 0,
    },
  });

  await assertMediaType({
    items: [{ type: "show" }, { type: "season" }, { type: "episode" }],
    expected: {
      type: "TV",
      movieCount: 0,
      tvCount: 3,
      otherCount: 0,
    },
  });

  await assertMediaType({
    items: [{ type: "movie" }, { type: "movie" }, { type: "movie" }, { type: "movie" }, { type: "show" }],
    expected: {
      type: "MIXED",
      movieCount: 4,
      tvCount: 1,
      otherCount: 0,
    },
  });

  await assertMediaType({
    items: [
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "movie" },
      { type: "show" },
    ],
    expected: {
      type: "MOVIE",
      movieCount: 9,
      tvCount: 1,
      otherCount: 0,
    },
  });

  await assertMediaType({
    items: [],
    expected: {
      type: "UNKNOWN",
      movieCount: 0,
      tvCount: 0,
      otherCount: 0,
    },
  });

  await assertMediaType({
    items: [{ type: "person" }, { type: "unknown" }],
    expected: {
      type: "UNKNOWN",
      movieCount: 0,
      tvCount: 0,
      otherCount: 2,
    },
  });

  clearListItemCache();
  globalThis.fetch = async () => {
    throw new Error("Network failed");
  };
  const failed = await fetchListMediaType(list({ trakt: 999, slug: "failure" }));
  assert.equal(failed.type, "UNKNOWN");
  assert.equal(failed.confidence, "unknown");
}

async function assertMediaType({ items, expected }) {
  clearListItemCache();
  globalThis.fetch = async () => jsonResponse({
    items,
    pagination: {
      page: 1,
      limit: 15,
      page_count: 1,
      item_count: items.length,
    },
  });

  const metadata = await fetchListMediaType(list({ trakt: Math.random(), slug: `demo-${Math.random()}` }));
  assert.equal(metadata.type, expected.type);
  assert.equal(metadata.movieCount, expected.movieCount);
  assert.equal(metadata.tvCount, expected.tvCount);
  assert.equal(metadata.otherCount, expected.otherCount);
  assert.equal(metadata.scanned, items.length);
  assert.equal(metadata.total, items.length);
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function list({ trakt = 123, slug = "demo" } = {}) {
  return {
    ids: {
      trakt,
      slug,
    },
    user: {
      username: "snoak",
    },
  };
}
