# Trakt List Lookup

Trakt List Lookup helps find public Trakt lists and export selected lists into Nuvio-compatible JSON.

Live site: [https://trakt-list-lookup.pages.dev/](https://trakt-list-lookup.pages.dev/)

## What The Tool Does

- Search public Trakt lists by keyword.
- Look up public lists from a Trakt username.
- Resolve supported Trakt list URLs.
- Resolve direct numeric Trakt list IDs.
- Browse **Popular Lists** and **Trending Lists** using Trakt's native ordering.
- Lazy-load lightweight poster samples in search results.
- Preview the first Trakt item page, up to 50 titles, when a list is opened for preview.
- Select useful lists and create Nuvio-compatible JSON exports.
- Detect whether selected lists contain Movies, Series, or both for Nuvio export.
- Import existing Nuvio JSON and add selected Trakt lists without discarding supported existing data.

## How To Search

The top of the page separates direct search from list discovery.

### Search by

- **Keyword** searches public list titles and descriptions. If the input is only numbers, the tool treats it as a direct Trakt list ID.
- **User** loads public lists from one Trakt user.
- **URL** accepts supported public Trakt list URLs and direct numeric Trakt list IDs.

### Browse lists

- **Popular Lists** loads Trakt's popular public lists.
- **Trending Lists** loads Trakt's currently trending public lists.

Results show the list title, owner where available, Trakt ID, **Titles**, likes, update date, and actions for opening, previewing, and selecting the list.

**Titles** is Trakt's `item_count`. On unusual lists that count can include seasons or episodes as well as movies and shows, so it should not be treated as a guaranteed unique movie/show count.

The creator shortcuts are calculated from the results currently displayed and are labelled **Top creators on this page**.

## Selecting Lists

Use **Select** on any exportable result to add it to your selected lists. Use **Manage selection** to review or remove selected lists before exporting.

The selected-lists panel stays visible even when nothing is selected so the Nuvio export feature remains discoverable. **Create Nuvio JSON** stays disabled until at least one exportable list is selected.

Unavailable, private, deleted, stale, or unverified lists are blocked from selection/export where the tool cannot verify a safe public source.

A valid list with a numeric Trakt ID can still be exportable and previewable even when Trakt does not provide a trustworthy browser-route username. In that case **Open on Trakt** remains disabled rather than guessing a route.

## Creating Nuvio JSON

After selecting one or more exportable lists, choose **Create Nuvio JSON**.

The export modal can:

- create one new collection,
- split selected lists into multiple new collections,
- add selected lists to an imported collection,
- choose a destination collection for each selected list,
- detect Nuvio media type per selected list,
- override media type per selected list,
- configure generated folder artwork and presentation,
- copy the generated JSON,
- download the generated JSON.

Copy and Download use the same generated payload for the current export state.

### Media type

Each selected list defaults to **Automatic**.

Automatic media detection checks the selected Trakt list's numeric ID and determines whether Nuvio should receive:

- one `MOVIE` source,
- one `TV` source,
- or both `MOVIE` and `TV` sources.

Each selected list can instead be overridden to:

- **Both**
- **Movies**
- **Series**

If Automatic cannot determine the media composition safely, the export falls back to both source types and shows a warning rather than silently dropping content.

Generated Trakt sources use the current Nuvio-compatible shape, including numeric `traktListId`, `mediaType`, `sortBy: "rank"`, and `sortHow: "asc"`.

## Existing Nuvio JSON Import

You can upload one or more existing Nuvio JSON files or paste existing JSON.

Imported JSON is preserved as much as possible, including existing community collections, Trakt sources, TMDB sources, artwork, title logos, hero backdrops, focus GIFs, and other collection or folder fields.

Use **Manage files** to review imported sources, see collection and folder counts, remove individual files, or remove pasted JSON. Invalid imported JSON blocks export until it is fixed, removed, or cleared.

When adding to an imported collection, a matching Trakt folder can be reused rather than duplicated. If the existing folder already has one media variant and the selected list needs another, the missing Trakt source can be added while preserving the existing folder's artwork and settings. Exact duplicate sources are skipped.

## Destination Modes

- **New collection** keeps imported collections and adds selected lists as a new collection alongside them.
- **Split into new collections** groups selected lists into separate generated collections.
- **Add to imported collection** adds selected lists into one imported collection, reusing matching Trakt folders where possible and skipping exact duplicate sources.
- **Choose destination per list** maps each selected list to an imported collection.

When selected Trakt lists already exist in imported JSON, the export status area explains whether content is being reused, skipped, upgraded with a missing media source, or added again in a separate new collection.

## Artwork And Display Controls

The export modal attempts to find automatic poster artwork for selected lists where poster metadata is available.

Per selected list, generated folder artwork can use:

- **Default** automatic artwork,
- **None**,
- a **Custom** HTTPS cover image URL.

Generated folders default to:

- **Poster** tile shape,
- **Hide** folder titles.

Users can switch to **Landscape** or **Show** folder titles before export.

Custom cover URLs are written to `coverImageUrl`. The tool does not upload, host, or repair user artwork. Browser previews depend on the image host allowing the browser to load the URL.

### Generated collection defaults

New generated collections currently use:

- `pinToTop: false`
- `viewMode: "TABBED_GRID"`
- `showAllTab: false`
- `focusGlowEnabled: true`

The **Hero/backdrop image URL** field writes to the collection-level `backdropImageUrl`. It remains blank unless the user supplies a value.

## Availability And Preview Behaviour

The tool checks for broken or unavailable Trakt list records where practical.

- List-specific `404` responses are treated as unavailable or not public.
- Valid numeric-ID-only lists can Preview directly by numeric Trakt ID.
- **Open on Trakt** is enabled only when the app has a trustworthy public browser route.
- The full Preview is requested only when clicked and loads one Trakt page, up to 50 items.
- If the complete list fits on that page, Preview reports `Showing X of X titles from this list.`
- If more items exist, Preview reports `Showing the first X titles from this list.`
- Poster images use browser-native lazy loading as the preview is scrolled.

## Known Limitations

- Only public/exportable Trakt lists can be used safely.
- **Open on Trakt** depends on trustworthy owner/list browser-route metadata from Trakt.
- Full Preview is intentionally limited to the first returned Trakt page, up to 50 items.
- Poster previews and automatic folder artwork depend on TMDB metadata and configured TMDB auth.
- Custom image previews depend on browser policy and image-host behaviour.
- The tool does not upload or host custom artwork.
- Smart or anticipated Trakt list URLs are not currently supported.
- Trakt's anticipated/new media feeds are media discovery endpoints rather than public list objects with a stable `traktListId`, so they are not exposed as list-lookup modes.

## Developer Setup

This is a static Cloudflare Pages site with Pages Functions under `functions/`.

Required Cloudflare variable:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
```

The current read-only lookup flow uses the Trakt Client ID. The browser never receives Trakt credentials.

Optional TMDB auth for poster previews and automatic folder artwork:

```text
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

`TMDB_ACCESS_TOKEN`, `TMDB_API_KEY`, and `TMDB_CLIENT_ID` are also supported by the server code.

Optional local API throttle override:

```text
API_RATE_LIMIT_PER_MINUTE=80
```

Trakt and TMDB calls go through `/api/trakt`.

## Local Testing

The static UI can be opened directly with `index.html`, but API calls need Cloudflare Pages Functions or Wrangler.

For local Cloudflare testing, create a local `.dev.vars` file that is not committed:

```text
TRAKT_CLIENT_ID=your_trakt_api_client_id
TMDB_READ_ACCESS_TOKEN=your_tmdb_read_access_token
```

Then run from the repository directory:

```powershell
cd "C:\path\to\trakt-list-lookup"
npx.cmd wrangler@latest pages dev . --port 8158 --ip 127.0.0.1
```

Use `npx.cmd` in Windows PowerShell if `npx` is blocked by execution policy. The Wrangler startup output should say `Compiled Worker successfully`.

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

Public list data is supplied by Trakt. Trakt List Lookup is an independent tool and is not affiliated with or endorsed by Trakt.

Poster previews and automatic folder artwork may use TMDB metadata where available. This product uses the TMDB API but is not endorsed or certified by TMDB.

Trakt List Lookup is an independent community tool for Nuvio collections and is not affiliated with or endorsed by Nuvio.
