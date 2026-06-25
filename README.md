# Trakt List Lookup

Trakt List Lookup helps find public Trakt lists and export selected lists into Nuvio-compatible JSON.

Live site: [https://trakt-list-lookup.pages.dev/](https://trakt-list-lookup.pages.dev/)

## What The Tool Does

- Search public Trakt lists by keyword.
- Look up public lists from a Trakt username.
- Resolve supported Trakt list URLs.
- Resolve direct numeric Trakt list IDs.
- Browse popular and trending public lists.
- Preview a sample of list titles and posters when metadata is available.
- Select useful lists and create Nuvio JSON exports.
- Import existing Nuvio JSON and add selected Trakt lists into it.

## How To Search

Use the search mode buttons at the top of the page.

- **Keyword** searches public list titles and descriptions. If the input is only numbers, the tool treats it as a direct Trakt list ID.
- **User** loads public lists from one Trakt user.
- **URL** accepts supported public Trakt list URLs and direct numeric Trakt list IDs.
- **Popular** loads popular public Trakt lists.
- **Trending** loads trending public Trakt lists.

Results show the list title, owner where available, Trakt ID, item count, likes, update date, and actions for opening, previewing, and selecting the list.

## Selecting Lists

Use **Add** on any exportable result to add it to your selected lists. Use **Manage selection** to review or remove selected lists before exporting.

Unavailable, private, deleted, stale, or unverified lists are blocked from normal Open, Preview, Add, and export actions. This protects Nuvio exports from including lists that Trakt or Nuvio cannot load.

## Creating Nuvio JSON

After selecting one or more exportable lists, choose **Create Nuvio JSON**.

The export modal can:

- create one new collection,
- split selected lists into multiple new collections,
- add selected lists to an imported collection,
- choose a destination collection for each selected list,
- copy the generated JSON,
- download the generated JSON.

Copy and Download use the same generated payload for the current export state.

## Existing Nuvio JSON Import

You can upload one or more existing Nuvio JSON files or paste existing JSON.

Imported JSON is preserved as much as possible, including existing community collections, Trakt sources, TMDB sources, artwork, title logos, hero backdrops, focus GIFs, and other collection or folder fields.

Use **Manage files** to review imported sources, see collection and folder counts, remove individual files, or remove pasted JSON. Invalid imported JSON blocks export until it is fixed, removed, or cleared.

## Destination Modes

- **New collection** keeps imported collections and adds selected lists as a new collection alongside them.
- **Split into new collections** groups selected lists into separate generated collections.
- **Add to imported collection** appends selected lists into one imported collection and skips already-existing Trakt lists.
- **Choose destination per list** maps each selected list to an imported collection.

When selected Trakt lists already exist in imported JSON, the export status area explains whether they will be skipped or added again in a separate new collection.

## Artwork Controls

Generated folders can use:

- default poster artwork,
- no cover image,
- a custom cover image URL per folder.

The export modal also supports global folder tile defaults:

- **Landscape** or **Poster** tile shape,
- **Show** or **Hide** folder titles.

Custom cover URLs are written to `coverImageUrl`. The tool does not upload, host, or repair user artwork. Browser previews depend on the image host allowing the browser to load the URL.

## Availability And Export Warnings

The tool checks for broken or unavailable Trakt list records where practical.

- List-specific `404` responses are treated as unavailable or not public.
- Transient likes failures or timeouts do not block otherwise valid lists.
- Some valid numeric Trakt list IDs can export correctly even when Trakt does not provide enough owner/slug data for Open or Preview links.
- Export warnings are shown in the Nuvio modal status area without making a valid export look failed.

## Known Limitations

- Only public/exportable Trakt lists can be used safely.
- Open and Preview depend on route-safe owner and list slug metadata from Trakt.
- Poster previews depend on TMDB metadata and configured TMDB auth.
- Custom image previews depend on browser policy and image host behavior.
- The tool does not upload, host, or cache custom artwork.
- Smart or anticipated Trakt list URLs are not currently supported.

## Developer Setup

This is a static Cloudflare Pages site with Pages Functions under `functions/`.

Required Cloudflare variable:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
```

Optional TMDB auth for poster previews and folder artwork defaults:

```text
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

`TMDB_ACCESS_TOKEN`, `TMDB_API_KEY`, and `TMDB_CLIENT_ID` are also supported by the server code.

Optional API throttle override:

```text
API_RATE_LIMIT_PER_MINUTE=80
```

The browser never receives Trakt or TMDB credentials. Trakt and TMDB calls go through `/api/trakt`.

## Local Testing

The static UI can be opened directly with `index.html`, but API calls need Cloudflare Pages Functions or Wrangler.

For local Cloudflare testing, create a local `.dev.vars` file that is not committed:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

Then run:

```powershell
cd "C:\Users\Dave\Documents\New project 3\trakt-list-lookup"
npx.cmd wrangler@latest pages dev . --port 8158 --ip 127.0.0.1
```

Use `npx.cmd` in Windows PowerShell if `npx` is blocked by execution policy. Run the command from the project directory so Wrangler finds `functions/api/trakt.js`; the startup output should say `Compiled Worker successfully`.

If you do not need posters locally, omit the TMDB value.

## Checks

Run:

```powershell
npm test
npm run check
git diff --check
```

## Deployment

The live site is deployed with Cloudflare Pages from GitHub changes.

Manual deployment, if needed:

```powershell
wrangler pages deploy .
```

## Feedback

Use [GitHub Issues](https://github.com/davecollections/trakt-list-lookup/issues) for bugs, feedback, or feature requests.

Related tool: [TMDB ID Lookup](https://davecollections.github.io/tmdb-id-lookup/)

## Credits And Non-Affiliation

Trakt List Lookup is not affiliated with or endorsed by Trakt or Nuvio.

Poster previews use TMDB metadata where available. This product uses the TMDB API but is not endorsed or certified by TMDB.
