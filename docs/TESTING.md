# Automated Testing Guide

Run the relevant suites before merging and the full suite before a release. This guide matches the v1.2.0.9 scripts and configuration. Test totals are printed by each runner; the suite targets the current storage, browser, and Sealog API contracts.

## Prerequisites

- Node.js 24 or later and npm 11 or later, as required by `package.json`.
- Install the locked development dependencies with `npm ci` from the repository root.
- DOM tests and coverage use Vitest and `@vitest/coverage-v8` 4.1.11, as pinned in `package-lock.json`.
- Install the browser used by the suite with `npx playwright install chromium`. On Linux, `npx playwright install --with-deps chromium` also installs system dependencies.

Tests, Node packages, and test runners stay on contributor machines and CI. The production app is served directly as static files.

```bash
npm ci
npx playwright install chromium
npm run lint
npm test
npm run test:e2e
```

These commands run from the repository root. Browser specs start their own temporary local servers; there is no separate development server to start first. For a deployed app, follow [Installation](INSTALLATION.md) and use the manual checks below.

## Commands

| Command | Scope | What it covers |
|---|---|---|
| `npm run icons:check` | Phosphor integrity | Pinned source hashes and generated sprite/mask/caret assets |
| `node scripts/sync-app-icons.mjs --check` | App-icon integrity | Pinned Phosphor glyph/license hashes and generated SVG, PNG, and ICO assets; requires Chromium |
| `npm run lint` | ESLint | Syntax, imports, unused variables, and JSDoc rules in `app.js`, `sw.js`, `update-banner.js`, `src/`, and tests |
| `npm run test:unit` | Native Node test runner | Current tests of transforms, rules, state, scheduling, GPS/status decisions, and worker helpers |
| `npm run test:dom` | Vitest + happy-dom | Visibility and event-accordion behavior |
| `npm run test:integration` | Node test runner + fake-indexeddb | Composed event transforms, sync state, storage, and interrupted-request recovery |
| `npm test` | Unit + DOM + integration | All non-browser tests |
| `npm run test:e2e` | Playwright / Chromium | Actual browser behavior, including capture/edit, import, and offline sync |
| `npm run coverage:node` | Native Node coverage | Unit-suite text output and `coverage/node/lcov.info` |
| `npm run coverage` | Unit coverage, then DOM coverage | Runs native Node and Vitest V8 reports in separate directories; it does not merge their coverage |
| `npm audit --include=dev --audit-level=moderate` | Dependency audit | Fails for known moderate-or-higher issues, including development dependencies |

`npm run lint` uses `eslint-config-prettier` to disable conflicting style rules; it does not run Prettier formatting.

The configured lint command does not include `scripts/` or JavaScript embedded in `index.html` and `landing.html`. Browser tests cover those pages' runtime behavior. When editing an asset or screenshot generator, run that generator and inspect its output as well.

Node 24+ discovers unit and integration files through recursive test globs. No custom discovery runner is needed. `npm run coverage:node` runs the unit suite with Node's built-in coverage and writes `coverage/node/lcov.info`. `npm run coverage` also runs DOM coverage and writes `coverage/dom/lcov.info`; both reports remain available after the command finishes.

## Coverage boundaries

### Unit

- API-root and vessel-telemetry candidate resolution.
- Event serialization, POST/PATCH/auxiliary payloads, identifiers, and timestamps.
- Sync/verification states, backoff, and scheduling decisions.
- Auto-fill storage, explicit rule resolution, source values, fill-if-empty behavior, and validation of supported rule sources.
- ASNAP allowlist matching, point extraction, surrounding pairs, and interpolation.
- GPS/status decisions, service-worker handlers/cache helpers, and update version labels.

### DOM

- `hideElement`/`showElement` and `hidden`/`aria-hidden` attributes.
- Event-summary target lookup and expanding/collapsing cards with synchronized ARIA state.

### Integration

- Composed event serialization, POST/PATCH payloads, and sync-state transitions.
- IndexedDB persistence without read-time mutation, interrupted-request recovery, and selective removal of synced records.
- ASNAP interpolation applied to local payloads and POST options.

These integration tests compose exported helpers. They do not bootstrap `app.js` or exercise its live capture/rules-modal controllers.

### Browser

- `ui-behavior.spec.mjs`: tests covering themes, settings, event cards, responsive layouts, resources, authentication failures, GPS status, and the rules modal's Save/Cancel/persistence behavior.
- `offline-sync.spec.mjs`: tests covering prefixed worker registration/control, cached offline reload, a worker-version update, and capture/queue/POST synchronization.
- `landing.spec.mjs`: deployment links.
- `auto-fill.spec.mjs`: actual offline capture, empty-only edit rules, and uploaded time/GPS option values.
- `gps-logging-policy.spec.mjs`: universal GPS accuracy and freshness checks, override persistence, empty-only edit fills, and cancellation of pending GPS operations.
- `server-import.spec.mjs`: current server records, verbatim notes, refresh/persistence, retained backfill metadata, and UUID deduplication using supported API queries.
- `sync-verification.spec.mjs`: missing insert IDs, exact UUID confirmation, failed lookups, bounded retries, duplicate matches, auxiliary upload, and edits during recovery.

The browser suite uses Chromium and mocked API/geolocation responses. It does not establish physical GPS quality, mobile Safari behavior, certificate trust, or compatibility with a live server. Use [QA_PLAN.md](QA_PLAN.md) for those checks, including first-use GPS defaults and immediate changes after saving rules.

Opening a plain localhost server at `/index.html` previews the UI only: worker registration requires `/sealog-a/`, `/sealog-b/`, or `/sealog-c/`. The offline spec supplies a server that maps the supported prefixes to the app files. Browser failures save screenshots; with `CI=true`, the Playwright configuration allows two retries and records a trace on the first retry (`on-first-retry`).

`playwright.config.mjs` allows 30 seconds per test and five seconds per assertion, runs tests in parallel, and rejects `test.only` when `CI` is set. Local runs have no automatic retries. Failure artifacts are written under `test-results/`; local runs do not produce an HTML report by default.

## Focused checks

```bash
# Pure event payload and option behavior
node --test tests/unit/event-transform.test.mjs

# IndexedDB behavior
node --test tests/integration/indexed-db.test.mjs

# DOM accordion behavior
npm run test:dom -- tests/dom/event-accordion.test.mjs

# Real capture, editing, import, and upload recovery
npm run test:e2e -- tests/e2e/auto-fill.spec.mjs
npm run test:e2e -- tests/e2e/server-import.spec.mjs tests/e2e/sync-verification.spec.mjs

# Inspect browser test names without running them
npm run test:e2e -- --list
```

Use `--workers=1` on a browser command when investigating failures caused by resource contention. It changes concurrency, not the expected behavior.

## Verifying customization and installation

For route or worker changes, run `offline-sync.spec.mjs` and `landing.spec.mjs`, then repeat installation and offline reopening on the intended origin. The worker precaches every configured route; a missing route or a missing JavaScript module can prevent installation even if the landing page loads. The tests cannot validate paths that exist only in an external nginx configuration.

For template or auto-fill changes, run the auto-fill unit suite plus `auto-fill.spec.mjs` and the rules-modal checks in `ui-behavior.spec.mjs`. For theme changes, verify all three presets and the landing page. For icon changes, run both integrity commands in the table and inspect the smallest favicon and largest app icon. [Customization](CUSTOMIZATION.md) lists the files that must change together.

Certificate generation, nginx syntax, device trust, and live API permissions are deployment checks. Follow [certificate setup](cert-generation.md), [Installation](INSTALLATION.md), and [QA_PLAN.md](QA_PLAN.md); passing Chromium's mocked API tests does not validate them.

## Automation

This repository does not include a hosted CI workflow. To configure one, use the supported Node/npm versions above, install with `npm ci`, and run dependency audit, Phosphor and app-icon integrity, lint, unit, DOM, integration, and browser checks. Install Chromium and its system dependencies on the runner before app-icon and browser checks.

Dependencies are development-only; audit them because these tools execute on contributor machines and automated runners. Review check results before release.

## Choosing checks

Use existing suites and fixtures where they exercise the behavior being changed. Prefer real browser flows for capture, storage, and UI-controller interactions; helper tests alone cannot establish that the application initializes and connects them correctly. Avoid duplicate assertions and tests for deleted code paths. Manual field validation is separate from the automated suite.
