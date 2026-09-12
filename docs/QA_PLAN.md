# QA Field Test Plan

Mark each scenario ✔ pass / ✖ fail / △ blocked. Capture screenshots of status messages or modals for the test log.

Record the app and worker versions (both `v1.2.0.9` for this release), browser/OS, deployment URL, and whether the browser tab or installed app is under test. Cover at least one iPhone and one Android. Use a disposable test profile for first-run/reset scenarios; do not clear production site data or uninstall an app holding unsynced events.

Use a staging Sealog server and test account for captures, edits, clears, and forced responses. For each failure, record the scenario number, UTC time, exact message, and affected `localId`/`serverId` from the CSV when available. Do not attach credentials or session tokens. Compare server results using the same account and cruise as the test.

Run installation/offline loading, capture/sync, export, and settings checks on both device platforms. The Device column identifies the primary target for the remaining checks; browser automation in [Testing](TESTING.md) complements these field checks but does not establish physical GPS or installed-app behavior.

## Install + theme

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 1 | First-run install | iPhone Safari | In a fresh test profile, browse to the trusted HTTPS vessel app URL → Add to Home Screen → launch it and wait for worker control → disable network and reopen | Both version labels show v1.2.0.9 and the installed vessel app reopens offline. Settings prompts sign-in; closing Settings allows manual capture while signed out. The deployment chooser is not the installed page. | ☐ |
| 2 | First-run install | Android Chrome | In a fresh test profile, open the trusted HTTPS vessel app URL → install through the browser menu or offered prompt → launch, complete loading, disable network and reopen | Same offline behavior as 1. Check the browser tab and installed app separately; do not assume storage is shared between launch modes. | ☐ |
| 3 | Theme picker - manual | iPhone | Settings → Theme → tap Light / Honey / Ocean | Each preset applies and persists after reload. Crossfade is used only when supported and reduced motion is not requested. | ☐ |
| 4 | Theme picker - system follow | iPhone | With no saved preset in the test profile, toggle iOS Light/Dark while the app is open; then choose Honey and toggle the OS appearance again | Without a saved choice, app follows Light → Light, Dark → Ocean. After a manual choice it stays Honey. No crossfade on initial boot. There is no separate accent picker. | ☐ |
| 5 | Settings accordions | iPhone | Open Settings in a profile with no saved accordion choices | Data + Theme start open; Auto-fill rules starts closed. Toggle them and reload: saved states return. Account remains a plain section. | ☐ |

## GPS

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 6 | GPS modal | iPhone | Obtain a fix → tap GPS status tile → close it with X and by tapping the overlay; repeat after opening another settings dialog, then while signed out and offline | Modal shows coordinates, accuracy, fix age, any warning, and **Allow logging when GPS accuracy is poor** for all new device GPS logging. The toggle remains usable offline and while signed out. Closing it restores page scrolling without disturbing another open dialog's scroll lock. | ☐ |
| 7 | GPS denied | iPhone | In a fresh profile with no cached fix, deny location → log with a GPS auto-fill template, then with Freeform Note | GPS error is visible and GPS-rule capture fails; non-GPS capture succeeds. A required manual field still needs its value. | ☐ |
| 8 | GPS low accuracy | iPhone | Obtain a fresh fix with accuracy above 50 m → capture with a GPS template, fill an empty GPS field on edit, and run automatic ASNAP; repeat with the override on | With the override off, each attempt to record new device GPS is blocked or paused. With it on, each accepts the less accurate fix and a warning remains visible on the capture page and GPS dialog. | ☐ |
| 39 | Override warning and persistence | iPhone | Enable the override → close GPS → improve the fix → reload → reopen GPS → turn the override off | The choice survives reload. The warning remains visible while enabled, including with an accurate fix, and disappears when disabled. | ☐ |
| 40 | Invalid or stale GPS | iPhone | With the override enabled, try recording a missing fix, invalid coordinates, unknown accuracy, and a cached fix older than five minutes | Every case is rejected for capture, empty GPS fields on edit, and automatic ASNAP; the override relaxes only the 50 m accuracy limit. Use browser GPS simulation where needed. | ☐ |
| 41 | Operations without new device GPS | iPhone | With no usable fix and the override off, capture Freeform Note, edit an event while retaining saved GPS, and sync an event using server backfill | Notes-only capture and the edit succeed without new device GPS. Server backfill follows its own availability rules and is unaffected by the override. | ☐ |
| 42 | GPS tile and backfill display | iPhone | With backfill off, obtain a fresh fix between 30 m and 50 m accuracy → check the GPS tile → enable backfill; repeat with a location permission or sensor error | Above 30 m the normal tile says "GPS fix low accuracy" while the fix remains within the logging limit. Backfill replaces ordinary GPS tile text with its backfill status; sensor errors still remain visible. | ☐ |

## Auto-fill rules

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 30 | First-use GPS defaults | iPhone | With no saved rules, select a coordinate template and log before opening Manage rules; repeat with built-in Freeform Note (GPS), then inspect rules | Latitude/Longitude auto-fill on the first capture without Save or Refresh Templates. Manage rules shows matching on-log defaults; configuring one mode disables the other. | ☐ |
| 31 | Auto-fill on log | iPhone | Type an unrelated field value and clear a default checkbox; set "Time In" to "Current time" on log → Save → log without changing template or refreshing | The saved rule takes effect immediately. Unrelated typed values and cleared checkboxes remain unchanged; Time In receives the capture-time UTC value. | ☐ |
| 32 | Fill-if-empty preservation | iPhone | Configure Current time On edit. Edit one event with a filled field and one with an empty field; change the event timestamp before saving | Filled option is preserved. Empty option receives the edit-save UTC time, independent of the event timestamp. Rule-controlled fields display as automatic/read-only. | ☐ |
| 33 | Durable de-selection | iPhone | Manage rules → clear one GPS rule → Save, then clear all → Save → reload and refresh templates; also change a rule and Cancel | Explicit None choices remain cleared, including partial/empty configurations. Capture fields change immediately on Save. Cancel leaves the saved rules and active capture behavior unchanged. | ☐ |

## ASNAP

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 9 | ASNAP modal | iPhone | Tap ASNAP status tile | Modal opens. Logger toggle, interval picker, list-visibility, backfill toggle + allowlist all present. The poor-accuracy setting is in the GPS dialog. | ☐ |
| 10 | ASNAP capture | iPhone | Sign in, obtain usable GPS, enable ASNAP at 5 minutes, enable list visibility, choose All or ASNAP, and keep the app open | A snapshot appears, followed by another at the configured interval. Expand: detail says "Automated GPS snapshot logged by the device." No Edit/Delete. Turning list visibility off hides records without deleting them or changing the queue count. | ☐ |
| 11 | ASNAP backfill | iPhone | Enable backfill → enter a fixture event type value in the allowlist → log it with a template that can be completed without local GPS → reconnect → sync; then clear the allowlist and reload | Vehicle and vessel coordinates are resolved from server telemetry before upload. Missing required points keep the event queued with a backfill warning. A deliberately cleared allowlist stays empty after reload and applies to all eligible ordinary event types; device ASNAP is excluded. | ☐ |

## Capture + sync

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 12 | Airplane mode capture | Both | Disable cellular and Wi-Fi so the device reports offline → log 2 events | Status flips offline. Pending and total counts increase by two. No event upload requests are sent while offline. | ☐ |
| 13 | Power cycle mid-run | Both | While offline, log 2 events → close/reboot → reopen the same installed app or browser/profile and choose All | Events, notes, timestamps, and pending state persist. A fresh connection may resume syncing; an event leaving Local after confirmation is not data loss. | ☐ |
| 14 | Reconnect + sync | iPhone | After 12, disable Airplane Mode → tap Sync | Eligible queued events sync; the pending count reaches zero after confirmation and any required auxiliary uploads. Server timestamps and notes match the local events. | ☐ |
| 15 | 401 mid-sync | iPhone | Expire token server-side → tap Sync | Sync halts on 401. Account prompts re-sign-in. Queue retained. | ☐ |
| 16 | Duplicate event (409) | iPhone | Force duplicate response | If lookup resolves the existing ID, the event is confirmed after required auxiliary work. If lookup cannot resolve it, the event remains queued with an error rather than silently disappearing. | ☐ |
| 17 | Edit unsynced event | iPhone | While offline, log event → expand → Edit → change note → Save | Card shows the updated note and remains queued. After reconnecting, the POST contains the edited note. | ☐ |
| 18 | Edit synced event → PATCH | iPhone | Sync event → expand → Edit → change note → Save → choose Patch on Next Sync → wait for sync | Edit is queued as a patch and finishes Synced; intermediate chips may change quickly. Server reflects the new note without adding a second event. | ☐ |
| 19 | Verify-pending recovery | iPhone | Force POST to succeed without returning ID | If immediate lookup also lacks an ID, the event enters "Confirming". A later `fulltext` query with one exact `client_uuid` option match resolves the server ID; any pending auxiliary uploads finish before confirmation. Failed or unmatched lookups stop after six attempts, and duplicate matches require review. | ☐ |
| 34 | Manual verification after a stall | Staging browser | Let a fixture event reach Verify stalled → make one exact server UUID match available → tap the regular Sync queued events button | Existing record is confirmed and required auxiliary work completes. The normal sync button does not force another POST. Force Re-Post remains a separately confirmed recovery action. | ☐ |
| 35 | Interrupted request recovery | Staging browser | Hold a POST or PATCH response, close the page while its record says Syncing/Patching, then reopen the same profile | Startup requeues the interrupted request, keeps captured fields, and resumes work. A known server ID is retained for patching; UUID lookup protects a previously accepted POST from needless duplication. | ☐ |

## Data tools

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 20 | CSV export | Both | In an empty test store, log 2 ordinary events and 1 ASNAP → hide ASNAP and select Local → tap Export CSV → save or share the download | `sealog_offline_export.csv` contains all three rows regardless of filter/visibility. Headers match the CSV schema in [Architecture](ARCHITECTURE.md); payload contains options. Quoted/multiline notes parse correctly, and payload/revisions parse as JSON. The original queue remains intact. | ☐ |
| 21 | Load Sealog Events | Both | Seed server fixtures for the signed-in author and another author, inside/outside the latest cruise window → Settings → Data → Load Sealog Events → choose All | Modal reports imported or unchanged records. Only the signed-in author's matching cruise records appear. There is no cruise picker; the latest returned cruise supplies the window. Local excludes imported synced rows. | ☐ |
| 22 | Clear Cached Events | iPhone | Sync events → Settings → Data → Clear Cached Events… → confirm | Synced cards disappear. Unsynced events stay. | ☐ |
| 23 | Refresh Templates | iPhone | Settings → Data → Refresh Templates | Status reports `Templates updated (N)`. Template list matches eligible backend templates; saved rules remain unchanged and new unconfigured GPS templates receive defaults. | ☐ |
| 36 | Re-import preserves local work | Staging browser | Import a server event whose notes contain literal JSON → change the server note and load again → edit locally while offline → reconnect and load again before patching | JSON text remains notes, not parsed metadata. Loading changed server contents refreshes one existing synced row. Pending local edits are not overwritten by the import. Completed backfill coordinates remain when the server omits coordinate options. | ☐ |

## Update flow

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 24 | Update modal | iPhone | In disposable staging only, serve a controlled worker/app fixture with a different reported version → trigger an update check | After installation, the centered modal offers Reload now. Accepting reloads the page; app and worker labels agree on the staged fixture. Existing events/settings remain, and a subsequent offline reopen succeeds. The delivered release remains v1.2.0.9. | ☐ |
| 25 | Update modal - "Not now" | iPhone | Update modal appears → tap Not now | Modal dismisses and the same reported version is suppressed for this page session. A different reported version can prompt again. | ☐ |
| 26 | SW update trigger - visibility | iPhone | Serve the staging update fixture from 24 → background the app → return | Foregrounding triggers an update check, subject to the 10-second check throttle. After installation, the different version is offered; no fixed download time is guaranteed. | ☐ |
| 27 | SW update trigger - reconnect | iPhone | Serve the staging update fixture from 24 → restore network connectivity | Reconnection triggers a check while online. After installation, the different version is offered. | ☐ |
| 37 | Same-version replacement | Staging browser | Replace served files with a controlled test fixture that still reports v1.2.0.9 → reconnect and reload using [Manual Update](MANUAL_UPDATE.md) | Do not require a new-version prompt. Verify served file contents and the fixture's actual behavior; matching app/sw labels alone cannot identify which same-version snapshot loaded. Preserve the queue and test offline reopening. | ☐ |

## Misc

| # | Scenario | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| 28 | iOS auto-zoom | iPhone | Tap any text input | No page zoom. Inputs render at 16px. | ☐ |
| 29 | Guest mode | iPhone | Sign out → Continue as guest → log event → sync | Guest login succeeds only if the server permits the guest account with an empty password. A successful login obtains a token; events sync with that account's permissions. | ☐ |
| 38 | Watch change and deployment isolation | Staging browser | Log an offline test event as one user → sign out and sign in as another → inspect the queue without uploading; then inspect another vessel path on the same origin | Signing out preserves the same queue. Paths on one origin share events/account/settings; they are not isolated user or vessel stores. Verify the deployment's documented separate-origin/profile arrangement before field use. | ☐ |

## Notes

- Scenario 10 needs sign-in and device GPS. Scenario 11 needs server-side vehicle and vessel telemetry bracketing the event timestamp.
- For scenarios 30-33, exercise both cached/server templates and fallbacks. Preserve any saved edit-only or partial configuration when server templates refresh or return under a different ID with the same event value.
- Scenarios 16, 19, and 34-37 need controlled server/browser fixtures; use the E2E examples in [Testing](TESTING.md) as a starting point. Do not force failures on a live operational server.
- Scenarios 24-27 use distinct reported versions only in disposable staging fixtures. Scenario 37 covers replacement while retaining v1.2.0.9. Periodic checks run every five minutes; configured vessel paths are required for worker registration.
- Scenarios 6, 8, 9, and 42 cover the tile-as-button + diagnostic modal pattern. Scenarios 39–41 cover override persistence, invalid/stale fixes, and operations that do not record new device GPS. Use controlled browser GPS fixtures when physical conditions cannot be reproduced; repeat ordinary capture/edit checks offline and while signed out, and sign in for automatic ASNAP.
- Attach expected-versus-observed results for blocked/failed checks. A fixture limitation, unavailable physical GPS condition, or inaccessible server should be marked blocked with its reason, not passed.
