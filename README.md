# agpt-dash

Independent RL training dashboard, separate repo from torchtitan.

- Fetches `prod_dash_web` via SSH tunnel (`AGPT_UPSTREAM`, default `http://127.0.0.1:8712/api/backbone`)
- Loads and serves `~/.agpt-dash/cache.json` immediately after restarts
- Refreshes Aurora once in the background (not once per browser request), using HTTP validators when available
- Keeps serving the last-known-good snapshot if Aurora or the tunnel is unavailable
- Multi-view overview, training metrics, evaluation benchmarks, and diagnostics
- Selectable focus metrics, step/token axes, log scale, outlier clipping, and per-chain visibility
- Operational chain board, latest evaluation score table, and maximizeable charts
- Lightweight status polling avoids re-downloading and redrawing unchanged telemetry
- Persistent light/dark theme and responsive desktop/mobile layouts
- Localhost-only bound (`127.0.0.1`) with no auth; override via `PD_WEB_ALLOW_PUBLIC` not applied here (set `AGPT_HOST` explicitly if needed)
- Stdlib Python server with locally vendored uPlot charts

Run:
```bash
# Ensure the tunnel to the login node running prod_dash_web is open first.
# The node must be explicit because 127.0.0.1 is local to each Aurora UAN:
# ssh -J aurora -L 8712:127.0.0.1:8712 foremans@aurora-uan-0012
python3 server.py --port 8720
```

Config via env:
- `AGPT_UPSTREAM` (default prod_dash on tunnel port 8712)
- `AGPT_HOST` / `AGPT_PORT`
- `AGPT_CACHE_FILE` (default `~/.agpt-dash/cache.json`)
- `AGPT_REFRESH_SECONDS` (default `20`)
- `AGPT_STALE_SECONDS` (default `90`)

Test:
```bash
python3 -m unittest discover -s tests -v
```
