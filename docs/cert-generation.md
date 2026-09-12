# Certificates for a private deployment

Use this guide when operator devices must trust a private HTTPS server. It covers the certificate part of [installation](INSTALLATION.md); app files and nginx routing are configured separately.

The helper [`scripts/generate_cert_chain.py`](../scripts/generate_cert_chain.py) creates **a new private root CA and a server certificate signed by it**. It does not install certificates, configure DNS/nginx, distribute device trust, or renew a certificate under an existing CA. If your organization already has a CA or a publicly trusted certificate service, obtain the server certificate through that service and continue at [Install the server certificate](#install-the-server-certificate).

If the app and API already have HTTPS certificates trusted by operator devices,
reuse that infrastructure; generating a new private CA is unnecessary. See
[When existing HTTPS can simplify installation](MANUAL_UPDATE.md#when-existing-https-can-simplify-installation)
for the app routes, API access, and device checks required when reusing a host.

## 1. Choose the address and trust model

Write down the HTTPS address operators will keep using, such as `https://logs.example.test/sealog-a/` or `https://10.0.0.10/sealog-a/`. These are examples; substitute your own network address.

- Put each hostname in `server.san_dns` and each IP address in `server.san_ips`. Include only the host or IP, without `https://`, a port, or an app path.
- If users can open both a hostname and an IP address, include both. One certificate can cover all three app paths on the same host.
- Arrange DNS or local name resolution separately. Adding a name to a certificate does not make that name resolve.
- Keep a stable app origin. Changing the scheme, hostname, or port changes the browser storage location; a certificate replacement at the same origin does not move or erase events.

Devices must trust the CA that signed the server certificate. Generating a full-chain file does not install that trust. A private CA is suitable only when you can distribute its root certificate to the devices that will use the app.

## 2. Prepare the workstation

You need Python 3.8 or later and a maintained OpenSSL release with `req -addext` support. The commands below were checked with OpenSSL 3. Run them from the repository root on a workstation reserved for certificate administration:

```bash
python3 --version
openssl version
umask 077
cp -n certs/private-ca/cert-config.template.json certs/private-ca/cert-config.json
chmod 600 certs/private-ca/cert-config.json
```

`cp -n` preserves an existing local configuration. Edit that local file rather than changing the tracked template. The exact local filename and `certs/generated/` are ignored by Git; other output directories and JSON filenames need their own exclusion or should live outside the checkout. Never generate under `/srv/sealog-offline` or another public web root.

`umask 077` restricts newly created files and directories. Both generated private keys are unencrypted; the helper does not impose permissions independently of your environment. Keep the keys, the JSON configuration, and backups in protected storage.

## 3. Customize the JSON configuration

Edit `certs/private-ca/cert-config.json` with your own organization, address, and export password. For example:

```json
{
  "output_dir": "certs/generated",
  "file_prefix": "sealog",
  "ca": {
    "country": "US",
    "state": "Example State",
    "locality": "Example City",
    "organization": "Example Organization",
    "organizational_unit": "Sealog",
    "common_name": "Sealog Local Root CA",
    "key_bits": 4096,
    "valid_days": 3650
  },
  "server": {
    "country": "US",
    "state": "Example State",
    "locality": "Example City",
    "organization": "Example Organization",
    "organizational_unit": "Sealog",
    "common_name": "logs.example.test",
    "key_bits": 2048,
    "valid_days": 365,
    "san_dns": ["logs.example.test"],
    "san_ips": ["10.0.0.10"]
  },
  "pkcs12": {
    "password": "REPLACE_WITH_A_LOCAL_EXPORT_PASSWORD"
  },
  "keep_csr": false
}
```

| Setting | What to customize |
|---|---|
| `output_dir` | Use a protected directory. Relative paths resolve from the current working directory, not from the JSON file; `~` is expanded. |
| `file_prefix` | Use a simple basename without directory separators. `sealog` matches the reference nginx certificate paths. |
| `ca.common_name` | A recognizable name for the root that operators will trust. This must be nonempty. |
| `server.common_name` | Your primary server hostname or IP; this must be nonempty, but it does not replace SAN entries. |
| Subject fields in `ca` and `server` | Replace country, state, locality, organization, and unit. Use plain single-line values; the helper does not escape arbitrary OpenSSL subject/configuration syntax. |
| `ca.key_bits` / `server.key_bits` | RSA key sizes. The template uses 4096/2048 bits. Do not reduce either below 2048 for Apple devices. |
| `ca.valid_days` / `server.valid_days` | Set renewal periods under your organization's policy. The tracked template uses 3650/825 days; this example uses a 365-day server certificate. The helper does not enforce a platform's maximum lifetime or clamp the leaf's expiry to the root's expiry. |
| `server.san_dns` / `server.san_ips` | Arrays of every hostname/IP clients actually use; at least one SAN entry is required. Keep an unused list empty. |
| `pkcs12.password` | Replace the example. The helper always creates a `.p12`; an empty password produces an export with an empty password. This export is not needed by nginx. |
| `keep_csr` | `true` retains the signing request for inspection; `false` removes it after successful generation. |

The helper emits SHA-256 signatures and a leaf certificate with `CA:FALSE`, digital-signature/key-encipherment usage, and `serverAuth` extended key usage. Apple documents SAN, RSA-key-size, signature, explicit server-authentication EKU, and lifetime requirements for its clients. Keep the server lifetime at or below the documented 825-day limit and validate your actual devices. [Apple TLS certificate requirements](https://support.apple.com/en-us/103769). The extension names follow [OpenSSL's certificate extension format](https://docs.openssl.org/3.0/man5/x509v3_config/).

## 4. Generate the bundle

```bash
umask 077
python3 scripts/generate_cert_chain.py -c certs/private-ca/cert-config.json
```

Always pass `-c` with the edited configuration. Without it, the helper reads the example template. Stop if the command exits with an error. Existing output filenames cause a refusal before bundle files are written; do not add `--force` to get past an unexpected conflict. An OpenSSL failure can leave a partial bundle, so inspect the error and retry in a fresh output directory.

The export password is read from the JSON and passed to the OpenSSL subprocess as a command-line argument. Use a trusted administrative session. Successful completion output omits the password, but a failed PKCS#12 command can include it in the reported error; protect diagnostic output as well as the configuration.

| Generated file | Where it belongs |
|---|---|
| `sealog-root-ca.key` | Protected CA storage only. Do not copy it to nginx or operator devices. |
| `sealog-root-ca.crt` | PEM root certificate for verification and trust distribution. |
| `sealog-root-ca.cer` | DER copy of the root certificate, suitable for device import. |
| `sealog-root-ca.srl` | CA serial-number state; retain with the CA material. |
| `sealog-server.key` | Private server key; install on nginx with restricted permissions. |
| `sealog-server.crt` | The leaf certificate; use for inspection and verification. |
| `sealog-server-fullchain.crt` | Leaf certificate followed by the root; install as nginx's certificate file. |
| `sealog-server.p12` | Password-protected export containing the server key and certificates; retain securely only if needed by another TLS tool. |
| `sealog-server.cnf` | Generated SAN/extension configuration for inspection. |
| `sealog-server.csr` | Signing request, present after success only when `keep_csr` is `true`. |

The table assumes `file_prefix: "sealog"`. Change the filenames in every command if you choose a different prefix or directory.

## 5. Verify before installing

Inspect the root identity and the server's dates and extensions:

```bash
openssl x509 -in certs/generated/sealog-root-ca.crt \
  -noout -subject -dates -fingerprint -sha256
openssl x509 -in certs/generated/sealog-server.crt \
  -noout -subject -issuer -dates \
  -ext subjectAltName,basicConstraints,keyUsage,extendedKeyUsage
```

Confirm the expected SANs, `CA:FALSE`, `Digital Signature, Key Encipherment`, and `TLS Web Server Authentication`. Record the root's SHA-256 fingerprint so the administrator can identify the correct root during trust distribution.

Verify the chain and hostname. Replace the example name with a DNS SAN from your configuration:

```bash
openssl verify -purpose sslserver \
  -verify_hostname logs.example.test \
  -CAfile certs/generated/sealog-root-ca.crt \
  certs/generated/sealog-server.crt
```

If operators use an IP address, check that IP identity as well:

```bash
openssl verify -purpose sslserver \
  -verify_ip 10.0.0.10 \
  -CAfile certs/generated/sealog-root-ca.crt \
  certs/generated/sealog-server.crt
```

Each verification must report `OK`. The hostname/IP options check the requested identity as well as the chain. [OpenSSL verification options](https://docs.openssl.org/3.0/man1/openssl-verify/).

Confirm that the server certificate and key have the same public key; the following two SHA-256 digests must match:

```bash
openssl x509 -in certs/generated/sealog-server.crt -pubkey -noout \
  | openssl pkey -pubin -outform DER | openssl dgst -sha256
openssl pkey -in certs/generated/sealog-server.key -pubout -outform DER \
  | openssl dgst -sha256
```

These checks do not install device trust or establish browser compatibility. Finish the deployed HTTPS and device checks below.

## Install the server certificate

These commands assume a Linux nginx server whose master process can read root-owned files. For a different service account or TLS proxy, adapt ownership and the service command to that installation.

On the workstation, transfer **only the server key and full-chain certificate** to a restricted staging directory. Replace the SSH destination:

```bash
prod='deploy-user@10.0.0.10'
tls_stage=$(ssh "$prod" 'umask 077; mktemp -d "$HOME/sealog-tls.XXXXXX"') &&
scp certs/generated/sealog-server-fullchain.crt \
  certs/generated/sealog-server.key "$prod:$tls_stage/" &&
printf 'TLS files staged on server at: %s\n' "$tls_stage"
```

Stop on a transfer error. Connect to the server with `ssh "$prod"`. In that server shell, first back up the two active files if replacing an existing certificate:

```bash
backup="/srv/sealog-tls-backup-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -m 0700 "$backup"
sudo cp -p /srv/certs/sealog-server-fullchain.crt \
  /srv/certs/sealog-server.key "$backup/"
```

For a first installation, skip that backup command because the files do not exist yet. In the server shell, replace the staging path below with the one printed during transfer, then install the files:

```bash
tls_stage=/home/deploy-user/sealog-tls.XXXXXX
sudo install -d -o root -g root -m 0700 /srv/certs &&
sudo install -o root -g root -m 0600 \
  "$tls_stage/sealog-server.key" /srv/certs/sealog-server.key &&
sudo install -o root -g root -m 0644 \
  "$tls_stage/sealog-server-fullchain.crt" /srv/certs/sealog-server-fullchain.crt
```

The reference [`sealog.conf`](../sealog.conf) points to these files:

```nginx
ssl_certificate     /srv/certs/sealog-server-fullchain.crt;
ssl_certificate_key /srv/certs/sealog-server.key;
```

Install/adapt nginx's configuration as described in [Installation](INSTALLATION.md), then validate and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Do not reload after a validation failure. Correct the error or restore the matching key and certificate from the backup, then validate again. Nginx requires the leaf certificate before any issuer certificates in the configured chain file. [Nginx HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html#chains).

Once HTTPS verification succeeds, remove the two temporary transfer copies from the printed staging directory. Keep protected renewal/rollback material outside the static app directory. Do not copy the entire generated bundle to the server.

## Install device trust

Distribute only the root certificate, normally `sealog-root-ca.cer`, through your organization's approved channel. Confirm its identity with the recorded fingerprint. Operator devices do not need a private key, the server certificate, or the `.p12` export.

### iPhone and iPad

Follow [Install the certificate on an iPhone or iPad](IOS_CERTIFICATE_SETUP.md)
for the complete device procedure and troubleshooting. For an existing
deployment, obtain its current root certificate from the administrator; setting
up a device does not require generating a new CA.

Apple recommends certificate deployment through MDM or Apple Configurator; certificate payloads installed through those methods receive SSL/TLS trust. Manual imports require a separate trust action. [Apple certificate-profile trust](https://support.apple.com/en-us/102390).

1. Download/open the root certificate profile on the device using the approved distribution method.
2. For a manual download, open **Settings → Profile Downloaded**, choose **Install**, and complete the prompts. Managed profiles can be installed by the administrator. [Apple profile installation](https://support.apple.com/en-us/102400).
3. For a manual import, open **Settings → General → About → Certificate Trust Settings** and enable full trust for the intended root certificate.
4. Open the exact HTTPS app address in Safari. It must load without a certificate warning before you add it to the Home Screen.

If the full-trust section is absent, confirm that the certificate profile was installed. Do not clear app site data or uninstall the app to change certificate trust.

### Administrator computers and other devices

On macOS, import the root into the appropriate keychain and configure its SSL trust according to your device policy. [Apple Keychain certificate trust](https://support.apple.com/guide/keychain-access/change-the-trust-settings-of-a-certificate-kyca11871/mac).

For Android, Windows, and managed browser fleets, use the organization's CA-certificate deployment process for the actual device/browser. Menu names and managed-device restrictions vary. Validate the app in that browser after installing the root; a certificate installed only for a Wi-Fi connection is not the app's HTTPS trust test.

## Check the deployed HTTPS address

From the workstation, use the public root certificate to verify HTTPS without changing the workstation's global trust store:

```bash
origin='https://logs.example.test'
curl --fail --show-error --cacert certs/generated/sealog-root-ca.crt \
  "$origin/sealog-a/" -o /dev/null
```

This must succeed without `-k`/`--insecure`. Test each app route you configured. A failed DNS lookup needs a network/DNS fix; a certificate error needs a trust, identity, validity, or served-chain fix.

On one device of each supported type, verify sign-in, GPS permission, a connected capture/sync, and an offline reopen. HTTPS success is necessary for those features, but does not establish backend permissions or physical GPS quality. Continue with [Quick Start](QUICK_START.md) and [field QA](QA_PLAN.md).

## Renewal and troubleshooting

For ordinary renewal under the same root, use your CA tooling with the existing CA key and certificate. This helper has no reuse-root option: changing the prefix, directory, or validity period still creates a new root. It also does not manage revocation or automated renewal. Record expiry dates and the person responsible for renewal when deploying.

`--force` replaces an entire output bundle, potentially including both private keys and the trusted root's identity. Use it only for an intentional CA replacement with a protected backup and a device-trust rollout. A static application update does not require new certificates.

| Symptom | Check |
|---|---|
| `Subject must include a non-empty common_name` | Supply nonempty `ca.common_name` and `server.common_name`. |
| `At least one SAN entry ... is required` | Add the actual hostname to `san_dns` or IP to `san_ips`; common name alone is insufficient. |
| `Refusing to overwrite existing files` | Confirm whether this is renewal. Use existing CA tooling for renewal, or a new directory for an intentional new CA. |
| OpenSSL fails midway | Read the reported command/error, inspect partial output, and retry with corrected input in a fresh directory. |
| Hostname/IP mismatch | Compare the URL host to the SANs, including hostname versus literal IP. |
| Browser still reports untrusted certificate | Check the installed root/fingerprint, manual full-trust setting, leaf EKU, expiry, device clock, and the certificate actually served by nginx. |
| Nginx reports key mismatch or cannot read a file | Verify the public-key digests, leaf-first chain order, paths, and service permissions before reloading. |
