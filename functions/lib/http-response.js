const SUCCESS_CACHE_SECONDS = 300;

export function getPublicErrorMessage(error, status) {
  if (status >= 500) return "Trakt request failed. Try again shortly.";
  return error.message || "Trakt request failed.";
}

export function json(payload, status = 200, cacheable = false, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheable
        ? `public, max-age=${SUCCESS_CACHE_SECONDS}, s-maxage=${SUCCESS_CACHE_SECONDS}`
        : "no-store",
      ...headers,
    },
  });
}
