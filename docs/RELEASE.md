# Release checklist

This checklist is for maintainers preparing a static-app release. The current version is v1.2.0.9. Use [Installation](INSTALLATION.md) for a new host, [Manual updates](MANUAL_UPDATE.md) for copying a release and rollback, and [Customization](CUSTOMIZATION.md) when preparing a deployment-specific variant.

## Prepare the source

- [ ] Combine the intended branch changes on `main` and inspect the final diff. Preserve existing operator settings and license notices.
- [ ] Update the affected operator and technical documentation against the implemented behavior. Check relative links, examples, screenshots, and commands.
- [ ] Set the same release version in `README.md`, `package.json`, `package-lock.json` (root and root-package entry), `src/config/constants.js`, and `sw.js`. Update the version examples in the deployment guide.
- [ ] Review [third-party notices](../THIRD_PARTY_NOTICES.md) and include the licenses for all distributed assets.
- [ ] Confirm that generated certificates, local credentials, analysis indexes, and development outputs are excluded from the release contents.

Changing an npm version alone does not update the service-worker cache. The worker uses its own `CACHE_VERSION` to name the cache, and the page compares that version with `src/config/constants.js`. Change both when releasing runtime changes. Documentation-only edits do not require a version bump.

## Validate

Run from the repository root with the supported Node/npm toolchain described in [Testing](TESTING.md):

```bash
npm ci
npm audit --include=dev --audit-level=moderate
npm run icons:check
npm run lint
npm test
npx playwright install chromium
node scripts/sync-app-icons.mjs --check
npm run test:e2e
```

On Linux, install Chromium's system dependencies with `npx playwright install --with-deps chromium`. Review the results for the exact commit being released.

- [ ] Check that the app and worker versions match. Browser tests exercise worker installation, update notification, offline loading, and sync.
- [ ] Verify first capture with a template that has no saved rules. Recognized coordinate fields receive On log GPS rules automatically. Existing None, partial, and edit-only configurations must survive reload and template refresh.
- [ ] Verify Save applies rule changes immediately while retaining unrelated entered values; Cancel leaves saved behavior unchanged.
- [ ] Complete the relevant [field QA checks](QA_PLAN.md), including installed iPhone Safari, device GPS, and the actual Sealog backend. Automated Chromium checks do not establish those results.
- [ ] Regenerate documentation screenshots with `scripts/screenshot-app.mjs` and `scripts/screenshot-autofill-modal.mjs` when visible UI changes affect them. Use fixture data, then inspect the images.

## Assets and attribution

The app uses verified Phosphor source files for UI glyphs, app icons, and favicons. Keep `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`, and all of `icons/` in the static bundle.

- After changing the app icon design or its Phosphor `list` source, run `node scripts/sync-app-icons.mjs` with Playwright Chromium installed and inspect the resulting SVG, PNG, and ICO assets.
- Update the app-icon revision (`?v=sealog-1` for this release) in `index.html`, `landing.html`, `manifest.webmanifest`, and the worker precache list when app icons change. Icon HTTP responses are cached as immutable in the reference nginx configuration.
- After intentionally changing the Phosphor revision, update `icons/phosphor/source.json` and the original SVGs/license, then run `npm run icons:sync` and `npm run icons:check`.
- Update the Phosphor `?v=` revision in `index.html`, `landing.html`, `src/ui/html-utils.js`, and the worker precache list when the source revision changes.
- Keep full upstream notices embedded in generated SVGs and HTML.

The app-icon generator currently writes five PNGs: the 16/32-pixel favicons, 180-pixel touch icon, and 192/512-pixel app icons. The ICO contains 16/32/48-pixel entries. `icons/app-icon.svg` is generated from the vendored source; edit the generator when changing its wrapper, then regenerate. See [icon customization](CUSTOMIZATION.md).

## Publish the release

- [ ] Commit the validated source and documentation, and push to your configured source repository without replacing remote work.
- [ ] Create an annotated tag matching the release version on the validated commit.
- [ ] Build `sealog-offline-<tag>.tar.gz` from the committed runtime file list in the deployment guide. Do not bundle tests, `node_modules`, development scripts, local configuration, credentials, or Git metadata.
- [ ] Generate `SHA256SUMS` for that archive. Extract a copy and compare its files to the tagged source, including both version constants and license notices.
- [ ] Publish a GitHub release for the tag, attach the archive and checksum, and mark it **latest**. Verify the uploaded asset hashes and latest-release endpoint. Updating package versions alone does not update that endpoint.

### Build the static archive

After the validated commit has been tagged, run this from the repository root. Set `release_tag` to that tag; the example uses the current release. `git archive` reads the committed tag, so uncommitted changes are not included.

```bash
release_tag=v1.2.0.9
release_dir=$(mktemp -d)
git archive --format=tar --output="$release_dir/sealog-offline-${release_tag}.tar" \
  "$release_tag" \
  index.html landing.html app.js update-banner.js sw.js \
  manifest.webmanifest favicon.ico src icons \
  LICENSE THIRD_PARTY_NOTICES.md licenses
gzip -n "$release_dir/sealog-offline-${release_tag}.tar"
(
  cd "$release_dir" || exit 1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "sealog-offline-${release_tag}.tar.gz" > SHA256SUMS
    sha256sum -c SHA256SUMS
  else
    shasum -a 256 "sealog-offline-${release_tag}.tar.gz" > SHA256SUMS
    shasum -a 256 -c SHA256SUMS
  fi
)
tar -tzf "$release_dir/sealog-offline-${release_tag}.tar.gz"
```

The archive has runtime files at its root. It intentionally contains neither nginx configuration nor certificate material: administrators keep their own `sealog.conf` and TLS files outside the static web root. Distribute the reference configuration and installation documentation through the source repository alongside the archive. Inspect the listing before uploading the archive and checksum.

There is no server installer, automatic server updater, or hosted release workflow in this repository. The browser checks for service-worker updates on its current origin; it does not query GitHub for releases. External installation tools must define their own release selection and deployment behavior.

## Deploy and record

Follow [Manual updates](MANUAL_UPDATE.md) to back up the static app, copy the runtime files, and publish `sw.js` last. Static-file updates do not require nginx reloads; configuration changes require `nginx -t` before reload. Confirm that each configured route serves the new HTML, module worker, imported JavaScript, and versioned icons rather than a fallback HTML response.

Record the deployed version, deployment time, devices checked, capture/sync and offline-reopen results, and the backup path. Tell operators to accept the update prompt while connected. Preserve their browser data throughout updates and rollback.
