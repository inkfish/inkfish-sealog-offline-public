# Install the application

This walkthrough takes a customized **v1.2.0.9** checkout to a working HTTPS
installation. It uses a Linux nginx server and a separate administrator
workstation. The app is served directly from its source files; **there is no
application build command**. Node.js is only needed for development tools, tests,
and regenerating icons or screenshots.

If the server is already configured, go to [Manual updates](MANUAL_UPDATE.md).
Operators installing the app on a phone should use [Quick Start](QUICK_START.md).

## 1. Prepare the workstation and server

| Machine | Required tools or services |
|---|---|
| Administrator workstation | Git to obtain the source; SSH, rsync, and curl to deploy/check it; Python and OpenSSL if generating a private CA; Node/npm only for development checks |
| Linux web server | nginx with TLS support, rsync, SSH access, and an account allowed to use sudo for installation |
| Sealog backend | A running Sealog Server, account credentials, templates, and a cruise configured by its administrator |
| Logging devices | A compatible browser, access to the chosen HTTPS address, trusted server certificate, and location permission |

The Sealog backend and its database are separate services. This repository does
not install them. Confirm the backend's account permissions and endpoint contract
using [the API specification](SPECIFICATION.md) before commissioning the client.

On a Debian/Ubuntu server using distribution packages, an administrator can
install the web-server prerequisites with:

```bash
sudo apt-get update
sudo apt-get install nginx rsync ca-certificates curl
```

These package commands follow [Ubuntu's nginx setup guide](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/).
Use the platform's package manager and service manager on other distributions.
nginx's [installation instructions](https://nginx.org/en/docs/install.html)
describe available installation methods. Configure the host firewall/network to
allow operator devices to reach HTTPS port 443; port 80 is used by the reference
HTTP-to-HTTPS redirect. Allow the proxy to reach the selected backend ports.

On the workstation, replace `OWNER/REPOSITORY` with your actual source repository:

```bash
SOURCE_REPO='OWNER/REPOSITORY'
git clone "https://github.com/${SOURCE_REPO}.git" sealog-offline
cd sealog-offline
```

Use an authenticated clone method if the repository is private. All subsequent
workstation paths assume this repository root. Review the checkout's version;
the current source is v1.2.0.9. A release tag or downloadable archive is only
available after the repository maintainer publishes one.

## 2. Choose and customize the deployment

Follow [Customization](CUSTOMIZATION.md) to set your visible application/vessel
names, hostname, backend routes, icons, and optional event-template defaults.
Start with one visible deployment and the supplied path `/sealog-a/` unless
you need a different path. The reference also serves `/sealog-b/` and
`/sealog-c/`; the worker needs all configured static routes to be valid.

Use your own values in place of these examples throughout the guide:

| Setting | Example |
|---|---|
| HTTPS origin | `https://logs.example.test` |
| Web-server IP | `10.0.0.10` |
| Backend address | `10.0.0.20:8000` |
| SSH destination | `deploy-user@10.0.0.10` |
| Static app directory | `/srv/sealog-offline` |
| Protected TLS directory | `/srv/certs` |

Arrange DNS resolution on the device network before onboarding phones. Ensure
each independent deployment has its own storage plan: app paths on the same
origin share the local queue, templates, login, and preferences. Different paths
alone are not tenant isolation. See [Storage is shared within an origin](CUSTOMIZATION.md#storage-is-shared-within-an-origin).

## 3. Obtain certificates and establish device trust

Use an existing organizational CA or an already trusted certificate if available.
For a **new private CA**, follow [the complete certificate guide](cert-generation.md).
The essential workstation steps are:

```bash
umask 077
cp -n certs/private-ca/cert-config.template.json certs/private-ca/cert-config.json
chmod 600 certs/private-ca/cert-config.json
# Edit the copied JSON before running the generator.
python3 scripts/generate_cert_chain.py -c certs/private-ca/cert-config.json
```

Set the DNS SAN to the hostname devices will open, such as `logs.example.test`.
Add the IP SAN `10.0.0.10` only if devices will also use that IP address in their
URL. Replace the template subject details and PKCS#12 password. The generator
creates a new root each time it runs; it does not renew under an existing CA.

Verify the certificate chain, hostname/IP, validity, and server-authentication
extensions with the commands in the certificate guide. Keep the root private key
in protected administrator storage. Devices receive only the root **certificate**,
and require the trust setup described in that guide.

For the default output directory and prefix, transfer only the proxy's two files
from the workstation. The unique temporary directory is outside the web root:

```bash
prod='deploy-user@10.0.0.10'
tls_stage=$(ssh "$prod" 'umask 077; mktemp -d "$HOME/sealog-tls.XXXXXX"') &&
scp certs/generated/sealog-server-fullchain.crt \
    certs/generated/sealog-server.key "$prod:$tls_stage/" &&
printf 'TLS files staged on server at: %s\n' "$tls_stage"
```

Stop on a failed command. Log in to the server with `ssh "$prod"`. In that server
shell, replace the staging path below with the one printed above:

```bash
tls_stage=/home/deploy-user/sealog-tls.XXXXXX
sudo install -d -o root -g root -m 0700 /srv/certs
sudo install -o root -g root -m 0644 \
  "$tls_stage/sealog-server-fullchain.crt" /srv/certs/sealog-server-fullchain.crt
sudo install -o root -g root -m 0600 \
  "$tls_stage/sealog-server.key" /srv/certs/sealog-server.key
```

This ownership assumes a conventional nginx service whose master runs as root.
An unprivileged service needs a restricted group/readable directory appropriate
to that service. Do not make a private key world-readable. If `/srv/certs` already
exists or these filenames are in use, preserve the existing certificate/key pair
and its permissions before replacing it. Remove the temporary uploaded key after
the working proxy has been verified. Never upload the CA key or the `.p12` bundle
to the static web directory.

## 4. Install the static app files

From the workstation, follow [Manual updates](MANUAL_UPDATE.md) through
**Prepare the app**, **Transfer**, and **Install the staged app**. That procedure
also handles a first installation and creates `/srv/sealog-offline`.

The required runtime files are `index.html`, `landing.html`, `app.js`,
`update-banner.js`, `sw.js`, `manifest.webmanifest`, `favicon.ico`, the complete
`src/` and `icons/` directories, and the license files listed in that guide.
Do not point nginx at the source checkout or copy the entire repository into the
web root. Tests, development dependencies, Git metadata, and certificate inputs
are not part of the runtime bundle.

## 5. Adapt and enable nginx

Keep your edited nginx file in a protected administrator directory outside the
served app. On the workstation, copy the reference before editing it:

```bash
config_dir=$(mktemp -d /tmp/sealog-nginx.XXXXXX)
cp sealog.conf "$config_dir/sealog.conf"
printf 'Edit this configuration: %s\n' "$config_dir/sealog.conf"
```

Make these changes in the copy:

| Reference setting | Required action |
|---|---|
| Both `server_name 203.0.113.10` lines | Use your DNS name and any supported direct IP, e.g. `server_name logs.example.test 10.0.0.10;`. Both must be in the certificate SANs if both are used. |
| Three `upstream` blocks | Replace `203.0.113.40` and the ports with real backend addresses. For one backend, map all three slots to that backend. |
| Three `proxy_set_header Host` lines | Match the backend authority expected by each server. These are separate from the operator-facing hostname. |
| `proxy_pass` URI | Keep `/sealog-server/` if the backend uses that prefix; use `/` if it exposes `/api/v1` at its root. See [routing examples](CUSTOMIZATION.md#configure-one-backend-without-changing-app-paths). |
| `ssl_certificate` / `ssl_certificate_key` | Match the installed server certificate and key paths. |
| `root` and `alias` paths | Keep `/srv/sealog-offline` or change every occurrence to your static directory. |
| Deployment locations/scopes | Match the source prefix lists if you changed app routes. |
| Debug and request-body logging | Use the normal logging configuration below unless diagnosing a specific issue. |

The reference includes detailed event-body and ASNAP diagnostic logs. For normal
operation, replace its `error_log ... debug;` and three `access_log` directives
inside the HTTPS server with:

```nginx
error_log /var/log/nginx/sealog-error.log warn;
access_log /var/log/nginx/sealog-access.log combined;
```

The unused `log_format`/`map` definitions can remain. Configure retention using
your server's logging policy. The debug endpoint locations can also remain; they
are not needed for ordinary capture or sync. See [Security](SECURITY.md) before
enabling detailed logs.

The file contains `upstream`, `map`, `log_format`, and `server` blocks, so include
it once **inside nginx's `http { ... }` context**. It is not a complete replacement
for `/etc/nginx/nginx.conf` and must not be nested inside another `server` block.
The package's main config should include `/etc/nginx/mime.types` so `.js` files
are served as JavaScript. Check that `.webmanifest` maps to
`application/manifest+json` (or another JSON MIME type); add that extension to
the server's MIME mapping if absent. Do not replace all existing MIME mappings.

For the standard `/etc/nginx/mime.types` include, edit that file with
`sudoedit /etc/nginx/mime.types`. If it has no `webmanifest` entry, add the following
line **inside its existing `types { ... }` block**, keeping all other entries:

```nginx
application/manifest+json webmanifest;
```

Use your distribution's custom MIME include instead if it provides one. Recheck
the mapping after package updates. Defining only this one type in a new
server-level `types` block would replace inherited mappings and can break module
JavaScript; do not do that.

On nginx 1.25.1 or newer, you may replace `listen 443 ssl http2;` with
`listen 443 ssl;` and a separate `http2 on;`. Older versions need the original
syntax. HTTP/2 is optional for this app; omit it if the module is unavailable.
See the [nginx HTTP/2 documentation](https://nginx.org/en/docs/http/ngx_http_v2_module.html#http2).

Transfer the edited file from the workstation:

```bash
scp "$config_dir/sealog.conf" "$prod:sealog.conf.pending"
```

In the **server shell**, first check that `/etc/nginx/nginx.conf` includes
`/etc/nginx/conf.d/*.conf` inside `http`. If your distribution uses a different
site directory, use that directory instead, with only one active copy. Preserve
an existing site config before replacing it:

```bash
if sudo test -f /etc/nginx/conf.d/sealog.conf; then
  sudo cp -a /etc/nginx/conf.d/sealog.conf \
    "/etc/nginx/sealog.conf.backup-$(date -u +%Y%m%dT%H%M%SZ)"
fi
sudo install -o root -g root -m 0644 "$HOME/sealog.conf.pending" \
  /etc/nginx/conf.d/sealog.conf
sudo nginx -t
```

Proceed only when nginx reports successful validation. Resolve conflicting
`server_name` declarations, missing certificates, permissions, or unsupported
directives before enabling the site. On a systemd server:

```bash
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

For a non-systemd installation, use its service manager. nginx's
[configuration guide](https://nginx.org/en/docs/beginners_guide.html#conf_structure)
explains contexts, and its [control commands](https://nginx.org/en/docs/control.html)
cover validation and reload. Routine later static-file updates need no nginx reload.

## 6. Check HTTPS, files, and API routing

On the workstation, use your actual origin. For a private CA, keep the generated
public root certificate available to curl:

```bash
origin=https://logs.example.test
ca_file=certs/generated/sealog-root-ca.crt

curl --cacert "$ca_file" -fsS -I "$origin/"
curl --cacert "$ca_file" -fsS -I "$origin/sealog-a/"
curl --cacert "$ca_file" -fsS -I "$origin/sealog-a/sw.js"
curl --cacert "$ca_file" -fsS -I "$origin/sealog-a/src/sw/helpers.js"
curl --cacert "$ca_file" -fsS -I "$origin/sealog-a/manifest.webmanifest"
curl --cacert "$ca_file" -fsS -I "$origin/icons/icon-192.png?v=sealog-1"
curl --cacert "$ca_file" -fsS "$origin/sealog-a/sw.js" | grep 'CACHE_VERSION ='
curl --cacert "$ca_file" -fsS "$origin/sealog-a/src/config/constants.js" | grep 'CACHE_VERSION ='
```

Omit `--cacert "$ca_file"` if curl already trusts the issuer. Do not use `-k` to
pass acceptance checks: it skips the trust and hostname verification needed by
the devices. Expect 200 responses, JavaScript MIME types for both worker files,
an image MIME type for the icon, and v1.2.0.9 in both constants. Prefixed app files
should carry `Cache-Control: no-cache`. Repeat for every configured app prefix
and verify the root-level app assets too; the worker fetches all of them.

For a read-only backend-routing check:

```bash
curl --cacert "$ca_file" -sS -i \
  "$origin/sealog-a/sealog-server/api/v1/event_templates"
```

A backend `401` without credentials can be expected. A 200 response should be
the backend's JSON, not the landing page. A 502/504 points to upstream reachability;
404 can indicate the wrong proxy/backend prefix. This read-only check does not
prove account permissions or writing events works; verify those in a test cruise.

## Verify from a device

1. Connect a fleet device to its real network. Install/trust the private root if
   applicable, then open the exact HTTPS hostname without a certificate warning.
2. Select the intended deployment. Sign in using a test operator and confirm
   the expected templates and cruise are available. Remove any development API
   override as described in [Customization](CUSTOMIZATION.md#override-the-event-api-only-when-needed).
3. Grant location permission, then check GPS fix age and accuracy. Open Settings
   and wait for both **app** and **sw** to show **v1.2.0.9**.
4. Add the **deployment page** to the Home Screen, not the landing hub. Reopen
   that installed app while connected and verify its account/settings there.
5. In the test cruise, capture and sync a harmless event. Confirm the record on
   the intended backend. Edit it and confirm the update reaches that same record.
6. Go offline, reopen the installed app, and capture an ordinary test event.
   Reconnect and confirm it syncs once. Test ASNAP/backfill separately if used.
7. Record the supported browser/device versions, hostname, app/worker version,
   and test results using [the QA plan](QA_PLAN.md).

Hand operators the HTTPS address, account instructions, root-trust procedure if
needed, and [Quick Start](QUICK_START.md). Keep protected backups of the working
nginx config and server certificate/key pair. Application updates and rollback
are covered by [Manual updates](MANUAL_UPDATE.md); certificate renewal is covered
separately by [Certificate generation](cert-generation.md#renewal-and-troubleshooting).
