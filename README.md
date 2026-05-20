# Trakt List Lookup

Standalone Cloudflare Pages site for finding public Trakt list IDs, slugs, and links.

## Cloudflare setup

Set this required environment variable in Cloudflare Pages:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
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
- URL validation:
  - `https://trakt.tv/users/:username/lists/:slug`
  - `https://trakt.tv/lists/:id`

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
