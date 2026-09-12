# Documentation Index

Sealog Offline Logger records research-vessel events on a device and syncs them to Sealog Server when it can connect. Start with the guide for the work you need to do.

## Pick your starting point

| If you are… | Read this |
|---|---|
| **An operator** logging events on a vessel | [`QUICK_START.md`](./QUICK_START.md) - daily workflow |
| **An iPhone/iPad user** setting up a private CA certificate | [`IOS_CERTIFICATE_SETUP.md`](./IOS_CERTIFICATE_SETUP.md) - install the profile and enable full trust |
| **A watch lead** triaging a stuck device | [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) - GPS, auth, sync, storage |
| **A QA tester** running a field check | [`QA_PLAN.md`](./QA_PLAN.md) - scenario matrix |
| **A developer** onboarding to the code | [`ARCHITECTURE.md`](./ARCHITECTURE.md) - modules + data flow |
| **A contributor** reporting a bug or proposing a change | [`CONTRIBUTING.md`](../CONTRIBUTING.md) - issues, pull requests, and relevant checks |
| **A security researcher** reporting a suspected vulnerability | [Private reporting guidance](./SECURITY.md#reporting-a-vulnerability) |
| **A developer** integrating with the backend | [`SPECIFICATION.md`](./SPECIFICATION.md) - Sealog Server API contract |
| **An administrator** setting up a new host | [`INSTALLATION.md`](./INSTALLATION.md) - prerequisites, certificates, nginx, installation, and device checks |
| **An administrator or developer** adapting the app | [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) - names, routes, backends, themes, icons, and template defaults |
| **An administrator** updating a working host | [`MANUAL_UPDATE.md`](./MANUAL_UPDATE.md) - copying the runtime bundle, backup, and rollback |
| **A release manager** preparing a release | [`RELEASE.md`](./RELEASE.md) - validate, package, and publish |
| **A security officer** doing a review | [`SECURITY.md`](./SECURITY.md) - storage, sessions, and deployment |

## First installation: reading order

1. [Customization](CUSTOMIZATION.md): choose the device address and backend, and make any app changes.
2. [Certificate generation](cert-generation.md): create a private CA only if needed, verify the server certificate, and plan device trust.
3. [Installation](INSTALLATION.md): install runtime files and certificates, configure nginx, and check real devices.
4. [Quick Start](QUICK_START.md): give operators their daily workflow.

The installation guide links to [Manual updates](MANUAL_UPDATE.md) for the actual
static-file transfer. Use that same procedure for later updates. Certificate
renewal is a separate operation and is not needed for every app update.

## Developer quick reference

- **No build step.** A basic HTTP server can preview the UI at the repo root. Full offline testing also needs a supported vessel path; see [`TESTING.md`](./TESTING.md).
- **HTTPS for devices.** Production GPS and offline installation require a trusted HTTPS origin. Use [iPhone/iPad certificate setup](./IOS_CERTIFICATE_SETUP.md) to install and trust an existing private CA on a device, or [certificate generation](./cert-generation.md) to establish a new CA.
- **Storage and API configuration.** Start with [`CUSTOMIZATION.md`](./CUSTOMIZATION.md). Paths under the same origin share queues, credentials, and preferences; they do not isolate vessel data. [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains the implementation.
- **Versions.** The app and worker use matching version constants. Follow [`RELEASE.md`](./RELEASE.md) to update the package, worker, and published release together.
- **Server setup.** The repo supplies static app files and an nginx example, not an automated server installer. [`INSTALLATION.md`](./INSTALLATION.md) walks through the complete setup and separates workstation commands from server commands.
- **Existing HTTPS infrastructure.** The nginx example hosts the app over HTTPS and proxies API requests to HTTP backends. Another host can replace it if it provides compatible HTTPS, routes, and API access; see the [deployment choices](./MANUAL_UPDATE.md#when-existing-https-can-simplify-installation) and [HTTPS deployment review](./HTTPS_DEPLOYMENT_REVIEW.md).

## File map

| File | Audience |
|---|---|
| [`QUICK_START.md`](./QUICK_START.md) | Operators |
| [`IOS_CERTIFICATE_SETUP.md`](./IOS_CERTIFICATE_SETUP.md) | Operators and IT - iPhone/iPad private CA installation and full trust |
| [`INSTALLATION.md`](./INSTALLATION.md) | Administrators - first installation and device acceptance |
| [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) | Administrators and developers - deployment and interface customization |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Watch leads |
| [`QA_PLAN.md`](./QA_PLAN.md) | QA |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Developers |
| [`SPECIFICATION.md`](./SPECIFICATION.md) | Developers |
| [`TESTING.md`](./TESTING.md) | Developers |
| [`RELEASE.md`](./RELEASE.md) | Release managers |
| [`MANUAL_UPDATE.md`](./MANUAL_UPDATE.md) | Administrators - installation, updates, and rollback |
| [`HTTPS_DEPLOYMENT_REVIEW.md`](./HTTPS_DEPLOYMENT_REVIEW.md) | Administrators and developers - HTTPS hosting, proxy alternatives, and route constraints |
| [`SECURITY.md`](./SECURITY.md) | Security officers |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributors - bug reports, feature suggestions, and pull requests |
| [`cert-generation.md`](./cert-generation.md) | Administrators - private CA workflow |
| [`../sealog.conf`](../sealog.conf) | Administrators - reference nginx routing for three vessels |
| [`../scripts/`](../scripts/) | IT & developers - certificate setup, asset generation, screenshots, and test tools |
| [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | Third-party source and license notices |
