# Architecture Guide

How the Sealog Offline Logger is structured, what each module does, and how data flows through it.

Intended for contributors maintaining the application. This guide describes the v1.2.0.9 client; deployment-specific server permissions and schemas are covered by the server's API documentation.

For a working deployment, start with [Installation](INSTALLATION.md). For changing routes, backend addresses, templates, appearance, or icons, use [Customization](CUSTOMIZATION.md). This guide explains the implementation behind those instructions.

---

## Repository layout

```
app.js                     Main application logic - UI state, IndexedDB, GPS, sync, modals
index.html                 Shell document with inline styles + boot scripts
sw.js                      Service worker - offline shell + network-first nav
manifest.webmanifest       PWA manifest
landing.html               Multi-ship landing page
sealog.conf                Reference Nginx reverse proxy configuration for multi-ship deployments

src/
  config/constants.js      CACHE_VERSION, ASNAP defaults, store names, sync states
  db/indexed-db.js         Thin wrapper over IDBDatabase (get/put/del/getAll)
  events/                  Event store, transform, payload + option/server-id helpers
  sync/                    Sync state machine, backoff, ASNAP backfill, debug, status display, scheduling
  sw/                      Service worker path normalization, cache keys, network-first predicate
  runtime/                 GPS/status decisions, event accordions, version state, API root
  templates/               Auto-fill rules + template transforms (categories, coordinates)
  ui/                      DOM visibility helpers + HTML string builders
  utils/                   Identifiers, numbers, timestamps/formatters, strings, async

icons/                     PWA icons (192/512 + apple-touch + sprite)
docs/                      This documentation
scripts/                   Certificate workflow, asset generation, documentation screenshots
tests/                     Unit, DOM, storage/sync integration, and actual-browser E2E coverage
```

No build step. The app loads `index.html` directly; `app.js` is an ES module that imports from `src/`.

---

## Runtime overview

The app is a single-page app rendered entirely client-side.

1. **`index.html`** loads inline CSS, declares the static UI elements used by `app.js`, and contains inline IIFE scripts:
   - **Theme manager** - defines `PRESETS` (light/honey/ocean), reads/writes `localStorage` (`sealog.preset`) and uses each preset’s fixed palette, applies `data-preset` to `<html>`, wraps swap in `document.startViewTransition()` when available, listens to `prefers-color-scheme` changes.
   - **Accordion persistence** - `<details data-section="…">` state stored under `sealog.settings.accordion` in `localStorage`. Data and Theme start open; Auto-fill rules starts closed. Saved choices override these defaults.
   - **Boot** - runs after DOM parse, calls `applyTheme()`, attaches system-theme listener.
2. **`app.js`** runs after parse:
   - Opens IndexedDB and resumes interrupted sync requests via `recoverInterruptedSync()`; current records are read without migration or rewrite.
   - Restores auth state from `localStorage` and fills the signed-in account display through `updateAuthUI()`.
   - Registers the service worker and listens for `SW_STATE` / `SW_UPDATE_READY` messages.
   - Wires all event listeners - capture, sync, export, edit, filter, modal opens, visibility changes.
   - Renders the event list, status strip, settings, modals.
   - Owns account/diagnostic dialog events and shared scroll locking; there is no global UI controller API.
3. **`sw.js`** registers as a module worker, imports shared cache helpers, and precaches the complete app shell and imported modules on install with HTTP cache bypass, then activates and claims clients. Fetches use network-first for navigations and JavaScript source assets, with cached responses for offline use; other static assets use cache-first. Activation broadcasts `SW_STATE` and, for an update, `SW_UPDATE_READY`.

Worker registration runs only under `/sealog-a/`, `/sealog-b/`, or `/sealog-c/`. A simple server opened at `/index.html` is a UI preview and does not exercise offline installation. The prefixed Playwright server covers the actual worker lifecycle, and `docker compose up --build` (see the repository [README](../README.md#development)) gives a local, manually-driven equivalent under `http://localhost:8080/sealog-a/`.

The worker handles same-origin GET requests and bypasses normalized `/sealog-server/` API paths. It does not upload events or run GPS capture. Those tasks run in the open page. JavaScript network fetches use `cache: 'no-store'`; offline fallback is triggered by a failed fetch, not an HTTP error response. A server returning HTML or a 404 for a missing JavaScript file must be fixed at deployment time.

Installation precaches the shell under **all** configured prefixes, not just the route being opened. Keep the routes in `sealog.conf`, `docker/nginx.conf`, `src/config/constants.js`, `sw.js`, and `landing.html` coordinated. `docker/nginx.conf` is a stripped-down copy of `sealog.conf`'s routing for local Docker use (no TLS, no production upstreams) rather than something generated from it, so a route added to one will not automatically appear in the other. All listed resources must be served successfully for installation to complete. See [route customization](CUSTOMIZATION.md).

By default, API calls use `/sealog-server/...` under the active deployment prefix. In the reference deployment, Nginx (`sealog.conf`) accepts those requests over HTTPS and proxies them to an HTTP Sealog backend. An explicit HTTPS API root can point to another server; cross-origin access requires compatible CORS. See [deployment choices and constraints](MANUAL_UPDATE.md#when-existing-https-can-simplify-installation).

---

## Multi-Ship Deployment Topology

The supplied `sealog.conf` is a reference layout for three backend instances behind one Nginx reverse proxy. Its documentation-range IP addresses must be replaced before use:

- `/sealog-a/` → Deployment A (`sealog_a_upstream` on port 8000)
- `/sealog-b/` → Deployment B (`sealog_b_upstream` on port 8100)
- `/sealog-c/` → Deployment C (`sealog_c_upstream` on port 8200)

`landing.html` directs operators to their deployment endpoint. Deployment A, B, and C are generic sample labels; customize them and their routes for the installation.

The reference proxy provides a secure browser origin for the app and keeps browser API requests on HTTPS while forwarding them to HTTP backends. Another host can replace Nginx when it provides equivalent HTTPS and routing. The worker precaches root assets and all three prefixed static aliases using `cache.addAll`, so a replacement host must preserve that layout or the app and worker need coordinated changes. Cross-origin requests bypass the worker. A different same-origin API path requires updating its normalized `/sealog-server/` bypass so API GET responses are not handled as static assets. The [HTTPS deployment review](HTTPS_DEPLOYMENT_REVIEW.md) traces these requirements to source.

**Vessel telemetry API resolution:** `buildAsnapVesselApiRootCandidates` in `src/runtime/api-root.js` tries an explicit `asnapVesselApiRoot` override first, then derives candidates using the Deployment A path and port 8000 before retaining the original root as a fallback. Absolute API ports from 8100 through 8999 map to 8000.

These paths select backend routes; they do not isolate browser data. On one origin, all paths share the same IndexedDB database, localStorage, and versioned app cache. Use separate origins or browser profiles when deployments need separate local queues and credentials.

---

## Data model

### IndexedDB stores

| Store | Purpose | Key |
|---|---|---|
| `events` | Local event queue + cache | `client_uuid` (also stored as `localId`) |
| `meta` | Cruise/template state, housekeeping flags | `k` (string key) |
| `templates` | Cached server template payloads | `id` |

The database is named `sealog-offline`, schema version 3.

**Meta store keys (`meta`):**

- `META_CURRENT_CRUISE_ID` (`currentCruiseId`) - active cruise identifier.
- `META_CURRENT_CRUISE_START` (`currentCruiseStartUTC`) - active cruise start ISO timestamp.
- `META_CURRENT_CRUISE_STOP` (`currentCruiseStopUTC`) - active cruise end ISO timestamp.
- `META_LAST_TEMPLATE_SYNC` (`lastTemplateSync`) - timestamp of last template refresh.

### Event record shape

Local events use one current record format; obsolete field aliases are neither read nor written. `client_uuid` remains the IndexedDB primary key. `syncEventPayload()` keeps notes, options, coordinates, timestamps, and identifiers consistent between the top-level record and its nested `payload`. The wire request is built separately by `buildPostBody` or `buildPatchBody`.

Key fields:

- `localId` / `client_uuid` - primary key. Generated via `crypto.getRandomValues` + a time prefix.
- `serverId` - assigned by Sealog after a successful POST.
- `payload` - local rich JSON object (utc, lat/lon/acc_m, notes, client_uuid, options map) kept in IndexedDB for payload synchronization and CSV export. This is NOT the wire `event_free_text`: `buildPostBody` sends `event_free_text` as the plain operator note and puts coordinates, `client_uuid`, and template fields in `event_options`, with the timestamp in the top-level `ts`.
- `option_values` - array of `{ event_option_name, event_option_value }` pairs.
- `syncState` - finite state machine: `unsynced`, `syncing`, `synced`, `verify-pending`, `verify-failed`, `patch-pending`, `patching`, `patch-failed`.
- `revisions` - local audit trail array storing edit history (`atUTC`, `editorUserId`, `changes`).
- `attemptCount` / `nextAttemptMs` - sync retry tracking with exponential backoff.
- `backfillHoldCount` - hold counter for events waiting on ASNAP interpolation context (prevents conflating hold touches with server attempts).
- `verifyAttemptCount` / `verifyNextAttemptMs` - verification loop retry tracking.
- `originalTimestampUTC` - original timestamp when logged prior to any edits.
- `isAsnap` / `type` - identify automated ASNAP captures and gate edit/delete.

### Capture, upload, and confirmation

Capture writes the event to IndexedDB before scheduling an upload. `syncAll()` processes eligible records in creation order, honors scheduled retries unless invoked manually, and requires a stored JWT plus an online browser. Backfill requirements are resolved before a server write.

| State or condition | Next action |
|---|---|
| `unsynced`, no server ID | Look up the exact `client_uuid` through a `fulltext` query; POST only after a successful lookup finds no record. |
| `patch-pending` / `patch-failed`, server ID known | PATCH that server ID. |
| POST succeeds without `insertedId`, or returns 409 | Preserve the event as `verify-pending` and look up the UUID again. |
| Exactly one matching server record | Save its ID, queue any newer local changes for PATCH, and complete required auxiliary uploads before marking synced. |
| Verification returns no match or fails | Retry with a delay; after six verification attempts, enter `verify-failed`. Multiple exact matches enter that state immediately. |
| Page closes during `syncing` / `patching` | Startup requeues the interrupted record according to whether its server ID is known. |

The main Sync button also retries failed verification. Explicit re-post is a separate confirmed action. Preflight, confirmation, and editing during an in-flight request are covered by the [browser tests](TESTING.md#browser); the request contract is in [SPECIFICATION.md](SPECIFICATION.md#query-events--deduplication-preflight).

### Local storage

| Key | Used for |
|---|---|
| `jwt`, `userId`, `username` | Auth state |
| `apiRoot` | Backend API root override |
| `asnapVesselApiRoot` | Vessel telemetry API root override |
| `sealog.preset` | Active theme preset (`light` / `honey` / `ocean`), including its fixed accent colors |
| `sealog.settings.accordion` | Open/closed state for Settings accordions |
| `templateAutoFillRules` | Per-template auto-fill rules |
| `asnapAllowPoorAccuracy` | Universal device GPS accuracy override, controlled from the GPS dialog; the existing key retains saved choices |
| `asnapEnabled`, `asnapShowInList` | ASNAP capture and display switches |
| `asnapIntervalMs`, `asnapLastCaptureMs` | ASNAP scheduling state |
| `asnapBackfillEnabled`, `asnapBackfillAllowlist` | Backfill switch and event/template allowlist |
| `asnapBackfillDebugSnapshot` | Latest backfill diagnostic snapshot |

Theme values are preset IDs, not stored CSS colors. The app uses each preset's fixed palette; there is no separate accent preference. Missing or unsupported presets follow the operating-system theme in the app (Light or Ocean); the landing page defaults to Light. The current client does not migrate retired preference keys or obsolete event formats.

---

## UI

### DOM map

The top of `app.js` caches frequently used elements in `dom`. Dynamic event cards and option fields use scoped queries and delegated handlers; category/type selects are rebuilt by `initCaptureSelects`.

### Device GPS capture policy

The GPS dialog's `gpsAllowPoorToggle` controls a shared policy for recording new device GPS: manual event capture, auto-fill into empty GPS fields on edit, and automatic ASNAP capture. The preference is independent of sign-in and network state. With the override disabled, accuracy must be 50 metres or better; enabling it relaxes only this accuracy limit. Missing fixes, invalid coordinates, unknown accuracy, and fixes older than five minutes remain invalid.

An enabled override produces a persistent warning on the capture page and in the GPS dialog, including when the current fix is accurate. With the override off, a fix exceeding 50 metres produces guidance that recording new device GPS is blocked. The event editor shows the applicable warning when empty GPS auto-fill fields need a new fix. Notes-only captures and edits retaining saved GPS do not require a new fix, and server-derived ASNAP backfill coordinates are outside this device GPS policy.

### Mobile Interaction & Viewport Tracking

1. `blurActiveSelectBeforeInteraction`: Listens for `pointerdown`/`touchstart` and explicitly blurs active `<select>` elements to immediately close native iOS wheel pickers when buttons are tapped.
2. `attachModalViewportSync`: Listens to `window.visualViewport` scroll/resize events, updating `--modal-vvh` and `--modal-vv-top` on `:root` to keep modal overlays locked to the visible viewport when soft keyboards or pinch-zooming occur.
3. `applyModalViewportMetrics` defers viewport reads and CSS-variable updates to `requestAnimationFrame`. Initial modal opening reads metrics before locking body scroll.

### Event Revisions & CSV Export Schema

**Event Revisions Audit Trail:**
When `handleEventEditorSubmit` saves changed values, it appends a revision to `event.revisions`:
```json
{
  "atUTC": "2026-08-26T12:00:00.000Z",
  "editorUserId": "example-user-id",
  "changes": {
    "notes": "Updated note text",
    "options": { "Station": "ST-12" }
  }
}
```

**CSV Export Schema:**
`exportCsv()` downloads the following columns from the local event store:
`localId`, `serverId`, `type`, `eventTemplateId`, `eventTemplateName`, `eventTimestampUTC`, `originalTimestampUTC`, `lat`, `lon`, `acc_m`, `notes`, `syncState`, `attemptCount`, `nextAttemptMs`, `verifyAttemptCount`, `verifyNextAttemptMs`, `lastError`, `lastSyncUTC`, `revisions`, `payload`.

`payload` contains the rich event JSON, including the options map; `revisions` contains the revision array. The exporter quotes each data cell, doubles embedded quotes, and separates records with CRLF; the header is unquoted. Nested payload/revision values are serialized as JSON inside those CSV cells. It exports all local records to `sealog_offline_export.csv`, independent of the current list filter. CSV export does not provide an application restore/import path.

---

## ASNAP Backfill & Auxiliary Data Pipeline

Backfill is opt-in. A missing allowlist is initialized to `OBSERVATION` and `SCIENCE`. Saved choices are preserved across reloads: an explicitly blank/whitespace list matches all eligible event types; a nonempty list matches event value or template ID case-insensitively. Eligible non-ASNAP events wait for both vehicle and vessel position context before upload:

1. **Lowering resolution:** Queries `GET /api/v1/lowerings` and selects a lowering using its current time window via `selectCurrentLowering`.
2. **Dual-Track Interpolation:**
   - **`vehiclePosition`**: Interpolated from lowering vehicle aux data (`/api/v1/event_aux_data/bylowering/{id}?datasource=vehiclePosition`) and lowering ASNAP events.
   - **`vesselPosition`**: Interpolated from cruise vessel aux data (`/api/v1/event_aux_data/bycruise/{id}?datasource=vesselPosition`) and vessel ASNAP events.
3. **Fallback time window:** Missing or unusable lowering context can trigger a timestamp-window lookup. `computeAsnapFallbackWindow` pads the pending-event range by two hours and clamps it to known cruise bounds; without event bounds it uses cruise times or a recent window.
4. **Auxiliary upload:** After a server event ID is obtained, `uploadBackfilledAuxDataIfNeeded` posts normalized entries to `/api/v1/event_aux_data` before the event is marked fully synced.
5. **Upload schema:** `buildEventAuxUploadPayload` sends the current Sealog fields `event_id`, `data_source`, and `data_array`. Failed uploads remain retryable; alternate server schemas are unsupported.

Missing surrounding points hold the event locally with a backfill warning and retry time. `backfillHoldCount` records these holds separately from upload attempts. Local automated ASNAP capture is separate: it uses page timers, requires sign-in, and applies the shared device GPS capture policy above. It is not a service-worker background task; background timer suspension can interrupt its cadence.

Automatic ASNAP capture starts disabled. Its default interval is five minutes, adjustable from one to thirty minutes; the shared device GPS accuracy threshold is 50 metres. These constants are in [`src/config/constants.js`](../src/config/constants.js), while saved operator choices are read in `app.js`.

### Telemetry & Debugging System

`app.js` assembles snapshots; `src/sync/asnap-debug.js` provides forwarding helpers.

- The latest snapshot is stored as `asnapBackfillDebugSnapshot` in localStorage and exposed as `window.__asnapBackfillDebug` for inspection.
- `postAsnapBackfillDebugSnapshot` trims each sample's head and tail to eight rows and posts to `/<deployment-prefix>/debug/asnap-backfill` with a four-second timeout. After a successful HTTP response, the same signature is suppressed for 15 seconds; this applies to both successful and failed context snapshots. Changed signatures may post sooner. Failed forwarding does not suppress the next attempt or stop event sync.
- The reference Nginx configuration defines a request-body access log at `/var/log/nginx/sealog-asnap-backfill-snapshot.log` and returns 204 for the snapshot POST; this is a local diagnostic sink, not a Sealog API endpoint. Verify the contents of the log on the installed server before relying on it for diagnosis.

---

## Template Auto-Fill Rule System

Rules live in `localStorage` under `templateAutoFillRules`:

```json
{
  "<templateId>": {
    "_label": "CTD Start",
    "_lastSeenEventValue": "CTD_START",
    "_seededDefaults": true,
    "log": { "station": { "source": "now_utc" } },
    "edit": {}
  }
}
```

- When templates load from IndexedDB, the server, or built-in fallbacks, `seedDefaultAutoFillRules` creates on-log GPS rules only if no saved configuration matches. Latitude, longitude, and configurable accuracy names are inferred; system-managed fields are excluded. The rules are effective before the capture form is built.
- `findTemplateEntry` prefers the template ID, then compares `_lastSeenEventValue` case-insensitively after trimming. Both runtime resolution and the rules modal use this lookup.
- Every existing entry is authoritative, including partial rules, edit-only rules, and empty entries representing explicit None choices. Initialization does not add missing rules to a saved configuration. `_seededDefaults` remains stored metadata; preservation does not depend on its presence.
- The modal edits a separate draft. Save persists it and rebuilds the active capture form immediately, preserving unrelated input state; Cancel discards the draft. Save also initializes any new template that arrived during a background refresh.
- Sources are `now_utc`, `lat`, `lon`, and `acc`. A field can use on-log or on-edit mode; the UI saves one mode per field, and rules always fill only empty fields. Retired rule sources are ignored; stored rules are not migrated.
- `renderAutoFillStaleNotice` flags rules for absent fields. They remain saved in case those fields return, and cannot match the current template while absent.

---

## Maintenance tools and diagnostics

### Nginx diagnostic logs

The reference configuration enables request metadata, event/auxiliary request-body logs, and the snapshot sink:

```bash
sudo tail -f /var/log/nginx/sealog-sync-meta.log /var/log/nginx/sealog-sync-events-body.log
sudo tail -f /var/log/nginx/sealog-asnap-backfill-snapshot.log
```

A snapshot with `status:"ok"` describes loaded context; it does not prove that an individual event has surrounding vehicle and vessel points. Check `counts.mergedPoints`, `counts.vesselPoints`, their time ranges, and the event's local backfill warning. `mergedPointSummary.withDepthCount` identifies samples containing depth. Error reasons such as `insufficient-points`, `event-aux-…`, or `fallback-window-…` identify the failed lookup or interpolation context.

The body logs include operator notes, event payloads, and telemetry. Restrict access and retention under your deployment's logging policy; see [SECURITY.md](SECURITY.md).

### Script reference

Run these tools from a workstation checkout. They support certificate setup, app assets, documentation, and tests.

| Script | Purpose | Invocation / required inputs |
|---|---|---|
| `scripts/generate_cert_chain.py` | Generates a private CA root, server certificate/key, and full chain from JSON configuration. | `python3 scripts/generate_cert_chain.py -c certs/private-ca/cert-config.json`; see [certificate instructions](cert-generation.md). |
| `scripts/sync-app-icons.mjs` | Generates `icons/app-icon.svg`, five app/touch-icon and favicon PNGs, and `favicon.ico` from Phosphor's `list` glyph. | `node scripts/sync-app-icons.mjs` after installing Playwright Chromium; append `--check` to verify generated files. See [TESTING.md](TESTING.md). |
| `scripts/sync-phosphor-icons.mjs` | Generates sprite, masks, and carets from the pinned official Phosphor sources. | `npm run icons:sync`; verify with `npm run icons:check`. |
| `scripts/screenshot-app.mjs`, `scripts/screenshot-autofill-modal.mjs` | Playwright screenshot capture for documentation. | Run the corresponding script with Node after installing Chromium. |

---

## Testing

See [`TESTING.md`](./TESTING.md). Layered suite:

- Unit, integration, and DOM tests run via Node test runner and Vitest + happy-dom.
- Playwright E2E specs exercise appearance, worker/offline sync, landing navigation, real auto-fill capture/edit, and server import/deduplication.

---

## Further reading

- [`SPECIFICATION.md`](./SPECIFICATION.md) - Sealog Server API contract.
- [`INSTALLATION.md`](./INSTALLATION.md) - Host requirements, static files, and initial installation.
- [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) - Coordinated route, template, theme, and icon changes.
- [`HTTPS_DEPLOYMENT_REVIEW.md`](./HTTPS_DEPLOYMENT_REVIEW.md) - HTTPS hosting, proxy alternatives, and route constraints.
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) - Operator-facing troubleshooting.
- [`QA_PLAN.md`](./QA_PLAN.md) - Field test matrix.
- [`SECURITY.md`](./SECURITY.md) - Storage, sessions, and deployment security.
