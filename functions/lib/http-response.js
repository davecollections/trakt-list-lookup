const SUCCESS_CACHE_SECONDS = 300;
const API_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
};

export function getPublicErrorMessage(error, status) {
  if (status >= 500) return "Trakt request failed. Try again shortly.";
  return error.message || "Trakt request failed.";
}

export function json(payload, status = 200, cacheable = false, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...API_SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheable
        ? `public, max-age=${SUCCESS_CACHE_SECONDS}, s-maxage=${SUCCESS_CACHE_SECONDS}`
        : "no-store",
      ...headers,
    },
  });
}
