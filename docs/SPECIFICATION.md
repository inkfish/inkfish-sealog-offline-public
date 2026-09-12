# Sealog Server API - Offline Logger Integration

The requests and response fields used by the v1.2.0.9 Offline Logger PWA. This is the client contract derived from [`app.js`](../app.js) and [`src/events/event-transform.js`](../src/events/event-transform.js), not a complete server API specification or a claim that every server release supports it. Verify the deployed server's schemas and permissions at its `/documentation` endpoint and exercise the [field QA checks](QA_PLAN.md).

Use [Installation](INSTALLATION.md) for hosting and [Customization](CUSTOMIZATION.md) for API-root and deployment-route changes.

**Base URL examples**

| Environment | URL |
|---|---|
| Reference Deployment A route | `https://<lan-host-or-ip>/sealog-a/sealog-server` |
| Reference Deployment B route | `https://<lan-host-or-ip>/sealog-b/sealog-server` |
| Reference Deployment C route | `https://<lan-host-or-ip>/sealog-c/sealog-server` |

Local deployments should sit behind an HTTPS reverse proxy so the PWA can call the API from the same secure origin.

The curl examples below run from an administrator's terminal against a test
deployment. Set `BASE` to your API root and `TOKEN` to the token returned by a
successful login before running authenticated examples. They are shell variables,
not app configuration. For a private CA that curl does not already trust, add
`--cacert /path/to/sealog-root-ca.crt` to each request; use the public root
certificate from [certificate setup](cert-generation.md). POST and PATCH examples
write server records, so use a designated test account and cruise.

---

## Endpoints at a glance

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | none | Exchange credentials for a JWT |
| `GET` | `/api/v1/cruises` | Bearer | List cruises |
| `GET` | `/api/v1/event_templates` | Bearer | Fetch templates (cache for offline) |
| `GET` | `/api/v1/events` | Bearer | Query events by `author`, `startTS`/`stopTS`, `fulltext`, or `value` |
| `GET` | `/api/v1/events/bylowering/{id}` | Bearer | Fetch events for a specific lowering |
| `GET` | `/api/v1/events/bycruise/{id}` | Bearer | Fetch events for a specific cruise |
| `POST` | `/api/v1/events` | Bearer (create permission) | Create an event |
| `PATCH` | `/api/v1/events/{id}` | Bearer (edit role) | Update an event |
| `GET` | `/api/v1/lowerings` | Bearer | List lowerings for dive window resolution |
| `GET` | `/api/v1/event_aux_data/bylowering/{id}` | Bearer | Query vehicle position telemetry (`datasource=vehiclePosition`) |
| `GET` | `/api/v1/event_aux_data/bycruise/{id}` | Bearer | Query vessel position telemetry (`datasource=vesselPosition`) |
| `POST` | `/api/v1/event_aux_data` | Bearer | Upload backfilled position auxiliary data entries |


All `/api/v1/...` paths are relative to the resolved API root. Include the JWT on authenticated calls: `Authorization: Bearer <token>`. Diagnostic forwarding uses a separate same-origin path, described below.

---

## Login

`POST /api/v1/auth/login`

**Headers**

- `Content-Type: application/json`

**Body**

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

**200 response**

```json
{
  "token": "<JWT_STRING>",
  "id": "<userId>"
}
```

**Curl**

```bash
BASE="https://your-sealog-host/sealog-a/sealog-server"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"guest","password":""}' \
  "$BASE/api/v1/auth/login"
```

The client stores the response `token` under localStorage `jwt`, the entered username under `username`, and an optional response `id` under `userId`. It clears the password field after successful login. A successful response without a token is treated as an error. Guest sign-in calls the same endpoint with username `guest` and an empty password, so it depends on a matching server account.

The client does not implement server-side token expiry, revocation, or role assignment. Confirm those policies with the server administrator; see [Security](SECURITY.md) for the client's storage and sign-out behavior.

---

## Get cruises

`GET /api/v1/cruises`

**Headers**

- `Authorization: Bearer <token>`

The client sends no cruise query parameters. It sorts returned cruises by start time, selects the latest, and stores its `id` plus `start_ts`/`stop_ts` timestamps. This is a client selection rule, not a server-side active-cruise query.

**200 response (example shape)**

```json
[
  {
    "id": "64fd...",
    "cruise_id": "DEMO-001",
    "ship": "R/V Example",
    "start_ts": "2025-03-01T00:00:00Z",
    "stop_ts": "2025-03-28T00:00:00Z",
    "description": "Demo cruise"
  }
]
```

**Curl**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/cruises"
```

---

## Get event templates

`GET /api/v1/event_templates`

**Headers**

- `Authorization: Bearer <token>`

**200 response (example shape)**

```json
[
  {
    "id": "65ab...",
    "event_name": "CTD Start",
    "event_value": "CTD_START",
    "event_options": [
      {
        "event_option_name": "Station",
        "event_option_type": "text",
        "event_option_required": false
      }
    ]
  }
]
```

**Template normalization and filtering:**

The client filters out templates where `disabled === true` or `admin_only === true`. It does not filter `is_admin`. `normalizeTemplate` requires a nonempty string `id` and skips templates without one; it does not synthesize IDs or copy `_id` into `id`. Missing category/option arrays become empty arrays.

**Built-in Fallback Templates:**
At startup the logger initially uses six built-in templates, then replaces them with eligible cached templates and, when authenticated and connected, server templates. It also uses fallbacks on sign-out, a template-fetch 401, or when no eligible cached/server templates remain:
1. `fallback-ctd-start` (`CTD_START`, "CTD Start")
2. `fallback-ctd-bottom` (`CTD_BOTTOM`, "CTD Bottom")
3. `fallback-ctd-end` (`CTD_END`, "CTD End")
4. `fallback-sample` (`SAMPLE_TAKEN`, "Sample Taken")
5. `fallback-note` (`NOTE`, "Freeform Note")
6. `fallback-note-gps` (`NOTE_GPS`, "Freeform Note (GPS)" with `Latitude`, `Longitude`, `Device Accuracy (m)`)

**Curl**

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/event_templates"
```

A network error during refresh retains the templates already in memory. Successful refresh replaces the cached server-template set.

**Default GPS rules:** Before rendering templates, the app initializes on-log latitude/longitude and configurable accuracy rules for templates with no matching saved configuration. This includes Freeform Note (GPS). Saved configurations—including explicit None, partial rules, and edit-only choices—are preserved by template ID or matching event value. Save in Manage rules updates the capture form immediately; no template refresh is required. See [auto-fill architecture](ARCHITECTURE.md#template-auto-fill-rule-system).

---

## Query events & Deduplication Preflight

`GET /api/v1/events`

Used by the Offline Logger for two core workflows:
1. **Preflight Deduplication & Verification**:
   Query with an escaped, anchored `fulltext` pattern and check the returned `client_uuid` option to verify if a local event was already created on the server prior to POSTing or when `insertedId` is missing:
   `GET /api/v1/events?fulltext=<URL-encoded ^localId$>`
   Only an exact UUID option match confirms an event. Failed preflight requests hold the event for retry, and multiple exact UUID matches require operator review; the client does not choose a record by author, time, or value.
2. **Load Sealog Events**:
   Query all events for an author within the active cruise window:
   `GET /api/v1/events?author=<username>&startTS=<iso>&stopTS=<iso>`

The import requires a username, a selected cruise ID, and a cruise start timestamp. If the selected cruise has no stop time, the client uses the current UTC time. The importer merges by server ID or the `client_uuid` option, skips local records with pending work, and preserves backfill metadata when refreshing an already-synced record. It does not add pagination to the returned event list. A 404 is treated as no matching records; other unsuccessful responses report an error.

The preflight query does not filter by author and does not use a `client_uuid` query parameter. A 404 means no match; other HTTP errors or a non-array response hold the event for retry. Matching requires the exact UUID event-option value and a usable server `id`. There is no fallback match by note, timestamp, or event type.

**200 response (example shape)**

```json
[
  {
    "id": "6ad467beb0f844c49dcc5078",
    "event_value": "CTD_START",
    "event_free_text": "Bottle 1",
    "ts": "2025-09-23T10:12:03.456Z",
    "event_options": [
      { "event_option_name": "client_uuid", "event_option_value": "abc123..." }
    ]
  }
]
```

---

## Create event

`POST /api/v1/events`

**Headers**

- `Content-Type: application/json`
- `Accept: application/json`
- `Authorization: Bearer <token>` (server must permit event creation)

**Body - as built by `buildPostBody`**

```json
{
  "event_value": "CTD_START",
  "event_free_text": "Bottle 1",
  "ts": "2025-09-23T10:12:03.456Z",
  "event_options": [
    { "event_option_name": "client_uuid", "event_option_value": "abc123..." },
    { "event_option_name": "Latitude", "event_option_value": "-45.123450" },
    { "event_option_name": "Longitude", "event_option_value": "170.987650" }
  ]
}
```

`event_free_text` is the plain operator note (not JSON). The event timestamp is the
top-level `ts`. When present, captured coordinates, accuracy, and template fields
are represented by `event_options`; the client also adds its `client_uuid` option.
GPS fields are not guaranteed for templates or saved rules that do not capture them.
The richer JSON object it keeps locally (`buildEventFreeText`) is used for
local payload synchronization and CSV export. Imported `event_free_text` remains
a plain note, including text that happens to look like JSON. IDs come from `id`,
event times from `ts`, and the local UUID from the `client_uuid` event option.

**Successful response used for the new event ID**

```json
{
  "acknowledged": true,
  "insertedId": "6ad467beb0f844c49dcc5078"
}
```

The client uses `insertedId` from the response; it does not require `acknowledged` to be present. If that ID is missing, it saves `SYNC_STATE.VERIFY_PENDING` ("Confirming") before trying an immediate UUID lookup. The scheduled verification loop then requires exactly one matching `client_uuid` option and a server `id`. Missing matches and failed scheduled checks count toward a six-attempt limit; multiple exact matches require review immediately. The operator can retry confirmation or explicitly re-post. A known server ID is saved before auxiliary upload so a retry does not issue another POST. Newer local edits are queued for PATCH before the event can be marked fully synced.

**Curl — creates a real server event when run against a live endpoint**

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"event_value": "TEST", "ts": "2026-08-26T12:00:00Z"}' \
  "$BASE/api/v1/events"
```

---

## Update event (PATCH)

`PATCH /api/v1/events/{id}`

**Headers**

- `Content-Type: application/json`
- `Authorization: Bearer <token>` (role with edit permission)

**Path parameter**

- `id` - the known `serverId`, obtained from POST `insertedId` or a queried event's `id`.

**Body - as built by `buildPatchBody`**

```json
{
  "event_value": "CTD_BOTTOM",
  "event_free_text": "Reached bottom",
  "ts": "2025-09-23T10:22:00.000Z",
  "event_options": [
    { "event_option_name": "client_uuid", "event_option_value": "abc123..." },
    { "event_option_name": "depth_m", "event_option_value": "1800" }
  ]
}
```

**200 response (example)**

```json
{
  "acknowledged": true,
  "modifiedCount": 1
}
```

The client accepts a successful HTTP response without parsing this body. It then completes auxiliary work and checks whether local edits occurred during the request. It sends the complete current notes, timestamp, and option list, with `event_value` included when a type is present. A server record that differs from the current local payload after UUID recovery is also queued for PATCH.

**Curl**

```bash
curl -s -X PATCH \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"event_value":"CTD_BOTTOM","event_free_text":"Reached bottom","ts":"2025-09-23T10:22:00.000Z"}' \
  "$BASE/api/v1/events/6ad467beb0f844c49dcc5078"
```

> The server must grant the account permission to edit these events; changing the client cannot grant that permission.

---

## Auxiliary Telemetry & Lowering Endpoints

### Get lowerings

`GET /api/v1/lowerings`

Used by ASNAP backfill to select a lowering by its current time window. Missing or unusable lowering context can trigger a bounded event-timestamp query instead.

### Get vehicle & vessel telemetry

- `GET /api/v1/event_aux_data/bylowering/{id}?datasource=vehiclePosition`
- `GET /api/v1/event_aux_data/bycruise/{id}?datasource=vesselPosition`

Queries auxiliary entries with `data_array` name/value pairs. Vehicle data can provide latitude, longitude, and depth; vessel data can provide latitude, longitude, and heading. Requests also include `limit=5000`. Vessel requests may use a separate API root resolved from `asnapVesselApiRoot`, a Deployment A route, or port 8000.

The client combines these entries with events from `/events/bylowering/{id}?limit=5000`, and vessel ASNAP events from `/events/bycruise/{id}?value=ASNAP&limit=5000`. When lowering context is insufficient, the fallback request is `/events?value=ASNAP&startTS=<iso>&stopTS=<iso>&limit=5000`. Optional time bounds are also sent on cruise ASNAP requests. These are bounded single requests, without a pagination loop.

### Post auxiliary data entries

`POST /api/v1/event_aux_data`

After obtaining a server event ID, the client uploads each backfilled auxiliary entry. Eligible events wait locally until both required `vehiclePosition` and `vesselPosition` entries can be produced. Failed auxiliary uploads remain retryable rather than being treated as fully synced.

**Body (example)**

```json
{
  "event_id": "6ad467beb0f844c49dcc5078",
  "data_source": "vehiclePosition",
  "data_array": [
    { "data_name": "latitude", "data_value": "-45.123450", "data_uom": "ddeg" },
    { "data_name": "longitude", "data_value": "170.987650", "data_uom": "ddeg" },
    { "data_name": "depth", "data_value": "450.5", "data_uom": "m" }
  ]
}
```

> `buildEventAuxUploadPayload` sends the current schema: `event_id`, `data_source`, and `data_array`. Alternate field names and array-wrapped uploads are unsupported.

One request is sent per auxiliary entry. A successful HTTP response or 409 is accepted for auxiliary uploads; other statuses leave the work retryable. This differs from event POST conflicts, which require UUID confirmation.

---

## Client Debug Snapshot Forwarding

`POST /<deployment-prefix>/debug/asnap-backfill`

This same-origin endpoint is outside the Sealog API root. For example, Deployment A sends to `/sealog-a/debug/asnap-backfill`. The reference Nginx configuration accepts POST without an Authorization header and returns 204; OPTIONS also returns 204 and other methods return 405. It defines a request-body access log at `/var/log/nginx/sealog-asnap-backfill-snapshot.log`. Verify actual log contents on the installed server; a 204 by itself does not establish that a snapshot body was retained.

**Body (example)**

```json
{
  "capturedAtUtc": "2026-08-26T12:00:00.000Z",
  "status": "ok",
  "reason": "combined",
  "counts": { "eventPoints": 42, "auxPoints": 108, "vesselPoints": 210 },
  "samples": { "eventPoints": { "total": 42, "head": [], "tail": [] } }
}
```

After successful forwarding, the client suppresses the same snapshot signature for 15 seconds; changed signatures may post sooner. This applies regardless of whether the snapshot describes successful or failed backfill context. Each sample category is trimmed to at most eight head rows and eight tail rows. Forwarding times out after four seconds and failures do not stop event sync or suppress the next attempt. The latest full local snapshot is stored under `asnapBackfillDebugSnapshot`.

---

## Status codes

| Code | Meaning |
|---|---|
| `200` | OK / success |
| `201` | Created (some versions return 200 for inserts) |
| `400` | Bad request - validation error |
| `401` | Authentication or permission rejection; handling depends on the request path |
| `403` | Permission rejection; retained upload work is retried through the normal error path |
| `404` | No match for event import/UUID lookup; treated as a failure by other request paths |
| `409` | Conflict; on event POST the client searches with `fulltext` and requires an exact `client_uuid` event-option match |
| `5xx` | Server error; queued uploads retry with backoff |

Network failures have no HTTP status and also retain queued work for retry. An event-POST 409 is marked synced only after the existing server record is resolved and required auxiliary work succeeds; an unresolved duplicate remains retryable.

---

## Server permissions

The account must be able to read cruises, eligible templates, event queries, and any telemetry needed for enabled backfill, create events, and edit the events it will patch. Backfill also needs permission to create auxiliary data. Check the exact role names and route policies in the deployed server's API documentation.

The app sends the same stored JWT for authenticated calls, including candidate vessel telemetry roots. Guest sign-in does not bypass permissions or obtain a separate vessel token.

---

## Client integration notes (Offline Logger)

- **Relative API root.** The default `/sealog-server` is prefixed with the current supported deployment path. localStorage `apiRoot` overrides `window.API_ROOT`, which overrides the default. Use a same-origin HTTPS proxy for the reference deployment.
- **Cache templates.** Authenticated online startup refreshes `/api/v1/event_templates`. Network failure retains cached templates; first use without eligible cached templates uses the built-in set.
- **Duplicate prevention.** `ensureClientUuidOption` adds `client_uuid` to event options and preflight searches it with the supported `fulltext` query before POST, then checks the exact option value. This is not a guarantee of server-side uniqueness enforcement.
- **401 handling.** Event POST/PATCH, UUID lookup, cruise lookup, event import, and template refresh remove the stored JWT on 401. Template refresh also clears the username and switches to fallback templates. Auxiliary uploads and telemetry context requests report errors without consistently clearing authentication. Queued events remain local. See [Security](SECURITY.md).

---

## References

- [Sealog API usage, authentication, and JWT lifecycle](https://www.oceandatatools.org/sealog-docs/server_using_api/)
- [Sealog Server source](https://github.com/OceanDataTools/sealog-server)
- Your server's Swagger / Scalar page (complete endpoint list)
  `https://<host-or-ip>:<port>/sealog-server/documentation`
