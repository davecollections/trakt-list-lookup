# Trakt List Lookup

Standalone Cloudflare Pages site for finding public Trakt list IDs, slugs, and links.

## Cloudflare setup

Set this required environment variable in Cloudflare Pages:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
```

For mirror sync (anticipated movies list) also set:

```text
TRAKT_CLIENT_SECRET=your_trakt_client_secret
TRAKT_REFRESH_TOKEN=your_trakt_refresh_token
MIRROR_ANTICIPATED_MOVIES_LIST_ID=34888329
MIRROR_MAX_ITEMS=200
MIRROR_SYNC_SECRET=your_random_sync_secret
```

Set one optional TMDB auth value if you want poster previews and folder images:

```text
TMDB_API_KEY=your_tmdb_api_key
```

Bearer token auth is also supported with `TMDB_ACCESS_TOKEN` or `TMDB_READ_ACCESS_TOKEN`.

The browser never receives the Trakt key. All Trakt calls go through `/api/trakt`.

## Supported lookups

- Keyword search: `GET /search/list?query=...`
- User public lists: `GET /users/:username/lists`
- List item previews: `GET /users/:username/lists/:slug/items`
- TMDB poster enrichment for list item previews, when TMDB auth is configured
- Nuvio JSON export for selected lists
- Movie mirror sync endpoint (anticipated -> your Trakt list)
- URL validation:
  - `https://trakt.tv/users/:username/lists/:slug`
  - `https://trakt.tv/lists/:id`

## Movie mirror sync

Use `GET` or `POST` against:

```text
/api/sync-mirror
```

Auth is controlled by `MIRROR_SYNC_SECRET`:

- Header: `x-sync-secret: <secret>`
- Or query param: `?secret=<secret>`

Example:

```text
https://trakt-list-lookup.pages.dev/api/sync-mirror?secret=YOUR_SECRET
```

Behavior:

1. Refreshes Trakt access token using `TRAKT_REFRESH_TOKEN`
2. Pulls anticipated movies from Trakt
3. Diffs against your mirror list
4. Removes stale items and adds new items

If response includes `refresh_token_rotated: true`, replace `TRAKT_REFRESH_TOKEN` in Cloudflare with the new one from the Trakt token response flow.

## Preview status

`robots.txt` currently discourages indexing while the project is being tested.

## Local notes

The static UI can be opened directly with `index.html`, but API calls need Cloudflare Pages Functions or Wrangler because `/api/trakt` is server-side.

For local Cloudflare testing:

```powershell
cd "C:\Users\Dave\Documents\New project 3\trakt-list-lookup"
npx.cmd wrangler@latest pages dev . --port 8158 --ip 127.0.0.1 --binding TRAKT_CLIENT_ID=your_trakt_api_client_id --binding TMDB_API_KEY=your_tmdb_api_key
```

Use `npx.cmd` in Windows PowerShell if `npx` is blocked by the execution policy. Run the command from the project directory so Wrangler finds `functions/api/trakt.js`; the startup output should say `Compiled Worker successfully`.

If you do not need posters locally, omit the `TMDB_API_KEY` binding.

For deployment:

```powershell
wrangler pages deploy .
```
