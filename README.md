# agpt-dash

Independent RL training dashboard, separate repo from torchtitan.

- Fetches `prod_dash_web` via SSH tunnel (`AGPT_UPSTREAM`, default `http://127.0.0.1:8712/api/backbone`)
- Caches payload to `~/.agpt-dash/cache.json` (JSON file, survives restarts)
- Multi-view: overview / metrics / about + theme toggle + status indicators
- Localhost-only bound (`127.0.0.1`) with no auth; override via `PD_WEB_ALLOW_PUBLIC` not applied here (set `AGPT_HOST` explicitly if needed)
- Stdlib Python server; uPlot charts to be wired in metrics view

Run:
```bash
# Ensure tunnel to aurora is open first:
# ssh -L 8712:127.0.0.1:8712 aurora
python server.py --port 8720
```

Config via env:
- `AGPT_UPSTREAM` (default prod_dash on tunnel port 8712)
- `AGPT_HOST` / `AGPT_PORT`
