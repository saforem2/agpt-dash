# Dashboard reliability and polish

## Live HTML/JavaScript consistency

- [x] Identify why the forwarded dashboard appeared to load indefinitely.
- [x] Read `index.html` per request instead of retaining startup-era markup.
- [x] Prevent browser caching of the HTML shell.
- [x] Run unit, syntax, and isolated HTTP smoke checks.
- [x] Record verification results without restarting the user-owned foreground server.

### HTML consistency review

- Root cause: the Sep 24 foreground process retained the old 3,772-byte HTML
  shell while serving updated JavaScript from disk, leaving all 35 required DOM
  elements unavailable to the current application script.
- Nine unit tests pass, including a regression test that changes an index file
  between reads and observes the new bytes.
- Python compilation, JavaScript syntax checks, and `git diff --check` pass.
- An isolated server on port 18720 served the current 7,911-byte HTML, current
  JavaScript, `Cache-Control: no-store`, and valid status/backbone JSON.
- After explicit user authorization, the old foreground process was stopped
  gracefully and the corrected server was started on port 8720. The mbpr
  forward serves the current 7,911-byte HTML in 16–18 ms with no-store caching.

## Persistent Aurora upstream

- [x] Diagnose the `upstream unreachable` connection refusal.
- [x] Confirm `prod_dash_web` is running on `aurora-uan-0012:8712`, not the
  login node currently selected by the generic `aurora` alias.
- [x] Install `sh.samf.agpt-upstream-forward` as a LaunchAgent-managed,
  loopback-only SSH forward from `mbph:8712` to `aurora-uan-0012:8712`.
- [x] Verify the forward survives a supervised restart and returns all 10
  chains.
- [x] Force a dashboard refresh and verify from mbpr that `cache_error` is null.

### Upstream review

- The connection-refused warning is resolved. Aurora's producer initially
  returned an approximately 7.2-hour-old stale snapshot, then completed its
  detached rebuild without intervention. A forced dashboard refresh verified
  `cache_status: fresh`, `cache_error: null`, and `stale: false` from both mbph
  and the mbpr-facing forward.

- [x] Implement a real persistent last-known-good cache.
- [x] Refresh Aurora in one background worker instead of per browser request.
- [x] Add cache TTL, conditional requests, atomic writes, and useful health metadata.
- [x] Improve dashboard summaries, refresh controls, navigation, and stale/error states.
- [x] Add automated tests for startup, successful refresh, and upstream failure behavior.
- [x] Run tests and an end-to-end local server/API check.
- [x] Visually verify desktop and mobile layouts with Playwright and address findings.

## Review

- Five cache lifecycle tests pass with `python3 -m unittest discover -s tests -v`.
- Python and JavaScript syntax checks pass.
- An isolated HTTP smoke test verified `/`, static JS, cached `/api/backbone`, and `POST /api/refresh`.
- Playwright/Chrome visual checks passed at 1440×1000 and 390×844, DPR 1, forced dark theme, with no console or page errors and no horizontal overflow.
- Visual findings fixed: mobile navigation, metadata spacing, native links/buttons, live-step priority, chart scale readability, uPlot point-radius exception, and missing favicon.

## Light mode, freshness, and focus chart follow-up

- [x] Fix navbar and control contrast in light mode.
- [x] Verify the Aurora backbone refresh and make stale status explanatory.
- [x] Plot every chain with loss data in the focus chart.
- [x] Add focused tests and visually verify light/dark rendering.

### Follow-up review

- Light and dark Playwright captures render without console/page errors; control foreground/background/border colors were inspected in both themes.
- The focus chart receives all 10 chains that currently contain loss data and renders a 10-item color-matched legend.
- The mbpr endpoint returns 10 chains and 10 loss series. Its warning remains accurate because Aurora's backbone is ~49.8 hours old; the detached Aurora refresh worker is running and its lock is present.
- JavaScript syntax, six cache tests, and `git diff --check` pass.

## Production dashboard feature parity

- [x] Inventory and port useful controls from torchtitan `prod_dash_web.py`.
- [x] Make 2b MDS unmistakably present in the focus and metric charts.
- [x] Add metric tabs, token/log/outlier controls, and chain visibility toggles.
- [x] Add operational board metrics, all-metric charts, eval charts, and eval score table.
- [x] Add maximize/restore and resize-safe chart behavior.
- [x] Avoid full-payload redraws when only cache/status metadata changes.
- [x] Verify all features against the real 10-chain payload in light/dark and desktop/mobile layouts.

### Feature parity review

- Ported the useful interaction model from `prod_dash_web.py`: six focus metrics, step/token axis, log scale, outlier clipping, chain toggles, live-tip extension, operational board fields, training small multiples, benchmark charts, latest score table, and maximize/restore.
- 2b MDS is assigned its own stable color and appears in the focus chart, every available training metric, legend, board, and evaluation views. Its 599-point loss series reaches step 154,285.
- Status polling uses `/api/status` plus Aurora's stable `web_revision`; the browser fetches the full backbone and redraws charts only when telemetry changes.
- Playwright verified 10 legend entries, 10 board rows, six training charts, seven evaluation charts, maximize/Escape restore, all controls, and zero application errors in light/dark desktop and 390px mobile layouts.
- Aurora published a fresh backbone on 2026-09-24; isolated verification reports `live`.

## Metrics run filtering

- [x] Add visible per-run toggles to the metrics page.
- [x] Add all, none, and live-only selection shortcuts.
- [x] Persist run visibility and keep overview/metrics controls synchronized.
- [x] Verify training and evaluation charts update without errors.

### Run filtering review

- The metrics page shows all 10 runs with stable color keys and a selected-count summary.
- Individual choices update the six training and seven evaluation charts, synchronize with the overview legend, and persist in `localStorage` across reloads.
- `all`, `live only`, and `none` shortcuts work; an empty selection renders explicit no-data states rather than stale plots.
- Playwright verified hide/show, overview synchronization, persistence, shortcuts, and zero console/page errors.

## Chart workspace controls

- [x] Add search and model/node/status filters.
- [x] Add solo-run interactions and reset behavior.
- [x] Encode selected chart state in the URL for sharing.
- [x] Add a multi-field hover tooltip using available telemetry.
- [x] Add normalized-progress comparison mode.
- [x] Show per-run freshness in run selectors.
- [x] Export the current focus view as PNG, SVG, and CSV.
- [x] Verify desktop/mobile interactions and exported artifacts.

### Chart workspace review

- Search and model/node/status filters narrow the selector; bulk actions apply to the matching subset.
- Double-click or Option/Alt/Command-click solos a run; `all` restores the full comparison.
- URL state round-trips metric, axis mode, log/outlier settings, and selected run keys.
- Hover shows run, axis coordinate, metric value, reconstructed step/tokens, throughput, and clearly labeled run-update age.
- Normalized mode compares each run by percentage of its own token target.
- PNG, standalone SVG, and tidy CSV exports were generated and independently opened/validated.
- Playwright verified shared-link restoration and 390px mobile layout with no horizontal overflow or application errors.
