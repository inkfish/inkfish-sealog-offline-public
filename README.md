# Sealog Offline Logger

An iPhone-first web app for logging research-vessel events with UTC timestamps, template fields, notes, and GPS coordinates. Capture events offline and sync them to a Sealog Server when connectivity returns.

**Sign-in and synchronization require a separately deployed [Sealog Server](https://github.com/OceanDataTools/sealog-server).** The server also supplies accounts and templates. After the app has loaded, you can capture ordinary events while signed out and offline; sign in while connected to sync them.

Open it on the ship network and add it to your Home Screen. Events remain on the device until you sync them; synced records stay available for offline review until you clear them through Settings. Templates with GPS auto-fill need a usable location fix when you log an event.

**Current version:** `v1.2.0.9`

[Quick Start](docs/QUICK_START.md) · [Installation](docs/INSTALLATION.md) · [Customization](docs/CUSTOMIZATION.md) · [Documentation](docs/README.md)

---

## What it looks like

Screenshots use demonstration data.

| Capture screen | GPS diagnostic | Update prompt |
|---|---|---|
| ![Capture screen with mixed sync states](docs/screenshots/01-capture-screen.png) | ![GPS diagnostic modal](docs/screenshots/04-gps-modal.png) | ![Centered update modal](docs/screenshots/07-update-modal.png) |
| **Theme picker** | **ASNAP modal** | **Event detail** |
| ![Settings drawer - Theme accordion](docs/screenshots/02-settings-theme.png) | ![ASNAP modal with backfill controls](docs/screenshots/05-asnap-modal.png) | ![Expanded event detail card](docs/screenshots/06-event-detail.png) |
| **Auto-fill rules** | **Auto-fill - GPS fields** | **Sign-in** |
| ![Auto-fill rules with Time In set to Current time on log](docs/screenshots/11-autofill-rules.png) | ![Latitude, Longitude, and Device Accuracy set to fill from GPS on log](docs/screenshots/11-autofill-rules-gps.png) | ![Sign-in screen with username, password, and Continue as guest](docs/screenshots/08-signin.png) |

---

## What it does

- **Capture offline.** Log events without a server connection. The app retains pending records and keeps synced records for review. **Settings → Data → Clear Cached Events…** removes only synced records.
- **Use server templates.** Templates provide event types, required fields, and choices. Cached templates work offline; built-in CTD and note templates are available when no server templates are loaded.
- **Auto-fill fields.** Use **Settings → Auto-fill rules → Manage rules…** to fill a field from the current time or GPS when logging or editing. New template configurations get **On log** defaults for recognized GPS field names, such as Latitude and Longitude. Saved choices, including **—** (no source) and edit-only rules, are preserved. **Save** applies changes immediately; edit rules fill only empty fields.
- **Control GPS accuracy.** The GPS dialog's **Allow logging when GPS accuracy is poor** setting applies whenever device GPS is used for manual capture, GPS auto-fill, or ASNAP. Accuracy must be 50 metres or better unless the override is enabled, which displays a persistent warning. Missing or invalid fixes, unknown accuracy, and fixes older than five minutes are always rejected.
- **Review and edit.** Expand an event card to see its details. Edit ordinary events before or after syncing; synced edits are sent on the next sync. Automated ASNAP records are read-only on the device.
- **Sync and import.** Sync runs automatically when possible, with retries for failed requests. **Sync queued events** starts a manual attempt; **Load Sealog Events** retrieves records from the active cruise.
- **Record automated GPS snapshots.** Optional ASNAP logging captures positions at a chosen interval while signed in and applies the shared GPS accuracy policy. Keep the app open for reliable interval logging.
- **Use server positions.** Optional ASNAP backfill fills coordinates for selected event types from surrounding server position records. Affected uploads wait when the required position data is unavailable.
- **Export CSV.** Download the events stored on the current device for review or IT support.

## Look and feel

- **Three themes:** Light, Honey, and Ocean. Until you choose one, the app follows the device's light or dark preference. Each preset includes its fixed accent colors; only the preset is saved. Theme changes animate when the browser supports it and reduced motion is off.
- **Status strip:** network availability, GPS, ASNAP, and queue counts. Tap GPS or ASNAP for details. The Sealog tile reflects the device's network status; check the sync message to confirm communication with the server.
- **Settings:** account, data tools, auto-fill rules, themes, and app/worker versions. ASNAP and backfill controls open from the ASNAP status tile.

## Getting started

Operators: use the HTTPS address supplied by your ship's IT team and follow the [Quick Start](docs/QUICK_START.md). Keep that same address when reopening the app so you return to the device's saved records.

On an iPhone or iPad using the deployment's private CA, first follow [certificate installation and full trust](docs/IOS_CERTIFICATE_SETUP.md), unless IT has already configured device trust.

Administrators: start with [Install the application](docs/INSTALLATION.md), the complete workstation-to-device walkthrough. It covers prerequisites, certificate installation, static files, nginx, backend routing, and acceptance checks. There is no application build step or automated server installer.

1. [Customize your deployment](docs/CUSTOMIZATION.md): choose names, addresses, backend routes, icons, themes, and template defaults.
2. [Generate certificates](docs/cert-generation.md), if using a new private CA: configure DNS/IP names, generate and verify the bundle, and establish device trust.
3. [Install and verify](docs/INSTALLATION.md): configure the web server, copy the runtime files, and test a device online and offline.
4. For subsequent deployments, follow [Manual updates and rollback](docs/MANUAL_UPDATE.md).

The [reference nginx configuration](sealog.conf) serves one app directory at `/srv/sealog-offline` through three example paths. Paths on the same origin share browser storage, including the queue and login; use the [customization guide's storage guidance](docs/CUSTOMIZATION.md#storage-is-shared-within-an-origin) when setting up independent deployments.

The reference proxy provides HTTPS for the app and forwards its API requests to HTTP Sealog backends. Existing infrastructure can replace it when it supplies trusted HTTPS hosting, the supported static routes, and compatible API access. HTTPS on the API alone is insufficient: the app also needs HTTPS, and an API on another origin needs compatible CORS. See the [deployment choices](docs/MANUAL_UPDATE.md#when-existing-https-can-simplify-installation) and [HTTPS deployment review](docs/HTTPS_DEPLOYMENT_REVIEW.md).

## Updating

After IT deploys an update, connected devices can show a **Reload now** prompt. Choose **Reload now** to use the new code, or **Not now** to dismiss the prompt for that version during the current session. Your saved events remain on the device.

The app checks at startup, on network reconnect, when brought to the foreground, and every five minutes while online. Update timing depends on connectivity and the browser. After reloading, open Settings and confirm the app and worker versions match. Do not clear browser site data to update: it can contain unsynced events.

---

## Development

The app uses vanilla HTML, CSS, and JavaScript, with no build step. For a local UI preview, replace `OWNER/REPOSITORY` with the GitHub repository you are using:

```bash
SOURCE_REPO='OWNER/REPOSITORY'
git clone "https://github.com/${SOURCE_REPO}.git" sealog-offline
cd sealog-offline
python3 -m http.server 8000
```

Open `http://localhost:8000`. This previews the UI; the app's offline worker registers only under a supported vessel path. Use the [testing guide](docs/TESTING.md) and reference HTTPS routing for full offline, GPS, and backend testing. See [Architecture](docs/ARCHITECTURE.md) for code and storage organization, and [Specification](docs/SPECIFICATION.md) for the server API contract.

To exercise the offline worker itself — installation, caching, and offline reload — run the app under a supported vessel path with Docker instead:

```bash
docker compose up --build
```

Open `http://localhost:8080/sealog-a/` (or `-b`/`-c`). `http://localhost` is a secure context, so the service worker installs without a certificate. `docker-compose.yml` bind-mounts the app's runtime files, so edits appear on refresh with no rebuild. Sign-in and sync need a real Sealog Server: point one at `localhost:8000`, `8100`, or `8200` on the host — `docker/nginx.conf` proxies each deployment path there — or skip it and use the app signed out, offline. See [`docker/nginx.conf`](docker/nginx.conf) for the routing.

---

## Documentation

| Doc | For |
|---|---|
| [`docs/QUICK_START.md`](docs/QUICK_START.md) | Operators - daily logging workflow |
| [`docs/IOS_CERTIFICATE_SETUP.md`](docs/IOS_CERTIFICATE_SETUP.md) | Operators and IT - private CA installation and full trust on an iPhone or iPad |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Watch leads - triage GPS / auth / sync / storage |
| [`docs/INSTALLATION.md`](docs/INSTALLATION.md) | Administrators - complete first installation and device acceptance |
| [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md) | Administrators and developers - names, routes, backends, icons, themes, and defaults |
| [`docs/cert-generation.md`](docs/cert-generation.md) | Administrators - private CA generation, verification, and device trust |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Developers - how the code is organized |
| [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | Developers - Sealog Server API contract |
| [`docs/TESTING.md`](docs/TESTING.md) | Developers - local test suite |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Release managers - validate and package a release |
| [`docs/MANUAL_UPDATE.md`](docs/MANUAL_UPDATE.md) | Administrators - transfer, update, and roll back the static app |
| [`docs/HTTPS_DEPLOYMENT_REVIEW.md`](docs/HTTPS_DEPLOYMENT_REVIEW.md) | Administrators and developers - HTTPS hosting, proxy alternatives, and route constraints |
| [`docs/QA_PLAN.md`](docs/QA_PLAN.md) | QA - field scenario matrix |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security reviewers - storage, sessions, and deployment |

---

## Contributing and reporting issues

See [Contributing](CONTRIBUTING.md) for bug reports, feature suggestions, and pull requests. Report suspected vulnerabilities through the [private reporting guidance](docs/SECURITY.md#reporting-a-vulnerability).

## License

[MIT](LICENSE). See the license file for the copyright notice.

Third-party assets retain their upstream licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Open Source Attributions

The UI glyphs are [Phosphor Icons](https://phosphoricons.com), using the regular SVGs from `@phosphor-icons/core` 2.1.1 (MIT, © 2023 Phosphor Icons). The [upstream license](icons/phosphor/LICENSE), [pinned source manifest](icons/phosphor/source.json), and unmodified source SVGs are included. The generated sprite, select carets, and CSS masks also embed the full license for offline distribution. Run `npm run icons:check` to verify them, or `npm run icons:sync` after an intentional source update.

The app icons and favicons use Phosphor's `list` glyph. Regenerate their SVG, PNG, and ICO assets with `node scripts/sync-app-icons.mjs` after installing Chromium as described in [Testing](docs/TESTING.md). Their attribution is included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

It logs to a [Sealog Server](https://github.com/OceanDataTools/sealog-server) (MIT) instance by Ocean Data Tools.

The theme palettes and their fixed accent colors are adapted from [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the source and full license notice. Development and test dependencies are listed in `package.json` and pinned in `package-lock.json`; their upstream licenses apply when their code is redistributed.
