# Dingo Trakt API v1 (B1)

## C #284 sorted Source Preview — local owner review

The existing combined first-page request `/v1/trakt/lists/123/items?page=1&limit=50`
remains unchanged (including default limit 15). An optional source context requires
all three parameters together: `type=movie|show`, `sort_by=rank|added|title|released|runtime|popularity|percentage|votes`,
and `sort_how=asc|desc`. Values are exact; partial contexts, aliases, duplicate or
unknown parameters, unsafe IDs, page 2 and limits outside 1–50 are rejected.

For example, `?page=1&limit=50&type=movie&sort_by=title&sort_how=desc` dispatches
one GET to `/lists/123/items/movie?page=1&limit=50&sort_by=title&sort_how=desc`.
TV maps to `show`; the same query is forwarded to `/lists/123/items/show`.
No metadata/composition request is added. Cost remains one shared-budget unit on
a cold operation, zero on a cache hit or coalesced follower. Cache identity includes
the entire validated context. The response shape and received item order are unchanged.
No local sorting, new route, CORS, credential, OAuth, write, or deployment change.

This extension is uncommitted and not deployed. Builder Source Edit acceptance against
the deployed extension requires a later owner-authorized integration/deployment gate.


Status: **dingo-api is deployed**; Builder B3 consumes the production API.
The existing `/items` endpoint awaits Builder C integration; C is not complete.
Tracking: [Trakt #22](https://github.com/davecollections/trakt-list-lookup/issues/22),
product parent [Dingo #276](https://github.com/davecollections/tmdb-id-lookup/issues/276).

The production Worker is **dingo-api**, at **https://api.dingo.build**.
The standalone Pages site and its /api/trakt endpoint retain their features and
participate in the same shared Trakt budget. Builder native Trakt sources and
production API integration are complete through
[B3 #282 / PR #283](https://github.com/davecollections/tmdb-id-lookup/pull/283).
[C #284](https://github.com/davecollections/tmdb-id-lookup/issues/284) owns the
remaining Builder Preview, Source Edit sorting, credits and final acceptance.
The records below retain the original B1 rollout and acceptance history; they do
not imply that deployment or B3 integration is still pending.

## Architecture and reuse

worker/dingo/index.js exports the Worker and its SQLite-backed Durable Object.
worker/dingo/worker.js is the routing/cache/CORS/reservation adapter. It calls the
existing shared searchLists, getUserLists, getGlobalLists, resolveListUrl,
getListMediaComposition, and getListItems functions. The fixed-host Trakt HTTP
client, parsing, list metrics, filtering, ranking, and pagination remain in
functions/lib. There is no copied upstream client or parallel list service.

The shared helpers/client/service accept opt-in strict options. Standalone
callers keep their response defaults, presentation labels, availability checks,
quick-user summaries and optional TMDB posters. Upstream calls within each
standalone operation now dispatch serially so quota refusal or Trakt 429 can stop
queued fan-out; this may increase latency for suspicious-list availability checks. Dingo
does not call those availability/enrichment/quick-user/sort workflows.

The versioned contract adapter intentionally differs from standalone presentation:
nullable metadata instead of invented display labels/counts, explicit
unverified discovery availability, and a text-only item projection. It discards
all unlisted upstream fields. It is not a second Trakt transport or service.

## Routes and maximum cold upstream cost

Only GET and OPTIONS are supported. All other methods return 405 with Allow.
Unknown paths return 404; invalid inputs return 400 before cache/reservation/fetch.

| GET path | Allowed parameters | Maximum cold Trakt calls |
| --- | --- | ---: |
| /v1/trakt/search | mode=keyword, q, page, limit | 1 |
| /v1/trakt/search | mode=user, q=username, page, limit | 1 |
| /v1/trakt/search | mode=user, q=username + filter | 3 reserved; 1–3 actual |
| /v1/trakt/browse | kind=popular or trending, page, limit | 1 |
| /v1/trakt/resolve | value=numeric ID or supported URL | 1 |
| /v1/trakt/lists/ID/media | none | 2 |
| /v1/trakt/lists/ID/items | page=1, limit | 1 |

Search/browse default to page=1 and limit=30, with page 1–25 and limit 1–50.
Filtered-user queries use the existing bounded scan of at most 250 entries in
three pages (100, 100, 50), stopping at 30 matches. They require page=1 and
limit=30; pagination describes that bounded result, not an exhaustive user library.
An optional leading @ on a username is normalized. The special account alias me
is rejected. Keyword search uses the existing ranking within one fetched page;
browse preserves the upstream ordering.

Items default to 15, max 50, and only page 1. They are a discovery sample, not an
exact physical MOVIE/TV Source Preview or an exhaustive export. No posters,
artwork, TMDB enrichment, automatic media requests, or item prefetch is performed.

IDs are canonical positive decimal integers up to Number.MAX_SAFE_INTEGER.
Text is trimmed, whitespace-normalized, limited to 220 input characters, and
rejects control characters. Integers do not accept leading zeros, fractions, signs,
or exponent notation. Unknown or duplicated query parameters are rejected.

Resolve accepts numeric IDs and HTTPS URLs on exactly trakt.tv, www.trakt.tv or
app.trakt.tv, with /lists/ID or /users/USERNAME/lists/SLUG and an optional trailing
slash. Segments use the shared ASCII safe-segment grammar (max 121 characters).
Credentials, non-default ports, query strings, fragments, escapes, dot segments,
extra path components, unsupported schemes/hosts, and unsafe IDs are rejected.
The shared parser's strict option provides these checks without altering the
standalone parser contract.

All upstream calls use https://api.trakt.tv with redirect: "manual". The shared
client explicitly rejects every HTTP 3xx with a sanitized 502, before JSON parsing.
Neither service follows Location, retries, exposes the destination, or forwards
credentials to a redirect target, including a target on api.trakt.tv itself.
There is no arbitrary target URL/path, OAuth, account access, write, history,
watchlist synchronization, scrobbling or recommendations route.

## Versioned responses

Every JSON response includes apiVersion: 1. Successful shapes:

~~~text
search/browse: { apiVersion: 1, lists: List[], pagination: Pagination }
resolve:      { apiVersion: 1, list: List }
media:        { apiVersion: 1, id: number, media: Media }
items:        { apiVersion: 1, id: number, sample: "first-page",
                items: Item[], pagination: Pagination }
~~~

List contains only:

- name, description: string or null;
- ids: { trakt: safe positive number, slug: string or null };
- creator: { username, name, slug }, each string or null;
- url: canonical Trakt user/slug URL when usable, otherwise numeric list URL;
- item_count, like_count: nonnegative safe integers or null;
- updated_at: upstream UTC ISO timestamp or null;
- availability: unverified, available, or unavailable.

Returned List ids.slug is metadata, separate from Resolve/input path segments.
Missing or null values remain null; a nonempty string of up to 1000 UTF-16 code
units is preserved exactly, without trimming or truncation. Empty strings, other
types, longer strings, and control characters (C0, DEL and C1) are rejected as
INVALID_UPSTREAM_RESPONSE. This 1000-unit ceiling is Dingo defensive output
policy, not a claimed Trakt maximum. Unicode, spaces and punctuation may remain
as metadata without being usable in a route. A user/slug URL is constructed only
when both the creator route username and list slug satisfy the existing ASCII
safe-segment grammar (max 121 characters); otherwise the canonical numeric List
ID supplies the numeric-list URL. Resolve/input and item slug rules are unchanged.

Discovery is unverified without an explicit successful resolve. Explicit
non-public metadata is unavailable; resolve rejects it. A successful resolve
establishes public metadata access, not a guarantee that future items will work.
No suspicious-row availability requests, per-row likes calls, or user scans are
triggered by ordinary discovery.

Pagination has page, limit, page_count, item_count. Missing upstream headers
remain null (including counts); explicit zero remains zero. Filtered-user
pagination is computed only for the bounded scan described above.

Media is { status: "known", composition, movie_count, show_count }.
Composition is movie-only, show-only, mixed, or zero. Both count reads must
succeed with valid explicit pagination counts; missing/malformed counts fail
with an error rather than becoming zero or mixed. The second read starts only
after the first succeeds. Each request asks for one item; no item crawling.

Item contains type (movie/show/season/episode), title, year, rank, season, number,
and ids { trakt, tmdb, imdb, slug, show_tmdb, show_slug }. Optional values are null.
Ranks/order are preserved; no invented title/year/identifier or image field.
Malformed payloads fail closed with a sanitized error.

Errors use { apiVersion: 1, error: { code, message } }. Distinct codes include
INVALID_REQUEST, NOT_FOUND, METHOD_NOT_ALLOWED, ORIGIN_DENIED, INVALID_PREFLIGHT,
LIST_NOT_FOUND, INVALID_UPSTREAM_RESPONSE, UPSTREAM_FAILURE, UPSTREAM_RATE_LIMIT,
UPSTREAM_BUDGET, ABUSE_LIMIT, SERVICE_NOT_CONFIGURED, BUDGET_UNAVAILABLE,
SERVICE_BUSY, and RESERVATION_EXPIRED.

## Cache and coalescing

Successful GET data is cached for 300 seconds using Cloudflare Cache API.
Errors are no-store. The key uses a fixed version namespace plus normalized
route/query semantics, never a credential or Origin. The stored response contains
no CORS headers; outgoing CORS is added only after evaluating the request's origin.
Equivalent default parameters and supported numeric resolve URLs share keys.
Different Origins therefore reuse data.

Identical misses coalesce within an isolate, including their single reservation.
Pending entries are removed on success/failure, bounded to 64 distinct operations;
overload returns 503 before reserving. Cache read/write failure can fall back to a
fully budgeted cold operation. Cache hits reserve zero. Cache API and coalescing
are not global quota accounting.

## Official quota and credential ownership

Owner-resolved working contract, verified from the **Current limits** table in the
[current Trakt developer guide](https://developer.trakt.tv/?section=guides&guide=rate-limiting):
**UNAUTHED_API_GET_LIMIT / Application / GET / 500 calls every 300 seconds**.
The example X-Ratelimit header on that page says limit 1000/period 300 and is
inconsistent; it does not override the table. A live header is runtime evidence,
never automatic permission to increase this service's cap.

The owner has one existing Trakt application/client ID, shared by standalone
Trakt List Lookup and Dingo. **TRAKT_CREDENTIAL_SCOPE=shared** is the sole supported
deployment mode. Absent, unknown or dedicated scope fails closed with 503; no
second app is assumed. The only credential is server-side TRAKT_CLIENT_ID, with
no OAuth token/client secret. Trakt's [app policy](https://docs.trakt.tv/docs/create-an-app)
prohibits additional registrations merely to bypass rate limits/restrictions.
A genuinely separate product could justify a separate registration in future,
subject to eligibility/policy and a separately reviewed design; this is not the
current deployment recommendation.

Both configuration files prepare shared scope; these local file changes do not
configure production. A missing credential or coordinator never falls back to
unaccounted upstream requests.

## One shared SQLite coordinator

The class DingoTraktBudget remains exported only by worker/dingo/index.js in the
**dingo-api** Worker. The existing **trakt-list-lookup** Pages project binds to
that external class using:

~~~toml
[[durable_objects.bindings]]
name = "TRAKT_BUDGET"
class_name = "DingoTraktBudget"
script_name = "dingo-api"
~~~

Cloudflare documents this [Pages external Durable Object binding](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#durable-objects).
Both adapters use the same namespace binding and the same stable object identity
**dingo-trakt-v1** through functions/lib/trakt-budget.js. Its older Dingo-prefixed
name is deliberately retained: changing it would create another pool. Never
create a separate standalone coordinator or reserve through public HTTP.
The object receives only unit counts, never a credential, query or Trakt payload.

The **450 units / 300 seconds** shared operating ceiling is an owner-selected
safety budget below the 500 upstream working limit. It covers combined calls from
both wired services, not 450 per service. Any other consumer of the credential,
including old deployments, direct local calls or separately named namespaces,
bypasses this ledger. Application-global protection therefore requires every
consumer to use this same namespace/object and cutover controls below.

## Atomic and incremental reservations

A synchronous SQLite transaction admits the complete 1–3-unit reservation.
Dingo's deterministic operation costs remain in the route table: media reserves
two units before either call, filtered-user reserves up to three once (including
unused units). Refusal makes zero calls for that operation.

Standalone keyword/user/global/resolve/items/media/sorted/filtered-user and
availability detail/item work reserve one unit immediately before each actual
Trakt dispatch. Variable operations are **not atomic**: exhaustion can follow
earlier successful calls, but the next unreserved call is stopped and the whole
public operation returns a sanitized error, never a successful partial payload.
Quick-user summaries use existing results; TMDB enrichment is not a Trakt call.

The shared client requires an explicit request-owned accounting context.
Dingo consumes its already-reserved units; it never reserves again per fetch.
Standalone uses incremental accounting. Missing context fails before fetch.
Requests within a context are serialized; quota failure/429 stops queued work.
Redirects are rejected so a hidden additional upstream request cannot bypass
accounting. There is no automatic retry.

The rolling upstream window is 300 seconds with a 30-second dispatch grace:
reservations remain for **330 seconds**. Each reservation's dispatch deadline
starts before the coordinator RPC and is checked immediately before fetch.
The second/third prepaid call must dispatch before the same deadline. Standalone
incremental calls each receive their own deadline. This retains a full 300-second
window after the latest permitted dispatch. Dingo retains its 10-second timeout
over headers and body; standalone retains its existing timeout defaults.
Failed or unused reservations are never refunded.

The ledger has at most 450 reservation rows plus one aggregate-state row.
Admission reads aggregate state and indexed expired rows; refusal reads at most
three oldest rows for complete-cost Retry-After. SQLite state survives object
lifecycle/restart, expiry is lazy, and clock rollback cannot free capacity.
There are no background alarms or upstream requests.

Both services check successful-response cache before reserving; proven hits cost
zero. Each keeps a separate response-contract cache, independent of Origin.
Standalone query parameter order is normalized. Identical misses coalesce within
each service isolate, bounded to 64 operations, and pay only once. Cache/coalescing
failures never bypass the global coordinator. Cache TTL remains 300 seconds;
errors are not stored as successes.

## Abuse throttle and 429

A separate instance of the shared in-memory limiter allows 60 requests/minute
per CF-Connecting-IP in an isolate; at most 10,000 buckets are retained. Missing
IP shares an unknown bucket. Expired buckets are swept at most once per minute;
a full table refuses new keys until cleanup. This is best-effort anonymous abuse
control, not a user identity or distributed quota. NAT/privacy proxies can group
unrelated users; isolate churn and location changes weaken its coverage. IPs
are kept transiently in memory, never persisted in the coordinator or custom logs.

Cloudflare's [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is location-local/eventually consistent and is not used for exact application
accounting.

Upstream 429 is distinct from empty results and local refusal. No automatic retry,
success caching, further media call, or continued filtered-user scan follows it.
Valid decimal-seconds Retry-After is bounded to 1–3600 seconds and exposed to
allowed browser origins; absent/invalid values are omitted. Budget and abuse
refusals use the same bounded header handling.

## CORS, headers and observability

Production permits exactly https://davecollections.github.io and
https://dingo.build. No wildcard, www.dingo.build, or LAN origin.
CORS cannot constrain GitHub Pages to a path, and is not a security boundary:
non-browser/no-Origin clients can call the restricted API.

env.local enables reviewed HTTP localhost/127.0.0.1 origins (any valid port) only
when the requested Worker host is itself localhost/127.0.0.1. Setting that flag on
the production hostname still cannot enable loopback origins. LAN/phone proxy
policy and a remote preview allowlist are separate owner-reviewed work.

OPTIONS advertises GET, OPTIONS and Accept only; unsupported methods/headers are
rejected. Outgoing responses use Vary: Origin, and allowed origins can read
Retry-After. No credentialed CORS is enabled.

JSON uses Content-Type, Cache-Control, X-Content-Type-Options, Referrer-Policy,
Permissions-Policy and applicable existing API headers. Dingo omits the shared
document CSP. Preflight responses include the relevant API/security headers.

One bounded structured log per request records route class, operation, cache
hit/miss/coalesced, reserved cost, budget refusal, up to three upstream statuses,
upstream429, final status and latency. It excludes actual query text, IDs, request
URLs, IPs, raw headers, bodies and credentials. It may include up to three
validated X-Ratelimit projections: name, period, limit, remaining. Standalone
also logs only this allowlisted operational projection when supplied; upstream
error bodies and raw rate-limit headers are never logged. A runtime 1000 value
does not alter the 450 cap. Invocation logs are disabled in the Dingo
config so default request URLs do not undo the custom logging policy.

## Local validation

Node 22.13+ is required for real-SQLite pure tests. No production dependency is
added. Run npm test and npm run check; npm run test:dingo also includes the
shared-budget SQLite suite. External fixtures exist only in pure unit tests.
The tests cover both adapters against the same real SQLite transaction path:
combined capacity, cross-service effects, atomic media, incremental stop,
exactly-once charging, zero-cost cache/coalescing, expiry, lifecycle and rollback.

Supported local multi-Worker development:

~~~powershell
npx.cmd --yes wrangler@4.145.0 pages dev . -c wrangler.toml -c wrangler.dingo.toml --ip 127.0.0.1 --port 8158
~~~

Cloudflare's [local RPC guidance](https://developers.cloudflare.com/workers/wrangler/api/#supported-bindings)
requires both configurations in one session for faithful cross-Worker RPC.
This command is local only; workers_dev and preview_urls remain disabled.
A private reservation-only probe verified connected Pages and Worker bindings,
the same object ID, and one real workerd SQLite ledger containing units [1, 2]
(used=3). It made zero Trakt calls and does not add a production diagnostic route.
The actual Pages handler also compiled and failed closed without its credential.

Bounded live acceptance is separate and must use the new Dingo Worker routes and
real public Trakt data, at most ten cold calls, with no posters/stress/forced 429.
The earlier shared-budget review had no local credential and made zero live calls.
A subsequent owner-authorized live acceptance run loaded the ignored local
credential safely into both services, but stopped on its first keyword search:
502 UPSTREAM_FAILURE before any Trakt HTTP response. The shared client then used
redirect: "error", which the tested Wrangler 4.145.0/workerd runtime rejected during
Request construction. A local constructor-only diagnostic reproduced the
TypeError and confirmed that "manual" is accepted, without contacting Trakt.
This was the first live gate's runtime compatibility defect; that attempt failed.

That run made one budgeted fetch attempt, zero actual outbound Trakt GETs and
consumed one non-refunded reservation unit. The four local negative checks
(malformed ID, unsupported parameter, wrong method and unapproved Origin) each
used zero units. No runtime X-Ratelimit values were obtained. Popular, resolve,
media, items, service-cache repeat and standalone live acceptance remain unrun.
That attempt did not satisfy successful-call accounting or integration. It
created no feature commit, push or PR. The historical failure is retained here;
the owner-authorized correction and successful repeat are recorded below.
Use ignored .dev.vars/.env or environment secrets; never put IDs in commands,
URLs, fixtures, logs, reports or Git. Loopback CORS uses only the reviewed local
Worker policy. A local coordinator does not account for concurrent production
traffic: reserve operational headroom before future shared-credential live probes.

Non-deploying validation:

~~~powershell
npx.cmd --yes wrangler@4.145.0 deploy --dry-run --config wrangler.dingo.toml --env="" --outdir .wrangler/dingo-dry-run
npx.cmd --yes wrangler@4.145.0 deploy --dry-run --config wrangler.dingo.toml --env infrastructure --outdir .wrangler/dingo-infrastructure
git diff --check
git status --short
~~~

The root Worker configuration prepares the eventual custom domain. The
infrastructure environment has the same Worker name/class and migration but
no routes; it supports the initial owner-approved infrastructure stage without
binding api.dingo.build. The existing Pages project remains in wrangler.toml.
Dry runs validate bundle/config syntax, not account permissions or live secrets.

## Runtime correction, repeated live acceptance and hosted validation

The shared client now uses workerd-supported manual redirect handling and
explicitly rejects the entire 300–399 status range. Pure real-SQLite tests cover
301/302/307/308 plus other 3xx statuses, same-origin and external Location values,
both public services, one retained charge, no second fetch/reservation, sanitized
errors, normal 2xx/errors and unchanged 429 handling.

Run npm run test:workerd for the repeatable secret-free compatibility test.
It starts pinned Wrangler 4.145.0 in a temporary local directory and tests the
actual shared client with workerd Request construction. Its synthetic transport
is restricted to this pure runtime unit test: no real Trakt request, secret or
external-service acceptance is involved. Fourteen cases cover both client
profiles, manual mode, redirects, successful JSON, 404 and 429/Retry-After.

The corrected real acceptance used a fresh, isolated ignored local persistence
directory. The previous failed reservation was left untouched; this was test
setup, not a refund. Both service paths used one real SQLite coordinator.

| Live operation | Result | Actual Trakt GETs | Shared units |
| --- | --- | ---: | ---: |
| Dingo keyword search | 200, normalized apiVersion 1 | 1 | 1 |
| Identical Dingo repeat | service-side cache hit, same response | 0 | 0 |
| Dingo popular browse | 200, real public lists | 1 | 1 |
| Dingo numeric resolve | 200, public metadata | 1 | 1 |
| Dingo media | 200, explicit movie/show counts | 2 | 2 |
| Dingo first-page items | 200, five normalized rows | 1 | 1 |
| Standalone numeric resolve | 200, existing response contract | 1 | 1 |
| Four negative input/method/origin checks | expected 404/400/405/403 | 0 | 0 |

Total: **seven actual outbound Trakt GETs, seven successful upstream HTTP 200
responses, seven shared units**. The ledger reservations were [1, 1, 1, 2, 1, 1];
media reserved two atomically. Observer-only local counters confirmed dispatches
and responses independently of reservations. No redirect, retry, double charging,
poster enrichment or fabricated external data occurred.

The live result selected list 1248149, MARVEL Cinematic Universe, with 46 movies
and 3 shows at the time of acceptance. These are runtime observations, not fixed
fixtures or future count guarantees. No sanitized X-Ratelimit values were
observed. The published working limit remains 500/300/application and the
internal combined budget remains 450/300.

Final local npm test and npm run check passed: 24 Dingo scenarios, 25 shared
real-SQLite scenarios (including the new redirect cases), budget expiry,
persistence/rollback, and existing standalone/helper/Nuvio export regressions.
Root and infrastructure Wrangler dry runs passed. The workerd test also passed.

.github/workflows/backend-validation.yml supplies one secret-free Node 22 job
on pull_request, push to main, and workflow_dispatch. It checks out the exact PR
head, runs npm test, npm run check, npm run test:workerd, and both pinned
Wrangler 4.145.0 dry runs. There is no schedule, live Trakt acceptance, API
credential reference, deployment or production mutation in that workflow.
Hosted results must be checked on the actual pushed head; local success alone
is not hosted-CI evidence.

## Historical B1 owner state and deployment sequence

The following owner-state snapshot and planned sequence are the original
pre-deployment B1 record, preserved unchanged. That rollout has since completed;
the current deployed/integrated status is stated above. This history does not
authorize any new deployment or configuration change.

Owner-confirmed: dingo.build is Active in the intended Cloudflare account;
api.dingo.build has not been manually created; one existing Trakt application
will be shared; the owner can configure secrets later. No Dingo Pages project is
needed. Do not create manual A/AAAA/CNAME records or change nameservers.

Remaining owner checks: required Worker/SQLite Durable Object plan and capacity,
secret configuration, correct binding namespace/object on every credential user,
and explicit approval for integration and production rollout.

Safest future sequence:

1. Owner reviews B1 and separately authorizes commit/push/PR/integration.
2. Before merging, owner prevents automatic Pages production/preview deployments
   from publishing the new binding before dingo-api exists. The existing site
   deploys from GitHub; merging first without this control could break its API.
3. Commit/push/PR/merge reviewed code only under that approved rollout control.
4. Deploy the no-route infrastructure environment to the same dingo-api Worker
   name, creating its SQLite Durable Object namespace. No public endpoint yet.
5. Owner configures the existing TRAKT_CLIENT_ID as a Worker secret, checks the
   matching Pages secret, and explicitly confirms shared scope for both.
6. Configure/verify the Pages external TRAKT_BUDGET binding to dingo-api /
   DingoTraktBudget with the unchanged dingo-trakt-v1 object identity.
7. Control standalone API traffic during cutover, drain old uncoordinated
   requests, then allow at least 330 seconds since their last Trakt dispatch
   before admitting new shared-budget traffic. A fresh ledger cannot account
   retrospectively for the previous deployment's calls.
8. Redeploy the existing Pages project with the new binding, resume controlled
   traffic and perform bounded standalone sanity checks. Check that no old
   preview or other credential consumer still bypasses the coordinator.
9. Only after standalone shared accounting is accepted, deploy the reviewed
   root Worker configuration to attach api.dingo.build to that same Worker.
   Domain binding follows standalone wiring so Dingo cannot consume an
   independent allowance alongside uncoordinated standalone traffic.
10. Perform bounded Dingo live acceptance and capture safe X-Ratelimit evidence.
    Restore intended automatic-deployment controls after the rollout is accepted.
11. Only then allow Dingo B2/B3/C integration to depend on the service.

All production steps remain owner-gated. Commit, push and PR require the
owner-authorized integration gates; they do not authorize deployment, Pages
redeployment, domain/DNS mutation or another Trakt app. Automatic Pages previews
must also be disabled or exclude the feature branch before an integration push.
Check [Cloudflare Durable Object pricing and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
against expected SQL/RPC use; no account billing/plan inspection is claimed.
