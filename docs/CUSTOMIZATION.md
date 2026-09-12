# Customize your deployment

The app is static HTML, CSS, and JavaScript. There is no build step, `.env` loader,
or single deployment JSON file. Server routing lives in [`sealog.conf`](../sealog.conf),
certificate inputs live in a local JSON file, and interface changes are made in
the source files listed below. This guide describes **v1.2.0.9**.

For a new installation, make your choices here, then follow
[Install the application](INSTALLATION.md). Use a separate test browser profile
when changing routes or backends so existing queued events stay with their
intended server.

## Decide the address and backend first

Write down these values before editing files:

| Choice | Example | Where it is used |
|---|---|---|
| Operator-facing DNS name | `logs.example.test` | DNS, both nginx `server_name` directives, certificate DNS SAN, device bookmark |
| Operator-facing IP | `10.0.0.10` | Network configuration; certificate IP SAN if devices open this address directly |
| App path | `/sealog-a/` | Landing link, nginx locations, app prefix list, worker prefix list |
| Backend address and port | `10.0.0.20:8000` | nginx upstream and upstream `Host` header |
| Backend URL prefix | `/sealog-server/` | nginx `proxy_pass`; browser API root defaults to `/sealog-server` |
| Static directory | `/srv/sealog-offline` | nginx `root` and `alias` paths, installation commands |
| TLS file prefix | `sealog` | Certificate JSON `file_prefix`, nginx certificate/key paths |
| Visible deployment name | `Research Vessel` | Landing page card text |

These are examples, not working public services. Configure DNS on the network
used by logging devices. A hosts-file entry on your workstation does not configure
the phones. Use the same hostname, scheme, and port for everyday access: changing
any of them selects different browser storage.

### Storage is shared within an origin

The three supplied paths share IndexedDB, templates, login credentials,
preferences, and app caches on the same origin. Selecting a different landing
card changes API routing; it does **not** select an isolated event database.
Signing out also leaves local events in place.

For independent vessel queues, use separate HTTPS origins, such as different
hostnames, or managed separate browser profiles. Do not switch a device with
pending events to another backend. Finish syncing to the original backend and
plan any data transition first. A CSV export is useful for review, but the app
does not include CSV import or a full browser-database restore tool.

## Configure one backend without changing app paths

The reference configuration has three deployment slots. The landing page labels
Deployment A, Deployment B, and Deployment C and the routes below are generic
examples. Replace the labels with names meaningful to your operators; route
changes also require the coordinated updates described in the next section.

| App route | nginx upstream | Example port |
|---|---|---|
| `/sealog-a/` | `sealog_a_upstream` | `8000` |
| `/sealog-b/` | `sealog_b_upstream` | `8100` |
| `/sealog-c/` | `sealog_c_upstream` | `8200` |

For a single backend, you can keep the supported URLs, point all three upstreams
and their `proxy_set_header Host` values at that same backend, and show only one
card in `landing.html`. Rename the visible card to your vessel name. Keep the
static route blocks for all three paths: the worker precaches assets through
every path in its prefix list, even when a card is hidden.

For multiple backends, set each upstream and corresponding `Host` header to the
correct address. See the storage limitation above before assigning devices.

The browser at `/sealog-a/` requests
`/sealog-a/sealog-server/api/v1/...`. The supplied proxy converts this to
`/sealog-server/api/v1/...` on the upstream. If your backend serves `/api/v1/...`
at its root instead, change that location's `proxy_pass` URI to `/`:

```nginx
location ^~ /sealog-a/sealog-server/ {
  proxy_pass http://sealog_a_upstream/;
  # Keep the proxy_set_header directives from the reference configuration.
}
```

This is a replacement for the existing location, not an additional duplicate.
The trailing slash controls URI replacement. Check a read-only API request
through the proxy before signing in. See nginx's
[proxy_pass documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)
for the URI replacement rules.

## Rename, add, or remove deployment paths

For an existing installation, coordinate path changes with the nginx
configuration, app and worker prefix lists, telemetry routing, stored API
overrides, and operator bookmarks or installed shortcuts. Sync pending events
to their intended backend first. After deploying, open the new address while
online and verify offline reopening before operators use it in the field.
Changing a path on the same origin does not create a separate local data store.

Keeping the supplied paths needs fewer edits. If you want a custom path such as
`/sealog-vessel/`, update all of the following together:

| File | Change |
|---|---|
| [`src/config/constants.js`](../src/config/constants.js) | Set `SUPPORTED_PATH_PREFIXES` to the supported first path segments, without leading/trailing slashes; for one route use `['sealog-vessel']`. |
| [`sw.js`](../sw.js) | Set `PATH_PREFIXES` to matching paths with a leading slash, such as `['/sealog-vessel']`. |
| [`landing.html`](../landing.html) | Update card `href` values, display names, and path labels; remove unused cards. |
| [`sealog.conf`](../sealog.conf) | Update the slash redirect, app alias, API location, worker location and `Service-Worker-Allowed` scope, debug location, and log-map expressions for each route. |
| [`src/runtime/api-root.js`](../src/runtime/api-root.js) | Review the separate ASNAP vessel-position routing described below. |
| [`tests/`](../tests/) and screenshot scripts | Update affected URL fixtures, static-server prefix stripping, route assertions, and screenshots. |

Use a single path segment beginning with `sealog-` for the documented pattern.
Arbitrary nested paths and serving the installed app at `/` need additional code
changes: the app only registers its worker when its first path segment is in
`SUPPORTED_PATH_PREFIXES`. A working root-page preview does not prove offline
installation works.

The manifest already uses relative `start_url: "./index.html"` and `scope: "./"`.
Keep those relative values when serving one shared manifest at each route.
Root-level `/icons/` and `/favicon.ico` URLs must remain available, along with
unprefixed app assets: `sw.js` precaches the unprefixed assets as well as each
supported route. Removing an nginx route without removing it from the worker's
prefix list can prevent worker installation. An HTML fallback with status 200
can also disguise a missing JavaScript file; verify MIME types and content.

Find route-dependent code before and after your edits:

The command uses [ripgrep](https://github.com/BurntSushi/ripgrep); if it is not
installed, use your editor's project-wide search for the same identifiers.

```bash
rg -n 'sealog-(a|b|c)|SUPPORTED_PATH_PREFIX|PATH_PREFIXES' \
  app.js src sw.js index.html landing.html manifest.webmanifest \
  sealog.conf scripts tests docs
```

Run the checks in [Testing](TESTING.md), then perform the browser/offline checks
in [Installation](INSTALLATION.md#verify-from-a-device). Automated tests use
their own HTTP servers; they do not validate your deployed nginx configuration.

### ASNAP vessel-position routing

ASNAP **backfill** can read position data from a different Sealog instance than
the event destination. `buildAsnapVesselApiRootCandidates()` in
`src/runtime/api-root.js` currently tries the `/sealog-a/sealog-server` route
and maps absolute backend ports `8100` through `8999` to `8000`, as well as trying
the current API root. These are reference deployment assumptions, not discovered
server settings. Review them when renaming routes or using other backend ports.

For an administrator-controlled browser override, set the full HTTPS root of
the intended position API in the console on the app's origin, then reload:

```javascript
localStorage.setItem('asnapVesselApiRoot', 'https://logs.example.test/sealog-a/sealog-server');
location.reload();
```

The override is tried first; it does not disable the other fallback candidates.
For a deployment-wide change or strict choice of a single source, update the
candidate builder and its tests. The position service must accept the user's
token and expose the endpoints described in the [API specification](SPECIFICATION.md).
Clear a temporary override with
`localStorage.removeItem('asnapVesselApiRoot')` and reload.

## Override the event API only when needed

Same-origin nginx routing works with the default settings and needs no browser
override. The API root is resolved in this order:

1. Browser `localStorage.apiRoot`.
2. `window.API_ROOT`, if defined before the app module executes.
3. `DEFAULT_API_ROOT` in `src/config/constants.js`.

The app appends `/api/v1/...`; an override must stop **before** `/api/v1`.
`/sealog-server` is expanded under the active supported app prefix. Use a full
HTTPS URL when you need an unambiguous absolute destination:

```javascript
// Run in the app origin's browser console, using your actual API root.
localStorage.setItem('apiRoot', 'https://logs.example.test/sealog-a/sealog-server');
location.reload();
```

This persists across reloads and sign-out and applies to all app paths sharing
that browser origin. Remove a test override before returning to normal routing:

```javascript
localStorage.removeItem('apiRoot');
location.reload();
```

A deployment-wide `window.API_ROOT` can be assigned in an inline script before
`<script src="app.js" type="module"></script>` in `index.html`. A stored override
still wins. There is no API URL field in Settings. A different-origin backend
needs its own trusted HTTPS certificate and CORS support for the app origin,
Authorization header, and required methods; configure this on that backend.
Plain HTTP backends behind the HTTPS nginx proxy do not need browser CORS.

Keep the browser-facing API suffix `/sealog-server/` when possible. The worker
excludes that normalized path from caching. If you introduce a different
same-origin API path, update the exclusion in `sw.js` and verify authenticated
GET responses are never stored as static assets. Event and position API requests
use the saved bearer token, so both destinations must be trusted.

## Change application names, colors, and icons

| Customization | Files to edit |
|---|---|
| Browser title and main heading | `index.html`: `<title>`, visible `<h1>`, and `apple-mobile-web-app-title` |
| Installed-app label and description | `manifest.webmanifest`: `name`, `short_name`, `description` |
| Landing title and vessel cards | `landing.html`: `<title>`, heading, card labels and links |
| Light/Honey/Ocean colors | CSS preset variables in `index.html` and `landing.html`; keep `index.html`'s `PRESETS`, `landing.html`'s `PRESET_BG`, and HTML/manifest theme colors consistent |
| Generated app icon colors | SVG wrapper in `scripts/sync-app-icons.mjs`: currently white glyph on teal `#0f766e` |
| Browser and installed icons | Generated files under `icons/` and root `favicon.ico`; links in `index.html`, `landing.html`, `manifest.webmanifest`, and `sw.js` |

The theme IDs `light`, `honey`, and `ocean` are saved preferences. Change display
names/colors without renaming those IDs unless you also plan the stored-preference
behavior and update the tests. Palette changes should preserve readable text,
status distinctions, and reduced-motion behavior.

Install the development dependencies and Chromium as described in [Testing](TESTING.md).
After changing the app-icon generator, run:

```bash
node scripts/sync-app-icons.mjs
node scripts/sync-app-icons.mjs --check
npm run icons:check
```

`icons/app-icon.svg` and the PNG/ICO files are outputs; editing them alone is
overwritten by regeneration. The generator verifies the vendored Phosphor source
hashes. To use your own artwork, adapt the generator deliberately and update its
source/provenance checks and [third-party notices](../THIRD_PARTY_NOTICES.md) as
appropriate. Keep the existing Phosphor notices for the UI glyphs still in use.

After changing icon bytes, replace the `?v=sealog-1` asset revision consistently
in `index.html`, `landing.html`, `manifest.webmanifest`, and `sw.js` so the proxy's
long-lived icon cache does not keep the old artwork. This asset revision is
separate from the app version. Installed launchers can retain their own icon
copies; verify on the target devices without uninstalling apps holding unsynced data.

## Customize event templates and defaults

Manage normal event types, categories, labels, required fields, and choice lists
in Sealog Server using its administration tools. Then sign in and use
**Settings → Data → Refresh Templates** on each device. The repository does not
include the backend, an account provisioner, or a template administration UI.
See the [API specification](SPECIFICATION.md) for the template shape this client reads.

`FALLBACK_TEMPLATES` near the top of `app.js` supplies the offline starter templates.
Edit that array only if you want different fallback choices; it does not update
server templates. Changes to server templates do not rewrite existing events.

Operators configure field sources in **Settings → Auto-fill rules → Manage rules…**.
Those choices are local to the browser, not published back to the server.
Recognized GPS names can receive initial On log defaults; saved choices take
precedence. See [Quick Start](QUICK_START.md#auto-fill-rules) for exact behavior.

Timing and accuracy defaults are in `src/config/constants.js`. ASNAP preference
keys and the initial backfill allowlist (`OBSERVATION`, `SCIENCE`) are in `app.js`.
Changing an initial default does not replace preferences already saved on devices.
Use the ASNAP dialog for each device's logging interval and backfill configuration.
Changing an event value or wire-format field name requires checking the server
contract, not just changing its visible label.

## Prepare the customized app for installation

Keep **v1.2.0.9** for this release; documentation or initial deployment configuration
does not require a version increment. Future application releases should follow
[Release](RELEASE.md) so app and worker versions stay aligned. Never rename the
IndexedDB database or storage keys as a cosmetic branding change: existing device
data would no longer be found under the new names.

Review the customized files, run the relevant [checks](TESTING.md), and follow
[Installation](INSTALLATION.md). Keep local certificates, their JSON configuration,
private keys, tests, and development tools out of the static deployment bundle.
