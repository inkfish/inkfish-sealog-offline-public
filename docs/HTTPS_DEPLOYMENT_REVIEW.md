# HTTPS deployment review

Reviewed **2026-09-12** for Sealog Offline Logger **v1.2.0.9**. Client and reference-configuration findings were checked against the public source at commit `9a310588ebf4e8af0ba20bf8ba0d46a538273492`. Browser experiment results below are retained from the supplied review and were not rerun during this documentation update. Operational instructions are in [Manual updates and hosting choices](MANUAL_UPDATE.md).

## Finding

The reference proxy has a concrete purpose: it serves the PWA over HTTPS and exposes HTTPS API routes while Sealog continues to use HTTP behind it. This is exactly what [`sealog.conf`](../sealog.conf) configures. Existing HTTPS infrastructure can replace the additional nginx deployment if it also provides the required static routes and working browser API access.

The stronger claim that enabling HTTPS on Sealog alone makes the entire nginx configuration unnecessary is incomplete. The configuration also serves this separate app, implements three vessel routes, supplies the service worker's static aliases, and receives optional diagnostics. Each required function needs to be retained or deliberately replaced.

| Claim examined | Verdict |
|---|---|
| HTTP-only hosting prevents this app's full offline/GPS behavior on operator devices. | Supported for ordinary network origins; localhost and browser-specific exceptions need qualification. |
| An HTTPS PWA cannot ordinarily fetch directly from an HTTP Sealog API. | Supported by mixed-content rules and the named-host browser experiment. It is not an absolute statement covering every browser exception. |
| The supplied nginx configuration bridges HTTPS browser requests to HTTP Sealog requests. | Confirmed directly in the configuration. |
| Sealog Server inherently lacks HTTPS support. | False for the inspected upstream version: direct TLS is implemented. |
| A separate nginx deployment is always required. | False: suitable existing HTTPS hosting and API access can replace it. |
| HTTPS on the API alone is sufficient. | False: app hosting, certificate trust, routes, worker installation, and cross-origin access remain separate requirements. |

This review does not validate a particular deployment. Verify the installed server's listener settings, certificates, CORS responses, and operator-device behavior before changing the hosting arrangement.

## Browser requirements are separate from API capability

A service worker can be registered only by a secure context. HTTPS on a different API origin does not change the security of the document running the app. The secure-context rules also recognize loopback and conforming localhost names; an ordinary HTTP ship hostname or private LAN IP does not acquire that trust merely by being on a private network. [W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/#examples-service-workers), [potentially trustworthy origins](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy).

The Geolocation specification rejects a position request from a non-secure context with `PERMISSION_DENIED`. HTTPS therefore matters to GPS as well as offline installation. A secure origin still needs browser/OS location permission and a usable location fix. [W3C Geolocation, request a position](https://www.w3.org/TR/geolocation/#request-a-position).

When an HTTPS document uses `fetch()` for an ordinary HTTP API, that is blockable mixed content. Adding CORS response headers does not turn the HTTP connection into HTTPS. Conversely, switching an API to HTTPS removes that transport mismatch but does not itself grant cross-origin response access. [W3C mixed-content categories](https://www.w3.org/TR/mixed-content/#category-blockable), [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).

### Counterexamples that limit the generalization

HTTP localhost is useful for development because it has a special trust rule. The browser experiment below deliberately used ordinary `.test` names for its negative cases, even though their test-only DNS mappings pointed to loopback. A separate request to literal `127.0.0.1` succeeded, illustrating why a localhost-only test can hide deployment problems.

Chrome also documents permission-gated Local Network Access exceptions to mixed-content checks for private IP literals, `.local` names, and fetches annotated with `targetAddressSpace: "local"`. This prevents an honest conclusion of “HTTPS-to-HTTP is impossible in every browser.” These exceptions do not make an HTTP-hosted PWA a secure context, and they do not establish a portable fleet configuration. This app does not add that fetch option. The review did not test private-LAN permission prompts or Safari/iOS behavior. [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access#what_kinds_of_requests_are_affected).

## What nginx actually does here

The reference file defines an HTTP-to-HTTPS redirect, an HTTPS listener with a certificate and key, and `/srv/sealog-offline` as the static root. Its API location for Deployment A replaces the browser-facing `/sealog-a/sealog-server/` prefix with `/sealog-server/` on an HTTP upstream at port 8000. Deployment B and Deployment C use corresponding upstreams at 8100 and 8200. The addresses in the file are documentation placeholders, not production endpoints to probe. [Reference configuration](../sealog.conf).

For example:

```text
Browser:  https://<app-host>/sealog-a/sealog-server/api/v1/events
                         |
                         | HTTPS terminates at nginx
                         v
Upstream: http://<deployment-a-backend>:8000/sealog-server/api/v1/events
```

The browser's connection stays HTTPS and same-origin with the PWA. Nginx makes the second request as a server, so the browser's mixed-content and CORS checks do not govern that upstream hop. The `http://` in `proxy_pass` selects an unencrypted upstream connection; `X-Forwarded-Proto: https` describes the original request and does not encrypt the backend leg. [nginx `proxy_pass` documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

This is TLS termination at a reverse proxy, not end-to-end TLS to Sealog. Retaining HTTP upstreams assumes that the deployment protects the proxy-to-backend network, as already described in [Security](SECURITY.md#https-and-backend-routing).

## Upstream Sealog can provide HTTPS directly

The inspected upstream `2.x` commit is [`092666400385b1d4fff015337ca335db28208b07`](https://github.com/OceanDataTools/sealog-server/tree/092666400385b1d4fff015337ca335db28208b07), dated 2026-09-03, package version 2.4.7. This is evidence of upstream capability, not a claim about the installed backend version.

Its distribution configuration reads `SEALOG_SERVER_TLS_PRIVKEY` and `SEALOG_SERVER_TLS_FULLCHAIN`, then passes the loaded material to Hapi's `tls` option. If certificate loading fails, the catch block leaves TLS disabled. The default listener port is 8000, independently of whether TLS is enabled. Consequently, changing to HTTPS does not imply a move to port 443. [TLS loading](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/config/manifest.js.dist#L4-L15), [listener configuration](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/config/manifest.js.dist#L115-L123).

The upstream installation guide describes enabling TLS by uncommenting certificate-loading code, but that code is already active in the inspected distribution file. Administrators must check their installed configuration and readable certificate paths instead of blindly following that wording. [Upstream installation instructions](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/INSTALL.md#L194-L205), [current distribution configuration](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/config/manifest.js.dist#L4-L15).

Upstream enables `routes.cors: true`. Its locked Hapi 21.4.10 defaults allow the headers used by this client, including `Authorization` and `Content-Type`, and its generated preflight route bypasses authentication. These defaults support the client's cross-origin JSON/Bearer pattern; actual deployment overrides and proxies still need checking. [Sealog CORS setting](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/config/manifest.js.dist#L115-L123), [Hapi defaults](https://github.com/hapijs/hapi/blob/80b77282a3a787531c5ae59466a89b37daf36d5d/lib/config.js#L107-L118), [preflight implementation](https://github.com/hapijs/hapi/blob/80b77282a3a787531c5ae59466a89b37daf36d5d/lib/cors.js#L92-L154), [authentication bypass](https://github.com/hapijs/hapi/blob/80b77282a3a787531c5ae59466a89b37daf36d5d/lib/route.js#L130-L132).

Sealog's built-in static directory routes serve cruise files, lowering files, and images. They do not install or host this offline client. Its default server route returns JSON, and the upstream README describes clients as separate applications. Direct API TLS therefore leaves an app-hosting task. [Default and file routes](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/routes/default.js), [upstream client architecture](https://github.com/OceanDataTools/sealog-server/blob/092666400385b1d4fff015337ca335db28208b07/README.md#L18-L36).

## Constraints in this client

These are findings from the current application source, not general PWA requirements.

**The URL layout is coupled to worker installation.** `app.js` recognizes three vessel prefixes and registers a module worker scoped to the active prefix. `sw.js` expands its precache across root assets and every vessel alias, then installs them with `cache.addAll`. A generic HTTPS host serving only the repository root will display the UI without exercising the app's offline worker. Serving only one vessel alias also leaves required precache URLs missing. Preserve all static aliases or make coordinated code changes before changing that layout. [Application registration](../app.js), [worker precache](../sw.js), [supported prefixes](../src/config/constants.js), [manifest](../manifest.webmanifest).

**The API root is configurable but has precedence rules.** `localStorage.apiRoot` overrides `window.API_ROOT`, then the default `/sealog-server` is used. Root-relative defaults acquire the active vessel prefix. Explicit `https://...` roots retain their scheme; bare addresses become HTTP. The client appends `/api/v1/...`, so that suffix must not be duplicated in the root. A saved override remains after sign-out and affects all vessel paths on that browser origin. [API root resolver](../src/runtime/api-root.js), [request construction](../app.js).

**Another origin needs working CORS.** This includes the same hostname on a different port. Login sends JSON; authenticated reads and writes send an explicit Bearer header; writes include POST and PATCH. The client does not set `credentials: 'include'` for cross-origin cookies. Browser preflights must succeed and actual responses must be shareable with the PWA origin. HTTPS connectivity or a successful curl call does not demonstrate this. [Client requests](../app.js), [CORS request and response rules](https://fetch.spec.whatwg.org/#http-cors-protocol).

**The worker recognizes a specific same-origin API path.** It bypasses cross-origin traffic and normalized `/sealog-server/` paths. A custom same-origin path such as `/custom-api/api/v1/events` falls into static GET handling and can be cached. An alternate host must preserve the canonical API path or change the worker bypass as part of a separately validated code change. The bypass is about excluding API responses from the app cache, not merely making a URL resolve. [Worker fetch handler](../sw.js), [path normalization](../src/sw/helpers.js).

**Backfill and diagnostics have different destinations.** Vessel telemetry resolution first tries an explicit `asnapVesselApiRoot`, then derives Deployment A route and port-8000 candidates and retains the original root as a fallback. The candidate APIs receive the same JWT. They need valid HTTPS, route access, and cross-origin handling where applicable. The optional debug snapshot POST instead stays at `/<prefix>/debug/asnap-backfill` on the app origin, outside `apiRoot`; failure to forward it does not block sync and the local snapshot is retained. [Vessel root candidates](../src/runtime/api-root.js), [backfill and snapshot calls](../app.js), [debug endpoint builder](../src/sync/asnap-debug.js).

**Keeping the app address preserves access to device storage.** Changing the API address need not change the app origin. Moving the PWA to another scheme, host, or port gives it different origin-scoped storage; queues and settings do not transfer with the static files. Prefer retaining the operator-facing address during infrastructure simplification. [Storage architecture](ARCHITECTURE.md#data-model).

## Reported isolated browser verification

The supplied review reports that a temporary Node HTTP/HTTPS fixture and Playwright ran full Chrome for Testing / Chromium **148.0.7778.96** in headless mode, starting at **2026-09-12 17:39:20 UTC**, with ordinary `.test` hostnames mapped to `127.0.0.1`. The fixture used synthetic requests and payloads, not production endpoints, accounts, or event data. It recorded browser failures and server requests so a blocked fetch could be distinguished from a request the server accepted but the browser refused to expose.

| Experiment | Observed result |
|---|---|
| Open `http://ui.test:<port>` | `isSecureContext` was false and `navigator.serviceWorker` was absent. |
| Open the HTTPS fixture with an untrusted self-signed certificate and normal certificate checks | Navigation failed with `ERR_CERT_AUTHORITY_INVALID`. |
| Open HTTPS with the lab-only certificate-error bypass | The page was a secure context and the service-worker API was available. |
| HTTPS page fetches `http://api.test:<port>` using GET or JSON POST | Mixed-content errors; no corresponding request reached the HTTP server. |
| HTTPS page sends Bearer JSON POST/PATCH to another HTTPS origin without CORS | OPTIONS reached the API; the actual POST/PATCH did not. |
| Same cross-origin HTTPS requests with appropriate CORS responses | Preflight and actual POST/PATCH succeeded. |
| Cross-origin HTTPS POST with CORS on preflight only | POST reached the server, but JavaScript could not read the response. A failed fetch did not mean that no write occurred. |
| HTTPS page sends same-origin POST/PATCH to a server-side HTTP proxy | Both browser requests and the forwarded HTTP backend requests succeeded. |
| HTTPS page sends same-origin POST/PATCH directly to the HTTPS fixture | Succeeded without a proxy or cross-origin preflight. |
| HTTPS page fetches literal HTTP `127.0.0.1` with CORS | Succeeded as a loopback exception; not evidence for ordinary LAN HTTP hosts. |
| Register a module worker with only the test context's certificate-error bypass | Registration failed with `SecurityError` before the script request, despite service-worker API availability. |
| Register the same worker with a browser exception limited to the lab certificate's public key | The worker controlled the page, cached HTML, and reopened it offline with `navigator.onLine === false` and zero server requests during that navigation. No nginx was involved. |

The self-signed fixture required an explicit test-context certificate-error bypass for the positive HTTPS page/API experiments. Worker installation needed a second browser run with a certificate-specific SPKI exception. Both are laboratory bypasses, not evidence of device certificate trust or production configuration instructions. Page loading, API availability, and successful worker installation are distinct checks.

No mixed-content, CORS, web-security, or Local Network Access bypass was added. Playwright's default switches disable automatic HTTPS navigation upgrades; mixed-content fetch blocking remained enabled and was observed. All fixture hostnames resolved to loopback, so no public-to-private address-space transition or LAN permission prompt was exercised. The proxy fixture demonstrated the browser/server boundary using Node; it did not execute the production nginx configuration or a Sealog service.

The final run recorded 16 passing checks, one rejected worker registration under the insufficient context-only certificate bypass, and one loopback observation. The minimal successful worker test establishes that nginx is not required for browser caching and offline navigation; it does not validate this application's complete deployment. All temporary servers and browsers were closed afterward.

The experiments establish the core browser mechanism, not a complete replacement deployment. Fleet browser behavior, GPS hardware/permissions, production certificate trust, actual Sealog authentication and backfill, and this app's complete offline lifecycle still need deployment validation.

## Documentation decision

The manual update guide now explains the HTTP-backend reason for the reference nginx setup before giving commands. It offers existing same-origin HTTPS hosting and direct cross-origin HTTPS API access as alternatives, with the current static-route, CORS, API-selection, and backfill requirements made explicit. Other deployment descriptions identify nginx as the reference configuration rather than a universal dependency.

This review changes documentation only. It neither enables TLS on Sealog nor changes this client's hosting paths. Removing the proxy from a live installation requires verifying the replacement against the [installation checks](MANUAL_UPDATE.md#verify-the-update), including real browser login, upload, edit, backfill when enabled, and reopening offline.
