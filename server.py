#!/usr/bin/env python3
"""agpt-dash server: independent RL dashboard.
Fetches from prod_dash_web (via SSH tunnel) and caches to JSON on mbph.
Multi-view web: overview / metrics / about. No auth; bind loopback only.
"""
from __future__ import annotations
import argparse, json, os, sys, time, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE_FILE = Path.home() / ".agpt-dash" / "cache.json"
CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

# Default upstream: prod_dash_web on aurora, via SSH tunnel port.
UPSTREAM = os.environ.get("AGPT_UPSTREAM", "http://127.0.0.1:8712/api/backbone")


def fetch_upstream():
    import urllib.request
    with urllib.request.urlopen(UPSTREAM, timeout=30) as resp:
        return json.loads(resp.read().decode())


def refresh_cache(force=False):
    try:
        data = fetch_upstream()
        payload = dict(data)
        payload["cached_at"] = time.time()
        payload["cached_from"] = UPSTREAM
        payload["stale"] = False
        payload["cache_error"] = None
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump(payload, f)
        return payload
    except Exception as e:
        payload = {"chains":{"agpt-dash":{"label":"agpt-dash (offline)",
                    "series":{"loss":[[1,2.0],[2,1.8]]},
                    "queue_state":"stale","live_tip":{"step":2}}},
                   "stale":True,"stale_reason":"upstream unreachable: "+str(e),
                   "cached_at":time.time(),"cached_from":"offline"}
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(CACHE_FILE,"w") as f: json.dump(payload,f)
        except: pass
        return payload


_state = {"payload": None}
_lock = threading.Lock()


def get_payload():
    with _lock:
        return _state["payload"]


# Minimal stdlib server (same pattern as prod_dash_web) serving static
# multi-view dashboard and /api/backbone from cached payload.
import http.server, socketserver

INDEX = (HERE / "index.html").read_text()
ASSETS_DIR = HERE / "webassets"

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(INDEX.encode())
        elif p == "/api/backbone":
            payload = refresh_cache()
            with _lock:
                _state["payload"] = payload
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif p.startswith("/js/") or p.startswith("/css/") or p.startswith("/webassets/") or p == "/favicon.ico":
            fp = HERE / p.lstrip("/")
            if not fp.exists():
                self.send_response(404); self.end_headers()
                return
            body = fp.read_bytes()
            ctype = {"js":"text/javascript","css":"text/css"}.get(p.split(".")[-1], "text/plain")
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("AGPT_PORT", "8720")))
    ap.add_argument("--host", default=os.environ.get("AGPT_HOST", "127.0.0.1"))
    args = ap.parse_args()
    print(f"agpt-dash: upstream={UPSTREAM}")
    print(f"agpt-dash: cache={CACHE_FILE}")
    print(f"agpt-dash: http://{args.host}:{args.port}")
    with Server((args.host, args.port), Handler) as s:
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")

if __name__ == "__main__":
    raise SystemExit(main())
