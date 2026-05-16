# Trakt List Lookup

Standalone Cloudflare Pages site for finding public Trakt list IDs, slugs, and links.

## Cloudflare setup

Set this environment variable in Cloudflare Pages:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
```

The browser never receives the Trakt key. All Trakt calls go through `/api/trakt`.

## Supported lookups

- Keyword search: `GET /search/list?query=...`
- User public lists: `GET /users/:username/lists`
- List item previews: `GET /users/:username/lists/:slug/items`
- URL validation:
  - `https://trakt.tv/users/:username/lists/:slug`
  - `https://trakt.tv/lists/:id`

## Preview status

`robots.txt` currently discourages indexing while the project is being tested.

## Local notes

The static UI can be opened directly with `index.html`, but API calls need Cloudflare Pages Functions or Wrangler because `/api/trakt` is server-side.

For local Cloudflare testing:

```powershell
wrangler pages dev . --binding TRAKT_CLIENT_ID=your_trakt_api_client_id
```

For deployment:

```powershell
wrangler pages deploy .
```
