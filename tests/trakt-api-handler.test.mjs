import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/trakt.js";
import { enrichListsWithLikeCounts } from "../functions/lib/trakt-client.js";

const originalFetch = globalThis.fetch;

try {
  await testMissingClientId();
  await testMissingQuery();
  await testApiSecurityHeaders();
  await testUnsupportedMode();
  await testRateLimit();
  await testSortedRequestsAreWeighted();
  await testPopularPaginationAllowsPosterSamples();
  await testAuthoritativeLikeCountsReplacePayloadCounts();
  await testLikeCountFallbackKeepsPayloadCount();
  await testLikeCountTransientFailureIsQuietAndExportable();
  await testLikeCountTimeoutFallsBackQuickly();
  await testNormalRowsDoNotValidateDetails();
  await testPopularUnavailableSuspiciousResult();
  await testKeywordSuspiciousLikes404Validation();
  await testSuspiciousDetailSuccessRepairsResult();
  await testSuspiciousDetailSuccessItems404Unavailable();
  await testSuspiciousDetailSuccessItems503Unverified();
  await testNon404AvailabilityFailureIsUnverified();
  await testSortedQuickUsersUseEnrichedLikeCounts();
  await testQuickUsersFromSampledPages();
  await testQuickUsersFailureStillReturnsResults();
  await testUpstreamNonJsonIsGeneric();
  await testUpstreamForbiddenDoesNotExposeBody();
  await testSearchIncludesCuratedOwnerFallback();
  await testSearchUsesExplicitOwnerHint();
  await testResolveListUrl();
  await testResolveNumericListIdFromSearch();
  await testResolveNumericListIdFromUrlMode();
  await testDisplayNameOwnerUsesRouteSlug();
  await testNumericValidRouteUnavailableRemainsExportable();
  await testMissingNumericListId();
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

async function testAuthoritativeLikeCountsReplacePayloadCounts() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") {
      return jsonResponse([list({
        name: "IMDB: Top Rated Movies",
        username: "justin",
        trakt: 2142753,
        likes: 46,
      })]);
    }
    if (isListLikesPath(url, 2142753)) return jsonResponse([], paginationHeaders(4777, 4777, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].like_count, 4777);
}

async function testLikeCountFallbackKeepsPayloadCount() {
  const response = await withMutedConsole(async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/lists/popular") return jsonResponse([list({ trakt: 2142753, likes: 46 })]);
      if (isListLikesPath(url, 2142753)) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].like_count, 46);
}

async function testLikeCountTransientFailureIsQuietAndExportable() {
  const { result: response, events } = await withCapturedConsole(async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/lists/popular") {
        return jsonResponse([list({
          name: "Known Valid",
          slug: "known-valid",
          username: "valid_user",
          trakt: 11150552,
          likes: 7,
        })]);
      }
      if (isListLikesPath(url, 11150552)) {
        return new Response(JSON.stringify({ error: "upstream timeout" }), {
          status: 504,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].ids.trakt, 11150552);
  assert.equal(body.results[0].like_count, 7);
  assert.equal(body.results[0].availabilityStatus, "available");
  assert.equal(body.results[0].isAvailable, true);
  assert.equal(body.results[0].isExportable, true);
  assert.equal(body.results[0].url, "https://trakt.tv/users/valid_user/lists/known-valid");
  assert.deepEqual(events, []);
}

async function testLikeCountTimeoutFallsBackQuickly() {
  const { result: lists, events } = await withCapturedConsole(async () => {
    mockFetch(({ url, init }) => {
      if (isListLikesPath(url, 11150552)) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse([], paginationHeaders(7, 1, 1))), 50);
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return enrichListsWithLikeCounts([
      list({
        name: "Known Valid",
        slug: "known-valid",
        username: "valid_user",
        trakt: 11150552,
        likes: 7,
      }),
    ], env().TRAKT_CLIENT_ID, { likeTimeoutMs: 5 });
  });

  assert.equal(lists[0].like_count, 7);
  assert.equal(lists[0]._availabilitySignals?.likesNotFound, undefined);
  assert.deepEqual(events, []);
}

async function testNormalRowsDoNotValidateDetails() {
  const normalIds = new Set([2142753, 300, 301, 302]);
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") return jsonResponse([list({ trakt: 2142753, username: "justin", likes: 46 })]);
    if (url.pathname === "/lists/trending") return jsonResponse([list({ trakt: 300, username: "trend", likes: 3 })]);
    if (url.pathname === "/users/demo/lists") return jsonResponse([list({ trakt: 301, username: "demo", likes: 4 })]);
    if (url.pathname === "/search/list") {
      return jsonResponse([{ score: 1, list: list({ trakt: 302, username: "searcher", likes: 5 }) }]);
    }
    if (url.pathname === "/users/snoak/lists" || url.pathname === "/users/extreme_one/lists") return jsonResponse([]);
    for (const id of normalIds) {
      if (isListLikesPath(url, id)) return jsonResponse([], paginationHeaders(id, 1, 1));
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const responses = await Promise.all([
    callHandler("https://example.test/api/trakt?mode=popular", env()),
    callHandler("https://example.test/api/trakt?mode=trending", env()),
    callHandler("https://example.test/api/trakt?mode=user&q=demo", env()),
    callHandler("https://example.test/api/trakt?mode=search&q=horror", env()),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));

  responses.forEach((response) => assert.equal(response.status, 200));
  bodies.forEach((body) => {
    assert.equal(body.results[0].availabilityStatus, "available");
    assert.equal(body.results[0].isExportable, true);
  });
  assert.ok(!calls.some((call) => normalIds.has(Number(call.url.pathname.replace("/lists/", "")))));
}

async function testPopularUnavailableSuspiciousResult() {
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") {
      return jsonResponse([
        {
          name: "500 Essential Cult Movies: The Ultimate Guide By Jennifer Eiss",
          ids: {
            trakt: 805686,
          },
          user: {
            username: "unknown",
          },
          item_count: 500,
        },
      ], paginationHeaders(1, 1));
    }
    if (isListLikesPath(url, 805686)) {
      return jsonErrorResponse(404);
    }
    if (url.pathname === "/lists/805686") {
      return jsonErrorResponse(404);
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].ids.trakt, 805686);
  assert.equal(body.results[0].availabilityStatus, "unavailable");
  assert.equal(body.results[0].isAvailable, false);
  assert.equal(body.results[0].isExportable, false);
  assert.equal(body.results[0].availabilityMessage, "Unavailable or not public");
  assert.equal(body.results[0].url, "");
  assert.equal(body.results[0].ownerUsername, "");
  assert.equal(body.results[0].ownerDisplayName, "Owner unavailable");
  assert.equal(body.results[0].user.username, "");
  assert.equal(body.results[0].user.name, "Owner unavailable");
  assert.equal(body.results[0].canOpen, false);
  assert.equal(body.results[0].canPreview, false);
  assert.deepEqual(body.quickUsers, []);
  assert.ok(!calls.some((call) => call.url.pathname === "/lists/805686"));
}

async function testKeywordSuspiciousLikes404Validation() {
  const suspiciousIds = new Set([3469590, 825398, 3339599]);
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/search/list") {
      return jsonResponse([...suspiciousIds].map((trakt, index) => ({
        score: 10 - index,
        list: {
          name: `Apocalyptic ${index + 1}`,
          ids: {
            trakt,
          },
          user: {
            username: "unknown",
          },
          item_count: 10,
        },
      })), paginationHeaders(3, 1));
    }
    if (url.pathname === "/users/snoak/lists" || url.pathname === "/users/extreme_one/lists") return jsonResponse([]);
    for (const id of suspiciousIds) {
      if (isListLikesPath(url, id) || url.pathname === `/lists/${id}`) {
        return jsonErrorResponse(404);
      }
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=search&q=apocalyptic", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((result) => result.ids.trakt), [3469590, 825398, 3339599]);
  assert.deepEqual(body.results.map((result) => result.availabilityStatus), ["unavailable", "unavailable", "unavailable"]);
  assert.deepEqual(body.results.map((result) => result.isExportable), [false, false, false]);
  assert.deepEqual(body.results.map((result) => result.ownerDisplayName), ["Owner unavailable", "Owner unavailable", "Owner unavailable"]);
  assert.deepEqual(body.results.map((result) => result.canOpen), [false, false, false]);
  assert.deepEqual(body.results.map((result) => result.canPreview), [false, false, false]);
  assert.equal(calls.filter((call) => [...suspiciousIds].some((id) => isListLikesPath(call.url, id))).length, 3);
  assert.equal(calls.filter((call) => suspiciousIds.has(Number(call.url.pathname.replace("/lists/", "")))).length, 0);
}

async function testSuspiciousDetailSuccessRepairsResult() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") {
      return jsonResponse([{
        name: "Stale",
        ids: {
          trakt: 825398,
        },
        user: {
          username: "unknown",
        },
      }], paginationHeaders(1, 1));
    }
    if (isListLikesPath(url, 825398)) {
      return jsonResponse([], paginationHeaders(12, 1, 1));
    }
    if (url.pathname === "/lists/825398") {
      return jsonResponse(list({
        name: "Repaired List",
        slug: "repaired-list",
        username: "public_owner",
        trakt: 825398,
        likes: 12,
        items: 44,
      }));
    }
    if (url.pathname === "/users/public_owner/lists/repaired-list/items") {
      return jsonResponse([], paginationHeaders(44, 1, 1));
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].name, "Repaired List");
  assert.equal(body.results[0].item_count, 44);
  assert.equal(body.results[0].user.username, "public_owner");
  assert.equal(body.results[0].ids.slug, "repaired-list");
  assert.equal(body.results[0].url, "https://trakt.tv/users/public_owner/lists/repaired-list");
  assert.equal(body.results[0].availabilityStatus, "available");
  assert.equal(body.results[0].isExportable, true);
}

async function testSuspiciousDetailSuccessItems404Unavailable() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") {
      return jsonResponse([{
        name: "Apocalyptic and Post-Apocalyptic Movies",
        ids: {
          trakt: 825398,
        },
        user: {
          username: "unknown",
        },
      }], paginationHeaders(1, 1));
    }
    if (isListLikesPath(url, 825398)) {
      return jsonResponse([], paginationHeaders(12, 1, 1));
    }
    if (url.pathname === "/lists/825398") {
      return jsonResponse(list({
        name: "Apocalyptic and Post-Apocalyptic Movies",
        slug: "apocalyptic-and-post-apocalyptic-movies",
        username: "Trakt",
        trakt: 825398,
        likes: 12,
        items: 44,
      }));
    }
    if (url.pathname === "/users/Trakt/lists/apocalyptic-and-post-apocalyptic-movies/items") {
      return jsonErrorResponse(404);
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].ids.trakt, 825398);
  assert.equal(body.results[0].user.username, "");
  assert.equal(body.results[0].user.name, "Owner unavailable");
  assert.equal(body.results[0].ownerUsername, "");
  assert.equal(body.results[0].ownerDisplayName, "Owner unavailable");
  assert.equal(body.results[0].availabilityStatus, "unavailable");
  assert.equal(body.results[0].isAvailable, false);
  assert.equal(body.results[0].isExportable, false);
  assert.equal(body.results[0].availabilityMessage, "Unavailable or not public");
  assert.equal(body.results[0].url, "");
  assert.equal(body.results[0].canOpen, false);
  assert.equal(body.results[0].canPreview, false);
}

async function testSuspiciousDetailSuccessItems503Unverified() {
  const response = await withMutedConsole(async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/lists/popular") {
        return jsonResponse([{
          name: "Maybe Public",
          ids: {
            trakt: 3339599,
          },
          user: {
            username: "unknown",
          },
        }], paginationHeaders(1, 1));
      }
      if (isListLikesPath(url, 3339599)) {
        return jsonResponse([], paginationHeaders(12, 1, 1));
      }
      if (url.pathname === "/lists/3339599") {
        return jsonResponse(list({
          name: "Maybe Public",
          slug: "maybe-public",
          username: "public_owner",
          trakt: 3339599,
          likes: 12,
          items: 44,
        }));
      }
      if (url.pathname === "/users/public_owner/lists/maybe-public/items") {
        return new Response(JSON.stringify({ error: "Busy" }), {
          status: 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].ids.trakt, 3339599);
  assert.equal(body.results[0].availabilityStatus, "unverified");
  assert.equal(body.results[0].isAvailable, false);
  assert.equal(body.results[0].isExportable, false);
  assert.equal(body.results[0].availabilityMessage, "Could not verify public status");
  assert.equal(body.results[0].ownerUsername, "");
  assert.equal(body.results[0].ownerDisplayName, "Owner unverified");
  assert.equal(body.results[0].url, "");
  assert.equal(body.results[0].canOpen, false);
  assert.equal(body.results[0].canPreview, false);
}

async function testNon404AvailabilityFailureIsUnverified() {
  const response = await withMutedConsole(async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/lists/popular") {
        return jsonResponse([{
          name: "Maybe Gone",
          ids: {
            trakt: 3339599,
          },
          user: {
            username: "unknown",
          },
        }], paginationHeaders(1, 1));
      }
      if (isListLikesPath(url, 3339599)) {
        return jsonResponse([], paginationHeaders(2, 1, 1));
      }
      if (url.pathname === "/lists/3339599") {
        return new Response(JSON.stringify({ error: "Busy" }), {
          status: 503,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return callHandler("https://example.test/api/trakt?mode=popular", env());
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].availabilityStatus, "unverified");
  assert.equal(body.results[0].isAvailable, false);
  assert.equal(body.results[0].isExportable, false);
  assert.equal(body.results[0].availabilityMessage, "Could not verify public status");
  assert.equal(body.results[0].ownerUsername, "");
  assert.equal(body.results[0].ownerDisplayName, "Owner unverified");
  assert.equal(body.results[0].canOpen, false);
  assert.equal(body.results[0].canPreview, false);
}

async function testSortedQuickUsersUseEnrichedLikeCounts() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/popular") {
      return jsonResponse([
        list({ name: "Stale A", username: "creator-a", trakt: 201, likes: 1 }),
        list({ name: "Stale B", username: "creator-b", trakt: 202, likes: 2 }),
      ], paginationHeaders(2, 1, 50));
    }
    if (isListLikesPath(url, 201)) return jsonResponse([], paginationHeaders(25, 25, 1));
    if (isListLikesPath(url, 202)) return jsonResponse([], paginationHeaders(50, 50, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=popular&sort=likes", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.results.map((result) => result.like_count), [50, 25]);
  assert.deepEqual(body.quickUsers.map((user) => user.likeCount), [50, 25]);
}

async function testQuickUsersFromSampledPages() {
  mockFetch(({ url }) => {
    if (isListLikesPath(url, 100)) return jsonResponse([], paginationHeaders(1, 1, 1));
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
      if (isListLikesPath(url, 222)) return jsonResponse([], paginationHeaders(0, 0, 1));
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
    if (isListLikesPath(url, 33753562)) return jsonResponse([], paginationHeaders(0, 0, 1));
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
    if (isListLikesPath(url, 555)) return jsonResponse([], paginationHeaders(0, 0, 1));
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
    if (url.pathname === "/users/snoak/lists/demo") {
      assert.equal(url.searchParams.get("extended"), "full");
      return jsonResponse(list({ name: "Demo", slug: "demo", trakt: 123, likes: 9 }));
    }
    if (isListLikesPath(url, 123)) return jsonResponse([], paginationHeaders(11, 11, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler(
    "https://example.test/api/trakt?mode=url&q=https%3A%2F%2Ftrakt.tv%2Fusers%2Fsnoak%2Flists%2Fdemo",
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].name, "Demo");
  assert.equal(body.results[0].like_count, 11);
  assert.equal(body.results[0].url, "https://trakt.tv/users/snoak/lists/demo");
  assert.deepEqual(body.pagination, {
    page: 1,
    limit: 1,
    page_count: 1,
    item_count: 1,
  });
  assert.deepEqual(body.quickUsers.map((user) => user.username), ["snoak"]);
  assert.equal(body.quickUsers[0].topListName, "Demo");
  assert.equal(body.quickUsers[0].likeCount, 11);
}

async function testResolveNumericListIdFromSearch() {
  const response = await withMutedConsole(async () => {
    const calls = mockFetch(({ url }) => {
      if (url.pathname === "/lists/33753562") {
        assert.equal(url.searchParams.get("extended"), "full");
        return jsonResponse(list({
          name: "It's Aliens",
          slug: "it-s-aliens",
          username: "extreme_one",
          trakt: 33753562,
          likes: 9,
        }));
      }
      if (isListLikesPath(url, 33753562)) {
        return jsonResponse([], paginationHeaders(9, 1, 1));
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    const result = await callHandler("https://example.test/api/trakt?mode=search&q=33753562&sort=likes", env());
    assert.ok(!calls.some((call) => call.url.pathname === "/search/list"));
    return result;
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].name, "It's Aliens");
  assert.equal(body.results[0].ids.trakt, 33753562);
  assert.equal(body.results[0].like_count, 9);
  assert.equal(body.results[0].url, "https://trakt.tv/users/extreme_one/lists/it-s-aliens");
  assert.deepEqual(body.pagination, {
    page: 1,
    limit: 1,
    page_count: 1,
    item_count: 1,
  });
  assert.deepEqual(body.quickUsers.map((user) => user.username), ["extreme_one"]);
}

async function testResolveNumericListIdFromUrlMode() {
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/lists/33753562") {
      assert.equal(url.searchParams.get("extended"), "full");
      return jsonResponse(list({
        name: "ID Lookup",
        slug: "id-lookup",
        username: "demo",
        trakt: 33753562,
        likes: 2,
      }));
    }
    if (isListLikesPath(url, 33753562)) return jsonResponse([], paginationHeaders(12, 12, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=url&q=33753562", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].ids.trakt, 33753562);
  assert.equal(body.results[0].like_count, 12);
  assert.equal(body.quickUsers[0].likeCount, 12);
}

async function testDisplayNameOwnerUsesRouteSlug() {
  const calls = mockFetch(({ url }) => {
    if (url.pathname === "/lists/6652017") {
      assert.equal(url.searchParams.get("extended"), "full");
      return jsonResponse({
        name: "Attenborough Documentaries",
        privacy: "public",
        item_count: 93,
        like_count: null,
        updated_at: "2026-06-23T17:37:14Z",
        ids: {
          trakt: 6652017,
          slug: "attenborough-documentaries",
        },
        user: {
          username: "Hammers Lists",
          name: "Hammers lists",
          ids: {
            slug: "hammers-lists",
          },
        },
      });
    }
    if (isListLikesPath(url, 6652017)) return jsonResponse([], paginationHeaders(818, 1, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=search&q=6652017", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(body.results[0].ids.trakt, 6652017);
  assert.equal(body.results[0].user.username, "hammers-lists");
  assert.equal(body.results[0].user.name, "Hammers lists");
  assert.equal(body.results[0].ownerUsername, "hammers-lists");
  assert.equal(body.results[0].ownerDisplayName, "Hammers lists");
  assert.equal(body.results[0].url, "https://trakt.tv/users/hammers-lists/lists/attenborough-documentaries");
  assert.equal(body.results[0].canOpen, true);
  assert.equal(body.results[0].canPreview, true);
  assert.equal(body.results[0].isExportable, true);
}

async function testNumericValidRouteUnavailableRemainsExportable() {
  mockFetch(({ url }) => {
    if (url.pathname === "/lists/6652018") {
      assert.equal(url.searchParams.get("extended"), "full");
      return jsonResponse({
        name: "Route Missing",
        privacy: "public",
        item_count: 10,
        like_count: 2,
        updated_at: "2026-06-23T17:37:14Z",
        ids: {
          trakt: 6652018,
          slug: "route-missing",
        },
        user: {
          username: "Display Owner",
          name: "Display Owner",
        },
      });
    }
    if (isListLikesPath(url, 6652018)) return jsonResponse([], paginationHeaders(2, 1, 1));
    throw new Error(`Unexpected path ${url.pathname}`);
  });

  const response = await callHandler("https://example.test/api/trakt?mode=url&q=6652018", env());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results[0].ids.trakt, 6652018);
  assert.equal(body.results[0].isExportable, true);
  assert.equal(body.results[0].availabilityStatus, "available");
  assert.equal(body.results[0].ownerDisplayName, "Display Owner");
  assert.equal(body.results[0].ownerUsername, "");
  assert.equal(body.results[0].url, "");
  assert.equal(body.results[0].canOpen, false);
  assert.equal(body.results[0].canPreview, false);
}

async function testMissingNumericListId() {
  const response = await withMutedConsoleError(async () => {
    mockFetch(({ url }) => {
      if (url.pathname === "/lists/99999999") {
        return new Response("", {
          status: 404,
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    return callHandler("https://example.test/api/trakt?mode=search&q=99999999", env());
  });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, "No public list found for this Trakt list ID.");
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

function jsonErrorResponse(status) {
  return new Response(JSON.stringify({ error: "No matching Trakt list was found." }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
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

function isListLikesPath(url, id) {
  return url.pathname === `/lists/${id}/likes`;
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

async function withCapturedConsole(callback) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const events = [];
  console.error = (...args) => events.push(["error", ...args]);
  console.warn = (...args) => events.push(["warn", ...args]);
  try {
    return {
      result: await callback(),
      events,
    };
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
