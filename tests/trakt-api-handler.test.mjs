import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/trakt.js";

const originalFetch = globalThis.fetch;

try {
  await testMissingClientId();
  await testMissingQuery();
  await testApiSecurityHeaders();
  await testUnsupportedMode();
  await testRateLimit();
  await testSortedRequestsAreWeighted();
  await testPopularPaginationAllowsPosterSamples();
  await testQuickUsersFromSampledPages();
  await testQuickUsersFailureStillReturnsResults();
  await testUpstreamNonJsonIsGeneric();
  await testUpstreamForbiddenDoesNotExposeBody();
  await testSearchIncludesCuratedOwnerFallback();
  await testSearchUsesExplicitOwnerHint();
  await testResolveListUrl();
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

async function testApiSecurityHeaders() {
  const response = await callHandler("https://example.test/api/trakt?mode=search", env());

  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
}

async function testUnsupportedMode() {
  const response = await callHandler("https://example.test/api/trakt?mode=unknown&q=demo", env());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Unsupported search mode.");
}

async function testRateLimit() {
  const testEnv = {
    ...env(),
    API_RATE_LIMIT_PER_MINUTE: "2",
  };
  const headers = {
    "CF-Connecting-IP": "203.0.113.10",
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

async function testSortedRequestsAreWeighted() {
  const calls = mockFetch(() => jsonResponse([]));
  const testEnv = {
    ...env(),
    API_RATE_LIMIT_PER_MINUTE: "10",
  };
  const headers = {
    "CF-Connecting-IP": "203.0.113.20",
  };

  const firstResponse = await callHandler("https://example.test/api/trakt?mode=popular&sort=likes", testEnv, headers);
  const secondResponse = await callHandler("https://example.test/api/trakt?mode=popular&sort=likes", testEnv, headers);
  const secondBody = await secondResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 429);
  assert.equal(secondBody.error, "Too many requests. Try again shortly.");
  assert.equal(calls.length, 1);
}

async function testPopularPaginationAllowsPosterSamples() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") return jsonResponse([]);
    if (url.pathname.includes("/items")) {
      return jsonResponse([
        {
          rank: 1,
          type: "movie",
          movie: {
            title: "Sample",
            year: 2024,
            ids: {
              trakt: 1,
            },
          },
        },
      ]);
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const testEnv = {
    ...env(),
    API_RATE_LIMIT_PER_MINUTE: "40",
  };
  const headers = {
    "CF-Connecting-IP": "203.0.113.30",
  };

  await callHandler("https://example.test/api/trakt?mode=popular&page=1", testEnv, headers);
  for (let index = 0; index < 30; index += 1) {
    const response = await callHandler(`https://example.test/api/trakt?mode=items&user=user${index}&slug=list-${index}`, testEnv, headers);
    assert.equal(response.status, 200);
  }

  const response = await callHandler("https://example.test/api/trakt?mode=popular&page=2", testEnv, headers);
  assert.equal(response.status, 200);
}

async function testQuickUsersFromSampledPages() {
  mockFetch(({ url }) => {
    if (url.pathname !== "/lists/popular") throw new Error(`Unexpected path ${url.pathname}`);

    const limit = url.searchParams.get("limit");
    const page = url.searchParams.get("page");
    if (limit === "30") return jsonResponse([list({ username: "visible", likes: 1 })], paginationHeaders(75, 3, 30));
    if (limit === "50" && page === "1") {
      return jsonResponse([
        list({ name: "A One", username: "creator-a", trakt: 201, likes: 10, items: 4 }),
        list({ name: "B One", username: "creator-b", trakt: 202, likes: 5, items: 8 }),
      ], paginationHeaders(75, 2, 50));
    }
    if (limit === "50" && page === "2") {
      return jsonResponse([
        list({ name: "A Two", username: "creator-a", trakt: 203, likes: 7, items: 6 }),
        list({ name: "C One", username: "creator-c", trakt: 204, likes: 30, items: 10 }),
      ], paginationHeaders(75, 2, 50));
    }
    throw new Error(`Unexpected popular request ${url.search}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.quickUsers.map((user) => user.username), ["creator-c", "creator-a", "creator-b"]);
  assert.equal(body.quickUsers[0].likeCount, 30);
  assert.equal(body.quickUsers[1].listCount, 2);
  assert.equal(body.quickUsers[1].itemCount, 10);
  assert.equal(body.quickUsers[1].topListName, "A One");
  assert.equal(body.quickUsers[1].topListId, 201);
}

async function testQuickUsersFailureStillReturnsResults() {
  const response = await withMutedConsole(async () => {
    mockFetch(({ url }) => {
      if (url.pathname !== "/lists/trending") throw new Error(`Unexpected path ${url.pathname}`);
      if (url.searchParams.get("limit") === "50") throw new Error("Summary failed");
      return jsonResponse([list({ name: "Trending", username: "demo", trakt: 222 })], paginationHeaders(1, 1));
    });

    return callHandler("https://example.test/api/trakt?mode=trending", env());
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.quickUsers, undefined);
}

async function testUpstreamNonJsonIsGeneric() {
  const response = await withMutedConsoleError(async () => {
    mockFetch(() => new Response("<html>Temporarily unavailable</html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    }));

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error, "Trakt request failed. Try again shortly.");
}

async function testUpstreamForbiddenDoesNotExposeBody() {
  const response = await withMutedConsoleError(async () => {
    mockFetch(() => new Response("secret upstream detail", {
      status: 403,
      headers: {
        "content-type": "text/plain",
      },
    }));

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error, "Trakt rejected the API key or the app is not approved.");
  assert.ok(!body.error.includes("secret upstream detail"));
}

async function testSearchIncludesCuratedOwnerFallback() {
  mockFetch(({ url }) => {
    if (url.pathname === "/search/list") return jsonResponse([], paginationHeaders(0));
    if (url.pathname === "/users/snoak/lists") return jsonResponse([]);
    if (url.pathname === "/users/extreme_one/lists") {
      return jsonResponse([
        list({
          name: "It's Aliens",
          slug: "it-s-aliens",
          username: "Extreme_One",
          trakt: 33753562,
        }),
      ]);
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=search&q=its%20aliens", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].name, "It's Aliens");
  assert.equal(body.results[0].user.username, "Extreme_One");
}

async function testSearchUsesExplicitOwnerHint() {
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/search/list") return jsonResponse([], paginationHeaders(0));
    if (url.pathname === "/users/demo_user/lists") {
      return jsonResponse([
        list({
          name: "Aliens Finds",
          slug: "aliens-finds",
          username: "demo_user",
          trakt: 555,
        }),
      ]);
    }
    if (url.pathname === "/users/snoak/lists" || url.pathname === "/users/extreme_one/lists") return jsonResponse([]);
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=search&q=%40demo_user%20aliens", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].user.username, "demo_user");
  assert.ok(calls.some((call) => call.url.pathname === "/users/demo_user/lists"));
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
  assert.deepEqual(body.quickUsers.map((user) => user.username), ["snoak"]);
  assert.equal(body.quickUsers[0].topListName, "Demo");
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
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(body.items[0].type, "show");
  assert.equal(body.items[0].poster, undefined);
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function paginationHeaders(itemCount, pageCount = itemCount ? 1 : 0, limit = 30) {
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

async function withMutedConsole(callback) {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await callback();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

function list({
  name = "Demo List",
  slug = "demo-list",
  username = "snoak",
  trakt = 100,
  likes = 0,
  items = 3,
} = {}) {
  return {
    name,
    description: "",
    item_count: items,
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
