# Manual updates and rollback

This guide deploys **v1.2.0.9** from a workstation using rsync. Serving this static client does not require Git, Node.js, npm, or the test suite on the production host; Sealog Server has its own backend requirements. There is no application build step and no automated server installer in this repository.

For a new host, start with [Installation](INSTALLATION.md), which covers DNS,
certificates, nginx, backends, and device trust. Return here when that guide asks
you to copy the static app. For source changes, use [Customization](CUSTOMIZATION.md)
before staging the files; downloading an uncustomized release will not include
your local changes.

## Why the reference deployment uses nginx

The supplied [nginx configuration](../sealog.conf) serves the app over HTTPS and
accepts API requests at the same HTTPS origin, then forwards them to the Sealog
backends over HTTP on the server network. For example, a browser request to
`https://logs.example.test/sealog-a/sealog-server/api/v1/events` is forwarded to
`http://203.0.113.40:8000/sealog-server/api/v1/events`. Substitute the deployment's
actual addresses; these are examples.

The app's own address needs trusted HTTPS for its service worker and device GPS.
Giving only the API an HTTPS address does not make an HTTP-hosted app a secure
context. An HTTPS app's requests to an ordinary HTTP API are normally blocked as
mixed content. In the reference setup, the browser uses HTTPS for both; the HTTP
leg is inside nginx and remains unencrypted, so the deployment must protect that
network separately. Same-origin API routing also avoids browser CORS requirements.
See the [HTTPS deployment review](HTTPS_DEPLOYMENT_REVIEW.md) for browser
requirements, local-development exceptions, and the scope of verification.

## When existing HTTPS can simplify installation

**Nginx itself is optional.** Reuse an existing HTTPS host if it can serve the app
and provide compatible API access. An API already serving trusted HTTPS may
remove the need for the reference HTTP-to-HTTPS proxy; the static app still needs
its own HTTPS hosting. Choose the arrangement supported by the deployed server:

| Available infrastructure | Deployment approach |
|---|---|
| Sealog API is HTTP-only | Use the reference nginx layout or an equivalent HTTPS host and reverse proxy. |
| Existing HTTPS host can serve the app and route API requests at the same origin | Reuse that host and routing. |
| Sealog API has trusted HTTPS at a different origin | Host the app over HTTPS and configure a direct HTTPS API root, with CORS support on the API. |

An origin includes the scheme, hostname, and port: `https://logs.example.test`
and `https://logs.example.test:8000` are different origins. Before replacing the
reference hosting, verify the following:

1. **App paths and offline installation.** This release registers its worker under
   `/sealog-a/`, `/sealog-b/`, or `/sealog-c/`. Its precache fetches root assets and
   all three static aliases, even if only one backend is used. Preserve these
   routes, file types, and worker scopes, or follow the coordinated path changes
   in [Customization](CUSTOMIZATION.md#rename-add-or-remove-deployment-paths).
2. **API selection.** Set `window.API_ROOT` before `app.js` executes, or use the
   administrator's per-device localStorage `apiRoot` override. An explicit root
   such as `https://api.example.test:8000/sealog-server` stops before `/api/v1`,
   which the client appends. Bare hostnames/IP addresses become HTTP. Saved
   overrides take precedence and survive sign-out; Settings has no API-root
   control. See [API overrides](CUSTOMIZATION.md#override-the-event-api-only-when-needed).
3. **Cross-origin access.** A separate HTTPS API must allow the app origin,
   unauthenticated `OPTIONS` preflights, and the client's GET, POST, and PATCH
   requests with `Authorization` and JSON `Content-Type`. Verify login, reads,
   uploads, and edits in a browser; curl does not verify browser CORS. For
   same-origin APIs, retain `/sealog-server/` after the supported deployment prefix
   (or at the root), or update the worker's API-cache exclusion for the new path.
4. **Vessel backfill.** If enabled, its position API must also be reachable over
   trusted HTTPS and accept the user's token. The current resolver derives
   Deployment A and port-8000 candidates. The `asnapVesselApiRoot` override is
   tried first and retains fallbacks; review [ASNAP routing](CUSTOMIZATION.md#asnap-vessel-position-routing)
   and verify backfill separately from event sync.
5. **Optional diagnostics.** The reference nginx host provides
   `/<deployment-prefix>/debug/asnap-backfill` on the app origin. Provide an
   equivalent receiver only if server-side snapshot logging is wanted; its
   absence does not block normal sync.

Preserve an existing app origin when changing hosting. Device queues and settings
do not automatically move to a different scheme, hostname, or port. An API origin
can change independently, provided it is the intended backend for queued records.

## Server layout and prerequisites

The commands below use the reference nginx layout. For another HTTPS host, use
its web root and configuration procedure while preserving the requirements above.

The transfer requires SSH access and rsync on both machines. The remote account
needs sudo access to install files under `/srv` and manage nginx when required.

The reference [nginx configuration](../sealog.conf) serves the landing page and all three vessel paths (`/sealog-a/`, `/sealog-b/`, `/sealog-c/`) from one static directory, `/srv/sealog-offline`. Copy the app there once. These paths share browser storage when served from the same origin; they are not separate accounts or data stores. Use the address and routes chosen during customization throughout the checks below.

The supplied deployment labels and routes are generic examples. When adopting
these routes in an existing installation, follow the coordinated path updates
in [Customization](CUSTOMIZATION.md#rename-add-or-remove-deployment-paths),
including backend routing, worker scopes, saved API overrides, and operator
bookmarks or installed shortcuts.

Before a first installation, an administrator must:

1. Provide the Sealog Server instances the app will use. They are separate services, not included in this repository.
2. Install and configure nginx. Adapt the example's hostnames/IP addresses, upstream addresses and ports, certificate paths, and logging settings to the deployment. The `203.0.113.*` addresses are placeholders. The example uses upstream ports 8000, 8100, and 8200 for the three routes.
3. Configure HTTPS with a certificate trusted by operator devices. For a private CA deployment, use [certificate setup](cert-generation.md) for the server and [iPhone/iPad certificate installation and full trust](IOS_CERTIFICATE_SETUP.md) for each device. Copying the app files does not install device trust. See [security](SECURITY.md) for storage and logging considerations.
4. Keep the configured app paths consistent with `landing.html`, `sw.js`, and the supported prefixes in `src/config/constants.js`. The manifest's start URL and scope are already relative. Review ASNAP source routing and test helpers when changing paths; [Customization](CUSTOMIZATION.md#rename-add-or-remove-deployment-paths) lists every dependent file.

The commands below assume `/srv/sealog-offline` is a regular directory. Set `web_root` to the actual installation path if different. If it is a release symlink, use the installation's existing release-switch procedure instead.

## Prepare the app on your workstation

Choose either a published release or the local checkout. Run subsequent commands in the same terminal so `release_tag`, `stage`, and `prod` remain set.

### From a published release

Requires the GitHub CLI and an available release in your source repository. Replace `OWNER/REPOSITORY` below with its GitHub owner and repository name. Until a release is published, use the local-checkout instructions below.

```bash
SOURCE_REPO='OWNER/REPOSITORY'
release_tag=v1.2.0.9
download_dir=$(mktemp -d /tmp/sealog-download.XXXXXX)
stage=$(mktemp -d /tmp/sealog-app.XXXXXX)

gh release download "$release_tag" \
  --repo "$SOURCE_REPO" \
  --pattern "sealog-offline-${release_tag}.tar.gz" \
  --pattern SHA256SUMS \
  --dir "$download_dir" &&
(cd "$download_dir" && shasum -a 256 -c SHA256SUMS) &&
tar -xzf "$download_dir/sealog-offline-${release_tag}.tar.gz" -C "$stage"
```

Stop if downloading, checksum verification, or extraction fails. On Linux, use `sha256sum -c SHA256SUMS` instead of `shasum -a 256 -c SHA256SUMS`.

### From the local checkout

Run this from the repository root. It copies the files currently on disk, including local changes; use a verified release checkout for a reproducible deployment.

```bash
release_tag=v1.2.0.9
stage=$(mktemp -d /tmp/sealog-app.XXXXXX)

rsync -rp --chmod=D755,F644 \
  index.html landing.html app.js update-banner.js sw.js \
  manifest.webmanifest favicon.ico src icons \
  LICENSE THIRD_PARTY_NOTICES.md licenses \
  "$stage/"
```

The selected contents are the complete runtime bundle:

```text
index.html                 landing.html
app.js                     update-banner.js
sw.js                      manifest.webmanifest
favicon.ico
src/                       icons/
LICENSE                    THIRD_PARTY_NOTICES.md
licenses/
```

Keep all license notices and the complete `icons/` directory with the app. Development dependencies, tests, scripts, certificate material, and repository metadata are excluded by the file list above. There is no `dist/` directory to build or upload.

Before either type of bundle is transferred, check the two runtime versions:

```bash
grep 'CACHE_VERSION =' "$stage/sw.js" "$stage/src/config/constants.js"
```

Both should say `v1.2.0.9`. If you changed artwork, make sure the staged icon bytes
and URL revisions include those changes too. Keep the local staged directory
until deployment verification succeeds.

## Transfer from the workstation

Replace the SSH destination with the production account and host:

```bash
prod='deploy-user@production-host'

ssh "$prod" "mkdir sealog-update-${release_tag}" &&
rsync -rp --progress --chmod=D755,F644 \
  "$stage/" "$prod:sealog-update-${release_tag}/"
```

Stop on any transfer error. The files are staged in the SSH account's home directory;
the running app has not changed yet. `mkdir` intentionally fails if a staging
directory from an earlier attempt exists, so stale files cannot be silently mixed
into a new bundle. On the server, rename that earlier directory to a unique backup
name before repeating the transfer, or select a new staging name in both transfer
and installation commands. Do not change the application version just to retry
a transfer.

## Install the staged app

Use a quiet update window. Copying into the active directory is not an atomic replacement of the whole app. Publishing `sw.js` last ensures that the new worker starts installing only after its assets are present.

The following command runs from the workstation. It creates a backup on an existing installation, or creates the static directory on a first installation. Its staging name must match the version transferred above.

```bash
ssh -t "$prod" '
  set -eu
  stage="$HOME/sealog-update-v1.2.0.9"
  web_root=/srv/sealog-offline
  backup="/srv/sealog-offline-backup-$(date -u +%Y%m%dT%H%M%SZ)"

  test ! -L "$web_root"
  for file in index.html landing.html app.js update-banner.js sw.js manifest.webmanifest favicon.ico src/config/constants.js src/sw/helpers.js LICENSE THIRD_PARTY_NOTICES.md; do
    test -f "$stage/$file"
  done
  test -d "$stage/icons"
  test -d "$stage/licenses"

  if test -d "$web_root"; then
    sudo cp -a "$web_root" "$backup"
    printf "Backup: %s\n" "$backup"
  else
    sudo install -d -m 0755 "$web_root"
  fi

  sudo rsync -rp --delay-updates --chmod=D755,F644 \
    --exclude="/sw.js" "$stage/" "$web_root/"
  sudo install -m 0644 "$stage/sw.js" "$web_root/.sw.js.new"
  sudo mv "$web_root/.sw.js.new" "$web_root/sw.js"
'
```

These commands do not delete other files from the web root. They do not change nginx settings, `/srv/certs`, or the Sealog backend/database.

When an update removes runtime files, review and remove the obsolete files too.
For a directory dedicated entirely to this app, preview an exact mirror in a
**server shell**, with `stage` and `web_root` set to the same paths used above:

```bash
stage="$HOME/sealog-update-v1.2.0.9"
web_root=/srv/sealog-offline
sudo rsync -rpn --delete --itemize-changes --exclude='/sw.js' \
  "$stage/" "$web_root/"
```

Inspect every `*deleting` entry and confirm the installation backup exists. If
the preview contains only files you intend to remove, run the same command with
`-rp` instead of `-rpn`. Do not use this mirror operation on a directory holding
uploads, certificates, or another application. The normal copy above preserves
unrecognized files rather than deciding for you what belongs to the app.

For a static update, no nginx reload is needed. After installing or changing nginx configuration separately, run `sudo nginx -t` and reload nginx only if validation succeeds.

## Verify the update

For a first installation or hosting change, also verify trusted HTTPS on an
operator device, successful service-worker activation, GPS permission and capture,
login, sync, and an edit that reaches the API. Check the browser console for
certificate, mixed-content, and CORS errors. Exercise vessel backfill if enabled.

From a workstation that trusts the production HTTPS certificate, replace the example origin:

```bash
origin=https://production-host

curl -fsS -H 'Cache-Control: no-cache' "$origin/sealog-a/sw.js" \
  | grep 'CACHE_VERSION ='
curl -fsS -H 'Cache-Control: no-cache' "$origin/sealog-a/src/config/constants.js" \
  | grep 'CACHE_VERSION ='
```

Both must show **`v1.2.0.9`**. Check the other configured vessel routes too. App HTML, JavaScript, the manifest, and the worker should use `Cache-Control: no-cache`, as in the reference configuration. For curl with a private CA, install that CA or supply its certificate with `--cacert`.

On each installed device:

1. Open or foreground the app while connected to the deployment network. It checks for updates on startup, foreground/reconnect, and periodically while online.
2. Tap **Reload now** when prompted. Confirm the app and worker versions in Settings both show **v1.2.0.9**. A same-version deployment can update files without a new-version prompt; foreground and reload the connected app, then verify the actual changed behavior/assets as well as the version labels.
3. Confirm existing events and settings remain present. A template with no saved rules should receive default GPS rules without opening Manage rules. Existing choices, including None and edit-only rules, should remain unchanged.
4. Check a normal capture and sync. Saving a rule change should update the capture form immediately.
5. After the connected reload, disconnect and reopen the app to verify offline operation. Reconnect afterward.

Do not clear site data or uninstall the PWA as part of the update. Queued events and settings are stored on each device; the server backup does not contain unsynced device records.

## Roll back an existing installation

On the production server, set `backup` to the backup path printed during installation:

```bash
web_root=/srv/sealog-offline
backup=/srv/sealog-offline-backup-YYYYMMDDTHHMMSSZ

test -f "$backup/sw.js" &&
sudo rsync -rp --delay-updates --chmod=D755,F644 \
  --exclude='/sw.js' "$backup/" "$web_root/" &&
sudo install -m 0644 "$backup/sw.js" "$web_root/.sw.js.new" &&
sudo mv "$web_root/.sw.js.new" "$web_root/sw.js"
```

Restore app code and both version constants together. Foreground the installed app while connected, accept the reload, and verify that both version labels match the restored release. Keep device site data intact.
