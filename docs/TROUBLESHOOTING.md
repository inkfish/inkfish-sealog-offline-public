# Troubleshooting

This guide covers **v1.2.0.9**. Read the status tiles and the message below **Recent Events** first. Open **Settings** to check the signed-in account and the **app** and **sw** version labels.

**Keep device data intact while troubleshooting.** Unsynced events exist in the browser/profile that captured them. Do not clear browser site data, delete its database, or uninstall the app to fix a display or update problem. The **Export CSV** button beside Recent Events can save a copy of those stored records. The app does not provide CSV import or restore, so an export is not a reason to delete the original queue.

## GPS and time

**GPS says “low accuracy” or “No GPS fix”**

Move to a clearer view of the sky and keep the app open. Tap the GPS tile to inspect coordinates, accuracy, and fix age. The app periodically requests a fix while visible; a new fix may take longer indoors or under cover.

Recording a new device GPS fix requires accuracy of 50 metres or better by default. To accept a less accurate fix, enable **Allow logging when GPS accuracy is poor** in the **GPS** dialog. This affects event capture, GPS auto-fill into empty fields during editing, and automatic ASNAP logging. The control is available offline and while signed out.

**The poor-accuracy warning stays visible after GPS improves**

The override warning on the capture page and in the GPS dialog stays visible until you turn the setting off, even if the current fix is accurate. If you turn it off while accuracy is worse than 50 metres, a different message explains that recording new device GPS is blocked. The override never accepts missing fixes, invalid coordinates, unknown accuracy, or fixes more than five minutes old.

**GPS reports a location permission error**

Check that location services are enabled and that the browser or installed app has permission for this site. After changing permission, reload the app and try again. If the address is not HTTPS or the browser shows a certificate warning, ask IT to check the deployment.

For an iPhone or iPad using the deployment's private CA, follow [certificate installation and full trust](IOS_CERTIFICATE_SETUP.md); downloading the certificate alone is insufficient.

**The fix is stale**

Bring the app to the foreground while you have a clear view of the sky. Check whether the fix age updates. A capture with GPS auto-fill requests a location fix, but the app can use a cached fix if the new request fails. The cached fix must still meet the GPS policy: a fix more than five minutes old is rejected even with the poor-accuracy override enabled.

**Capture fails because GPS or a required value is missing**

Read the failure message and check the selected template. A field configured for GPS auto-fill needs a usable fix, even if the template does not otherwise mark that field as required. Fields without auto-fill may need manual entry. Notes-only capture and edits that retain saved GPS values do not need a new fix. Sealog server backfill uses server coordinates and is unaffected by the device GPS setting.

**Latitude or Longitude does not auto-fill**

Open **Settings → Auto-fill rules → Manage rules…**, choose the template, and inspect that field's **On log** source. New configurations receive defaults for recognized GPS names, but saved choices are preserved. A source of **—** means no auto-fill; a source set only **On edit** does not fill at capture time. Choose the intended source and tap **Save**; it applies immediately.

Fields named exactly `lat` or `lon` are not recognized for automatic defaults. Their sources can still be selected explicitly. The built-in **Freeform Note (GPS)** template receives its defaults without opening or saving the rules dialog first.

**An edit did not replace the old GPS or time value**

Edit rules fill empty fields and preserve existing values. **Current time** uses the clock when you save the edit, not the event's timestamp field. Rule-controlled fields are read-only in the editor. To correct one manually, cancel the edit, clear its **On edit** source in Manage rules, save the rules, and reopen the event. Restore the rule afterward if it is still needed for future edits.

**Event times look wrong**

Event timestamps use the device's clock and are shown in UTC. Check the device's date and time settings, including automatic time if available. Use **Edit** to correct an ordinary event and sync the change afterward.

## Sign-in and connection

**“Sealog Online” is shown, but syncing fails**

The tile reflects the device's network status. It does not confirm that the Sealog server is reachable. Check that you are on the correct ship network, read the sync error, and contact IT if the server is unavailable.

**The app asks you to sign in, or a request returns 401**

Open **Settings → Account** and sign in again while connected. The saved session may have expired or been rejected by the server. Retry syncing after sign-in succeeds.

**Continue as guest fails**

The server must provide a guest account and allow the requested operation. Use your assigned account or ask IT to check guest access.

**The previous operator is still signed in**

Review and sync the previous operator's queue when possible, then use **Settings → Account → Sign out** and sign in as the current operator. Existing events remain stored in the same queue. Sync requests use the account signed in at the time of upload; signing out does not divide saved events into separate operator accounts.

**A device is lost**

Notify IT so it can address the account's access. Synced records remain on Sealog Server; unsynced records cannot be exported from another device. If the original device is recovered, preserve its site data and export or sync from that device.

## Templates

**The template list is wrong or stale**

While signed in and connected, choose **Settings → Data → Refresh Templates**. Close Settings to read the result below Recent Events. A successful refresh reports the template count and time.

**A server template does not appear**

Check the selected Category. Ask IT to confirm that the template is available to this app; disabled and administrator-only templates are excluded, and each template needs a non-empty string ID. Refreshing templates replaces the current cached template set; it does not delete saved events.

**Only the built-in templates are shown**

The app uses a small built-in set when server templates are unavailable, and after signing out. Sign in and refresh templates. A previously loaded server template set can remain available while offline.

## Queue, syncing, and storage

**The total queue count never reaches zero**

Synced events stay on the device for review. Watch the **pending** count to see outstanding work; the **total** count includes synced records. To remove synced copies, use **Settings → Data → Clear Cached Events…** and read the confirmation. Pending records remain on the device.

**Events remain pending**

Expand an affected event and read its status and any error. Confirm sign-in and server connectivity, then use **Sync queued events** beside Recent Events. Network failures retry automatically. Backfill and verification can keep a record pending even when other events sync successfully.

**An edited event says “Patch queued”**

Its change is waiting to reach the server. Try syncing and inspect the result. If it reports a failure, send that message to IT. An event that has never synced is uploaded as a new record with its current edits.

**An event says “Confirming” or “Verify stalled”**

**Confirming** means the app is checking the server for the event's unique client identifier. It waits for one matching record and any required auxiliary upload before marking the event synced. Automatic checks stop after six failed/unmatched attempts; multiple matching records stop verification for review immediately.

When connectivity or server access is restored, tap the regular **Sync queued events** button. It checks stalled events again without forcing a new POST. If the event still says **Verify stalled**, ask the watch lead or IT to check the server. **Force Re-Post → Re-Post Anyway** queues another upload and may create a duplicate; it is not the routine retry button.

**An event was “Syncing” or “Patching” when the app closed**

Reopen the same app page. Startup requeues interrupted requests while preserving their event data, and resumes eligible work when signed in and online. Review the event under **Pending** and inspect any new error. Avoid entering a duplicate event just because the previous request was interrupted.

**An event disappears from Local after syncing**

Choose **All** or **Synced**. Local shows ordinary events that do not yet have a server record. ASNAP visibility is controlled separately in the ASNAP dialog.

**The CSV is missing records**

Export includes all records stored in the current browser/profile, including hidden ASNAP records, regardless of the list filter. Confirm you are using the original app address and browser or installed app. Records captured only elsewhere must be synced there first; **Load Sealog Events** then imports only the signed-in author's records for the current cruise window. It does not retrieve every user's records.

**Records or settings appear under another vessel page**

Vessel paths on the same scheme, host, and port share browser storage. They can share the queue, sign-in, templates, and preferences despite having separate offline workers. Return to the assigned vessel page and contact IT before syncing uncertain records. Separate devices/browser profiles or separate web origins are needed for isolated stores; see [Installation](INSTALLATION.md).

**The device is running low on storage**

Export a copy of its records, then use **Settings → Data → Clear Cached Events…** to remove synced copies. Do not clear site data to make space while unsynced records remain. Ask IT for help if storage is still exhausted.

**Load Sealog Events imports nothing**

Read the result dialog. Confirm sign-in, the correct vessel address, and records for your signed-in author in the cruise window. The app chooses the latest cruise returned by the server, uses its start time and stop time (or the current time), and offers no cruise picker. It also skips unchanged records already cached, so zero new imports can be normal. Imported events appear under **All** or **Synced**. Ask IT to check server access and cruise metadata if the result reports an error.

## ASNAP logging and backfill

**ASNAP is off or paused**

Tap the ASNAP tile and check **Enable automatic ASNAP logging** and sign-in. Tap **GPS** to inspect the fix and find **Allow logging when GPS accuracy is poor**. Automatic ASNAP uses the same device GPS policy as ordinary capture: accuracy must be 50 metres or better unless the override is enabled, and a valid fix with known accuracy no more than five minutes old is always required. Keep the app open: the browser or device may suspend background logging. Also enable **Show ASNAP events in the list** and choose **ASNAP** or **All** to see the captured records.

**An event is held for ASNAP backfill**

Open the ASNAP dialog and check the backfill setting and allowlist. For affected event types, syncing waits until the required server position data is available. Ask IT to confirm that appropriate ASNAP records bracket the event time. A normal network retry cannot supply missing source data.

The allowlist matches event type values or template IDs, not display labels; separate entries with lines or commas. Backfill happens during sync and cannot supply a GPS auto-fill field at capture time. If Log Event fails for lack of GPS, review the capture rules separately.

**An event syncs without backfill**

Check whether backfill is enabled and whether the event type matches the allowlist. Events outside the list are not required to wait for backfill; an empty list applies to all eligible event types. A record may also already have the required backfilled position data.

IT can check the required server responses in the [API specification](SPECIFICATION.md) and inspect failed browser network requests and server logs. This repository does not include operational repair scripts.

## Offline loading and updates

**The app will not open offline**

Reconnect to the ship network and open the same vessel address used previously. Let the app finish loading, accept any update prompt, and check that the Settings **app** and **sw** versions both show **v1.2.0.9** for this release. Then test an offline reopen. Use the vessel app page, not the deployment chooser. If it still fails, give IT both version labels and the address; preserve site data.

If **sw** says **inactive**, the page may be outside a configured vessel path. If it says **registration failed** or **unsupported**, ask IT to check the browser, HTTPS trust, worker URL, and served files using [Installation](INSTALLATION.md). Opening an HTML file directly is not an offline installation.

**No update prompt appears**

An update must first be deployed to the ship's web server. While connected, bring the app to the foreground or wait for the next periodic check, which runs every five minutes while online. The prompt compares release version strings: replacing files while retaining the same version does not guarantee a prompt. If IT confirms an update is deployed but it does not arrive, use [Manual Update](MANUAL_UPDATE.md) to check the served files and reconnect/reload procedure.

**App and sw versions differ, or both stay old**

Reload while connected and check again. If the mismatch remains, report both labels to IT. The administrator should verify that all app files and the worker came from the same release and are served with the correct cache headers; see [Manual Update](MANUAL_UPDATE.md). Matching labels alone cannot distinguish two deployments that reused the same version string.

## Display and controls

**A section or button is missing**

Expand the relevant Settings section and check the app version. If the display appears incomplete, reload while connected. A missing control can also depend on the selected event or setting: ASNAP records are read-only, and the ASNAP filter requires its visibility option to be enabled.

**Buttons do not respond to gloved taps**

Check that the gloves work with the device's touchscreen and that the screen is clean. Increasing pressure does not make ordinary gloves work with a capacitive screen.

## What to send IT

Include the vessel/app address, browser/OS and whether it is an installed app, the **app** and **sw** versions from Settings, the exact status or error text, and the affected event's UTC timestamp and type. Describe whether the device was connected and whether other events still sync. If requested, export CSV from the affected browser/profile and transfer the file through your usual support channel. Include the affected row's `localId` or `serverId` when available; do not send passwords or session tokens.
