# Security and deployment boundaries

These notes describe the v1.2.0.9 app and reference [`sealog.conf`](../sealog.conf). Use them when configuring [installation](INSTALLATION.md), [certificates](cert-generation.md), and shared operator devices. The app is a static browser client; Sealog Server provides accounts, permissions, and the server-side record store.

## Reporting a vulnerability

Report suspected vulnerabilities privately. On this repository's GitHub security advisories page, choose **Report a vulnerability** and submit a private report. This button is available once a repository administrator enables [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) for the public repository.

Include the affected app and worker versions, browser/device details, steps to reproduce, and the potential impact. Use a minimal example with demonstration data; remove passwords, bearer tokens, private keys, and sensitive operational records from attachments.

Do not disclose vulnerability details in public issues or pull requests. If the private reporting button is unavailable, open an issue asking the maintainers for a private reporting channel, without including vulnerability details or a proof of concept. Use the private channel for the report and any proposed fix.

For ordinary bugs and feature requests, follow [Contributing](../CONTRIBUTING.md).

## Protect the app origin and device

The app stores event records in IndexedDB and its bearer token in `localStorage`. It does not encrypt those values itself. Protect operator devices with a passcode, automatic screen lock, and the organization's device-management policy. Keep credentials out of screenshots and lock the device between stations.

Treat write access to the deployed HTML and JavaScript as access to the browser application's data: code served from this origin can read its token and stored records. Restrict deployment accounts and serve the app from an origin reserved for trusted applications. Do not add untrusted third-party scripts to the app shell.

All three vessel paths share the same IndexedDB database and preference keys on one origin. Different path prefixes do not isolate accounts, events, settings, or tokens. Use distinct origins when you require separate browser storage; changing an origin also changes where the browser looks for saved events, so it is not a way to move an existing device queue.

## Authentication and sign-out

- **Named operators:** sign in with individual accounts where possible. The server enforces their permissions.
- **Guest login:** **Continue as guest** submits username `guest` with a blank password. The server decides whether that account exists and what it can do; the client does not grant a guest role locally.
- **Passwords:** application code sends the password to `/api/v1/auth/login` and does not persist it. A successful login clears the input. Browser password-manager storage is separate from application storage.
- **Tokens:** the JWT is stored in `localStorage.jwt` and sent as a bearer token on authenticated requests. JWT lifetime, role changes, revocation, and password policy are server responsibilities; the client does not decode a token to enforce an expiry timer.
- **Unauthorized responses:** several API paths clear the token after `401`, including cruise/import/template requests, event uploads, and UUID lookups. Some telemetry/auxiliary helpers only report failure, and not every unauthorized-response path removes all identity fields. Use **Sign out** to end the local session explicitly.

Sign-out removes `jwt`, `username`, and `userId`, clears saved cruise context, and switches the UI to fallback templates. It does not erase events, cached templates, preferences, API overrides, or server-side tokens. A subsequent operator on the same browser storage can see earlier local records.

On device loss, notify the administrator and use the backend's supported token/account revocation procedure. An unsynced event can be recovered only from that device or a previously exported copy; a backup of the static web server does not contain it. Check the backend's policy before assuming a password change revokes issued tokens.

## HTTPS and backend routing

Serve the app over trusted HTTPS using the exact address operators will reopen. The certificate must match that hostname/IP, and every device must trust the issuing CA. Follow [certificate configuration and verification](cert-generation.md); bypassing a browser warning or using `curl -k` does not establish a trusted deployment.

The reference proxy terminates TLS and sends requests to its configured Sealog upstreams over HTTP. Protect that proxy-to-backend network separately, or adapt the upstream connection to your deployment's secured transport. Keep backend ports reachable only by their intended clients and verify each upstream's identity/address before entering credentials.

Suitable existing HTTPS infrastructure can replace the reference nginx deployment
if it serves the PWA's required static routes and provides compatible HTTPS API
access. HTTPS on the API alone does not secure an HTTP-hosted app. A different
API origin also needs working CORS for the client's JSON requests and bearer
headers; TLS does not grant that access. See [deployment choices](MANUAL_UPDATE.md#when-existing-https-can-simplify-installation)
and the [HTTPS deployment review](HTTPS_DEPLOYMENT_REVIEW.md) before changing the
app address, API routes, or proxy.

The `apiRoot` preference overrides `window.API_ROOT` and the default vessel route. `asnapVesselApiRoot` can override the vessel-telemetry source, which receives the same stored bearer token. Both preferences persist through sign-out. Clear test overrides before operator use and inspect browser network requests to confirm the resolved login, event, and telemetry endpoints. See [Customization](CUSTOMIZATION.md) for configuration locations.

The worker skips non-GET requests, cross-origin requests, and GET paths that normalize to `/sealog-server/`. Those exclusions cover the reference API routes. If you configure a different **same-origin API prefix**, update the worker's exclusion as part of that change; otherwise its GET responses can be handled as cached static assets. Changing an API root alone does not update the worker's routing rules.

## What is retained

| Surface | Contents | Retention and removal |
|---|---|---|
| IndexedDB `events` | Captured/imported events, timestamps, options, retries, revisions, and attribution | Sign-out retains records. **Clear Cached Events…** removes only records in the fully synced state. Ordinary events without a server record can be deleted through their event controls. |
| IndexedDB `templates` | Cached server template definitions | A successful refresh replaces the cache. Sign-out uses fallbacks in the UI without clearing this store. |
| IndexedDB `meta` | Cruise context and template-sync metadata | Updated during use. Sign-out clears the saved cruise ID/start/stop context. |
| `localStorage.jwt` | Bearer token | Explicit sign-out or the applicable unauthorized-response handler. |
| `localStorage.username` / `userId` | Display identity and attribution | Explicit sign-out removes both; some unauthorized-response paths leave identity values. |
| Other `localStorage` preferences | Theme, auto-fill rules, ASNAP settings, API overrides | Persist across sign-out and app updates. |
| `localStorage.asnapBackfillDebugSnapshot` | Latest full backfill diagnostic snapshot, including sampled telemetry/context | Overwritten by later snapshots; sign-out does not remove it. |
| Service-worker Cache Storage | Same-origin app/static responses handled by the worker | Activation removes older app caches. Reference Sealog API routes bypass this cache. |
| CSV exports | Event records from the exporting device | Remain as downloaded files until removed outside the app; protect them like the original records. |

Confirm ingestion before removing synced records. Clearing site data or uninstalling the PWA can remove unsynced records; neither is a normal app-update or certificate-trust step. Use [Manual updates](MANUAL_UPDATE.md) to preserve device data during deployment.

## Configure diagnostic logging deliberately

The reference nginx configuration enables three logs:

| Log | Contents |
|---|---|
| `/var/log/nginx/sealog-sync-meta.log` | Request metadata for Sealog API routes, including client address, query string, timing, and status. |
| `/var/log/nginx/sealog-sync-events-body.log` | Request bodies on event and auxiliary-data routes; these can contain coordinates, operator notes, and attribution. The login route is not selected by this body-log map. |
| `/var/log/nginx/sealog-asnap-backfill-snapshot.log` | Snapshot request metadata and any request body made available to the log; client payloads contain sampled event/telemetry context. |

The error log is also configured at `debug`. Debug output requires an nginx build with debugging support and can expose more request detail than normal operational logs. [Nginx debugging-log documentation](https://nginx.org/en/docs/debugging_log.html).

Verify that diagnostic bodies actually appear before relying on them. The snapshot locations return `204` directly, which does not itself establish that nginx read and retained the body. Nginx documents `$request_body` availability in relation to body processing and memory buffering. [Nginx request-body variable](https://nginx.org/en/docs/http/ngx_http_core_module.html#var_request_body).

Before using the reference file for normal operation:

1. Choose whether event bodies and backfill snapshots are needed. To stop these access logs, remove/comment their two `access_log` directives in the HTTPS server block; retain metadata logging if desired.
2. Change the error-log level from `debug` to the operational level you intend, such as `warn`.
3. If snapshot collection is unnecessary, replace each of the three exact `/sealog-*/debug/asnap-backfill` location bodies with `return 404;`. These are literal locations for `sealog-a`, `sealog-b`, and `sealog-c`, not a wildcard location to paste into nginx. Snapshot-forwarding failure does not stop event synchronization.
4. Restrict log-file access and configure rotation, retention, and storage limits in the host's logging system. The browser app does not enforce or redact server logs.
5. Run `sudo nginx -t`, then reload only after validation succeeds.

The reference snapshot endpoints accept POST without an Authorization header. Same-origin placement is a routing choice, not an authentication check. If retaining the endpoints, restrict network access according to the deployment's needs; the files do not supply endpoint authentication or rate limits. Disabling the server sink does not erase the latest diagnostic snapshot already stored on a device.

## Certificate material and deployment files

Keep the root CA private key, certificate configuration, and PKCS#12 exports in protected administrative storage outside the web root and app release bundle. The nginx server needs only `sealog-server.key` and `sealog-server-fullchain.crt`; operator devices need only the public root certificate. [Certificate generation and installation](cert-generation.md) gives the exact file transfer and permission steps.

The repository ignores the default generated directory, the exact local certificate JSON path, and common private-key/export extensions. That is a convenience, not a publication check: differently named JSON files, alternate output directories, and already tracked files may still be included. Inspect the actual release file list. Never publish a deployment directory by recursively copying the entire development checkout into the web root.

## Dependency and release checks

`client_uuid` values combine a time prefix with randomness from `crypto.getRandomValues`. They identify and deduplicate records; they are not authentication credentials or access-control tokens.

The browser runtime has no npm production dependencies. Contributor tools are locked in `package-lock.json`; install with `npm ci` and run `npm audit --include=dev --audit-level=moderate` when preparing a release. Recheck the current lockfile because advisories can change. Follow the [release checklist](RELEASE.md), including asset verification and the [third-party notices](../THIRD_PARTY_NOTICES.md).
