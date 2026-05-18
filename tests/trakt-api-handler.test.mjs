import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/trakt.js";

const originalFetch = globalThis.fetch;

try {
  await testMissingClientId();
  await testMissingQuery();
  await testUnsupportedMode();
  await testResolveListUrl();
  await testListItems();
} finally {
  globalThis.fetch = originalFetch;
}

async function testMissingClientId() {
  const response = await callHandler("https://example.test/api/trakt?mode=popular", {});
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, "TRAKT_CLIENT_ID is not configured in Cloudflare.");
}

async function testMissingQuery() {
  const response = await callHandler("https://example.test/api/trakt?mode=search", env());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Missing search query.");
}

async function testUnsupportedMode() {
  const response = await callHandler("https://example.test/api/trakt?mode=unknown&q=demo", env());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Unsupported search mode.");
}

async function testResolveListUrl() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/snoak/lists/demo");
    assert.equal(url.searchParams.get("extended"), "full");
    return jsonResponse(list({ name: "Demo", slug: "demo", trakt: 123, likes: 9 }));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=url&q=https%3A%2F%2Ftrakt.tv%2Fusers%2Fsnoak%2Flists%2Fdemo",
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].name, "Demo");
  assert.equal(body.results[0].url, "https://trakt.tv/users/snoak/lists/demo");
  assert.deepEqual(body.pagination, {
    page: 1,
    limit: 1,
    page_count: 1,
    item_count: 1,
  });
}

async function testListItems() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/snoak/lists/demo/items");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "15");
    return jsonResponse([
      {
        rank: 1,
        type: "movie",
        movie: {
          title: "Demo Movie",
          year: 2024,
          ids: {
            trakt: 10,
            tmdb: 20,
          },
        },
      },
    ], {
      "x-pagination-page": "1",
      "x-pagination-limit": "15",
      "x-pagination-page-count": "1",
      "x-pagination-item-count": "1",
    });
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=items&user=snoak&slug=demo&limit=50",
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].title, "Demo Movie");
  assert.equal(body.items[0].poster, undefined);
  assert.equal(body.pagination.limit, 15);
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (value, init) => {
    const url = new URL(value);
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return calls;
}

function jsonResponse(payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers,
  });
}

function callHandler(url, testEnv) {
  return onRequestGet({
    request: new Request(url),
    env: testEnv,
  });
}

function env() {
  return {
    TRAKT_CLIENT_ID: "test-client-id",
  };
}

function list({
  name = "Demo List",
  slug = "demo-list",
  username = "snoak",
  trakt = 100,
  likes = 0,
} = {}) {
  return {
    name,
    description: "",
    item_count: 3,
    like_count: likes,
    updated_at: "2024-01-01T00:00:00.000Z",
    ids: {
      trakt,
      slug,
    },
    user: {
      username,
    },
  };
}
