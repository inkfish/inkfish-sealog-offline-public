# Install the certificate on an iPhone or iPad

For deployments using a private certificate authority (CA), each logging device must trust that CA before the app's HTTPS connection, GPS, and offline installation can work correctly. **Installing the certificate profile and enabling full trust are separate steps when installing manually.**

Use this guide for an existing deployment; obtain its current root certificate from IT. You do not need to generate a new certificate to set up a device. If the deployment uses a certificate already trusted by iOS/iPadOS, or IT has installed the root through device management, manual installation may be unnecessary. See [Apple's certificate-trust guidance](https://support.apple.com/en-us/102390).

## Before you start

- Obtain the deployment's **root CA certificate** and its expected certificate name from IT. The repository's certificate helper produces `<prefix>-root-ca.cer`; the supplied template produces `sealog-root-ca.cer`.
- Obtain the app's exact HTTPS address and connect to the network used to reach it.
- Install only the root certificate supplied for this deployment. Logging devices do not need a `.key` file or the `-server.p12` bundle, which contains the server's private key.

## 1. Download and install the profile

1. Open the certificate download link or attachment supplied by IT on the iPhone or iPad. Use the organization's approved transfer method. If prompted to allow a configuration-profile download, tap **Allow**.
2. Open the device's **Settings** app and tap **Profile Downloaded**. This is in iOS/iPadOS Settings, not the Sealog app's Settings.
3. Check that the profile and certificate match the name IT supplied. Tap **Install** in the upper-right corner and follow the onscreen prompts, including the device passcode if requested.
4. Complete the installation before continuing to the trust step below.

Apple removes an uninstalled downloaded profile after eight minutes. If **Profile Downloaded** has disappeared before installation, download the profile again and install it promptly. See [Apple's profile-installation instructions](https://support.apple.com/en-us/102400).

## 2. Enable full trust for the root certificate

1. Open **Settings → General → About → Certificate Trust Settings**.
2. Under **Enable Full Trust for Root Certificates**, find the root certificate whose name IT supplied.
3. Turn on its trust switch and confirm the prompt.

Manually installing a profile does not automatically enable SSL/TLS trust. Certificates deployed through Apple Configurator or MDM receive that trust through the deployment mechanism; check with IT before changing a managed device. See [Apple's manual certificate-trust instructions](https://support.apple.com/en-us/102390).

## 3. Verify the app

1. Open the supplied HTTPS address in Safari. It should load without a certificate warning; use the same hostname or IP address IT supplied.
2. Reload or reopen the app after changing trust. Allow location access when requested and check that it can obtain GPS.
3. Follow [Quick Start](QUICK_START.md#1-open-the-app) to finish loading the app, add it to the Home Screen if wanted, and verify an offline reopen. Certificate trust alone does not prove that the worker installed successfully.

Keep existing browser data and the installed PWA when correcting certificate trust. Clearing site data or uninstalling the app can remove unsynced events.

## If something is missing or still fails

- **No Profile Downloaded entry:** the download may have expired or the profile may already be installed. Installed profiles appear under **Settings → General → VPN & Device Management**. See [Apple's profile-management guide](https://support.apple.com/guide/iphone/iph6c493b19/ios).
- **No root listed under Certificate Trust Settings:** finish profile installation first and check that IT supplied the root CA certificate. On managed devices, ask IT to verify deployment and trust.
- **Profile installation is blocked:** follow IT's device-management procedure and [Apple's current installation guidance](https://support.apple.com/en-us/102400).
- **Safari still shows a certificate error:** ask IT to check the installed root, server certificate expiry, certificate chain, and whether the address matches the server certificate. Enabling root trust does not fix an expired certificate or the wrong server address.
- **Safari works but GPS or offline opening fails:** check location permission and let the app load fully online, then follow [Troubleshooting](TROUBLESHOOTING.md). These features have requirements beyond certificate trust.

For administrators creating or replacing the CA, see the separate [private CA certificate workflow](cert-generation.md). An ordinary app update does not require a new root certificate or repeating these steps unless the deployment's trust configuration changes.
