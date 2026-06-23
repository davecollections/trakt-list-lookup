import assert from "node:assert/strict";
import {
  clearListItemCache,
  fetchFirstPosterUrl,
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
} finally {
  globalThis.fetch = originalFetch;
  clearListItemCache();
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function list() {
  return {
    ids: {
      trakt: 123,
      slug: "demo",
    },
    user: {
      username: "snoak",
    },
  };
}
