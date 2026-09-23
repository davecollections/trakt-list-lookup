import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/trakt.js";

const originalFetch = globalThis.fetch;

try {
  await testMissingClientId();
  await testMissingQuery();
  await testApiSecurityAndCacheHeaders();
  await testSuccessfulResponsesUseEdgeCache();
  await testRateLimit();
  await testPopularUsesSingleTraktRequestAndCurrentLikesField();
  await testKeywordSearchUsesDocumentedSearchEndpointOnly();
  await testUserLookupUsesSinglePageRequest();
  await testFilteredUserLookupFollowsPaginationUntilMatch();
  await testResolveListUrl();
  await testResolveNumericListId();
  await testRetryAfterIsPropagated();
  await testUpstreamNonJsonIsGeneric();
  await testListItems();
  await testListItemsWithoutPosters();
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

async function testApiSecurityAndCacheHeaders() {
  mockFetch(({ url }) => {
    assert.equal(url.pathname, "/lists/popular");
    return jsonResponse([], paginationHeaders(0, 1, 5));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=popular&page=1&limit=5",
    env(),
    { "CF-Connecting-IP": "203.0.113.101" },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.match(response.headers.get("Cache-Control"), /s-maxage=300/);
}

async function testSuccessfulResponsesUseEdgeCache() {
  const originalCaches = globalThis.caches;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(request) {
        return store.get(request.url)?.clone() || null;
      },
      async put(request, response) {
        store.set(request.url, response.clone());
      },
    },
  };

  try {
    const calls = mockFetch(({ url }) => {
      assert.equal(url.pathname, "/lists/popular");
      return jsonResponse([
        {
          like_count: 4,
          comment_count: 0,
          list: list({
            trakt: 150,
            slug: "cached-list",
            username: "cache_user",
            likes: 4,
          }),
        },
      ], paginationHeaders(1, 1, 5));
    });

    const url = "https://example.test/api/trakt?mode=popular&page=1&limit=5";
    const first = await callHandler(url, env(), { "CF-Connecting-IP": "203.0.113.120" });
    const second = await callHandler(url, env(), { "CF-Connecting-IP": "203.0.113.120" });
    const secondBody = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(secondBody.results[0].ids.trakt, 150);
  } finally {
    if (originalCaches === undefined) {
      delete globalThis.caches;
    } else {
      globalThis.caches = originalCaches;
    }
  }
}

async function testRateLimit() {
  const testEnv = {
    ...env(),
    API_RATE_LIMIT_PER_MINUTE: "2",
  };
  const headers = {
    "CF-Connecting-IP": "203.0.113.102",
  };

  await callHandler("https://example.test/api/trakt?mode=search", testEnv, headers);
  await callHandler("https://example.test/api/trakt?mode=search", testEnv, headers);
  const response = await callHandler("https://example.test/api/trakt?mode=search", testEnv, headers);
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(body.error, "Too many requests. Try again shortly.");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "2");
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
}

async function testPopularUsesSingleTraktRequestAndCurrentLikesField() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/lists/popular");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("extended"), null);

    return jsonResponse([
      {
        like_count: 42,
        comment_count: 3,
        list: list({
          name: "Popular List",
          trakt: 123,
          slug: "popular-list",
          username: "popular_user",
          likes: 42,
        }),
      },
    ], paginationHeaders(1, 1, 5));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=popular&page=1&limit=5",
    env(),
    { "CF-Connecting-IP": "203.0.113.103" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].like_count, 42);
  assert.equal(body.results[0].comment_count, 3);
  assert.equal(body.results[0].ids.trakt, 123);
  assert.equal(body.results[0].isExportable, true);
  assert.equal(body.quickUsers[0].username, "popular_user");
}

async function testKeywordSearchUsesDocumentedSearchEndpointOnly() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/search/list");
    assert.equal(url.searchParams.get("query"), "christmas");
    assert.equal(url.searchParams.get("extended"), null);

    return jsonResponse([
      {
        score: 10,
        type: "list",
        list: list({
          name: "Christmas Movies",
          trakt: 200,
          slug: "christmas-movies",
          username: "demo",
          likes: 9,
        }),
      },
    ], paginationHeaders(1, 1, 5));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=search&q=christmas&page=1&limit=5",
    env(),
    { "CF-Connecting-IP": "203.0.113.104" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results[0].name, "Christmas Movies");
  assert.equal(body.results[0].like_count, 9);
}

async function testUserLookupUsesSinglePageRequest() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/demo/lists");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "5");
    assert.equal(url.searchParams.get("extended"), null);
    return jsonResponse([
      list({
        name: "Demo Picks",
        trakt: 300,
        slug: "demo-picks",
        username: "demo",
        likes: 5,
      }),
    ], paginationHeaders(1, 1, 5));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=user&q=demo&page=1&limit=5",
    env(),
    { "CF-Connecting-IP": "203.0.113.105" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results[0].like_count, 5);
}

async function testFilteredUserLookupFollowsPaginationUntilMatch() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/demo/lists");
    assert.equal(url.searchParams.get("limit"), "100");

    if (url.searchParams.get("page") === "1") {
      return jsonResponse([
        list({
          name: "Comedy Picks",
          trakt: 401,
          slug: "comedy-picks",
          username: "demo",
        }),
      ], paginationHeaders(101, 2, 100));
    }

    if (url.searchParams.get("page") === "2") {
      return jsonResponse([
        list({
          name: "Horror Picks",
          trakt: 402,
          slug: "horror-picks",
          username: "demo",
          likes: 7,
        }),
      ], {
        "x-pagination-page": "2",
        "x-pagination-limit": "100",
        "x-pagination-page-count": "2",
        "x-pagination-item-count": "101",
      });
    }

    throw new Error(`Unexpected page ${url.searchParams.get("page")}`);
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=user&q=demo%20horror",
    env(),
    { "CF-Connecting-IP": "203.0.113.106" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("page")), ["1", "2"]);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].ids.trakt, 402);
  assert.equal(body.results[0].like_count, 7);
}

async function testResolveListUrl() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/demo/lists/url-list");
    assert.equal(url.searchParams.get("extended"), null);
    return jsonResponse(list({
      name: "URL List",
      trakt: 500,
      slug: "url-list",
      username: "demo",
      likes: 8,
    }));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=url&q=https%3A%2F%2Ftrakt.tv%2Fusers%2Fdemo%2Flists%2Furl-list",
    env(),
    { "CF-Connecting-IP": "203.0.113.107" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results[0].ids.trakt, 500);
  assert.equal(body.results[0].like_count, 8);
}

async function testResolveNumericListId() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/lists/600");
    assert.equal(url.searchParams.get("extended"), null);
    return jsonResponse(list({
      name: "ID List",
      trakt: 600,
      slug: "id-list",
      username: "demo",
      likes: 11,
    }));
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=url&q=600",
    env(),
    { "CF-Connecting-IP": "203.0.113.108" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.results[0].ids.trakt, 600);
  assert.equal(body.results[0].like_count, 11);
}

async function testRetryAfterIsPropagated() {
  const response = await withMutedConsoleError(async () => {
    mockFetch(({ url }) => {
      assert.equal(url.pathname, "/lists/popular");
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "17",
          "x-ratelimit": JSON.stringify({
            name: "UNAUTHED_API_GET_LIMIT",
            period: 300,
            limit: 500,
            remaining: 0,
          }),
        },
      });
    });

    return callHandler(
      "https://example.test/api/trakt?mode=popular",
      env(),
      { "CF-Connecting-IP": "203.0.113.109" },
    );
  });
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "17");
  assert.equal(body.error, "Trakt rate limit exceeded. Try again shortly.");
}

async function testUpstreamNonJsonIsGeneric() {
  const response = await withMutedConsoleError(async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    }));

    return callHandler(
      "https://example.test/api/trakt?mode=popular",
      env(),
      { "CF-Connecting-IP": "203.0.113.110" },
    );
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error, "Trakt request failed. Try again shortly.");
}

async function testListItems() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/snoak/lists/demo/items");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "15");
    assert.equal(url.searchParams.get("extended"), "full");
    return jsonResponse([
      {
        rank: 1,
        type: "movie",
        movie: {
          title: "Demo Movie",
          year: 2024,
          rating: 7.4,
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
    { "CF-Connecting-IP": "203.0.113.111" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].title, "Demo Movie");
  assert.equal(body.items[0].rating, 7.4);
  assert.equal(body.pagination.limit, 15);
}

async function testListItemsWithoutPosters() {
  const calls = mockFetch(({ url }) => {
    assert.equal(url.pathname, "/users/snoak/lists/demo/items");
    return jsonResponse([
      {
        rank: 1,
        type: "show",
        show: {
          title: "Demo Show",
          year: 2024,
          ids: {
            trakt: 11,
            tmdb: 21,
          },
        },
      },
    ]);
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=items&user=snoak&slug=demo&posters=0",
    {
      ...env(),
      TMDB_API_KEY: "test-tmdb-key",
    },
    { "CF-Connecting-IP": "203.0.113.112" },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.items[0].type, "show");
  assert.equal(body.items[0].poster, undefined);
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (value, init = {}) => {
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function paginationHeaders(itemCount, pageCount = itemCount ? 1 : 1, limit = 30) {
  return {
    "x-pagination-page": "1",
    "x-pagination-limit": String(limit),
    "x-pagination-page-count": String(pageCount),
    "x-pagination-item-count": String(itemCount),
  };
}

function callHandler(url, testEnv, headers = {}) {
  return onRequestGet({
    request: new Request(url, { headers }),
    env: testEnv,
  });
}

function env() {
  return {
    TRAKT_CLIENT_ID: "test-client-id",
  };
}

async function withMutedConsoleError(callback) {
  const originalError = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = originalError;
  }
}

function list({
  name = "Demo List",
  description = "",
  slug = "demo-list",
  username = "snoak",
  trakt = 100,
  likes = 0,
  items = 3,
} = {}) {
  return {
    name,
    description,
    privacy: "public",
    share_link: `https://trakt.tv/users/${username}/lists/${slug}`,
    type: "personal",
    display_numbers: false,
    allow_comments: true,
    sort_by: "rank",
    sort_how: "asc",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    item_count: items,
    comment_count: 0,
    likes,
    ids: {
      trakt,
      slug,
    },
    user: {
      username,
      private: false,
      deleted: false,
      name: username,
      ids: {
        slug: username,
        trakt: 999,
      },
    },
  };
}
