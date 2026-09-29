#!/usr/bin/env python3
"""agpt-dash server with a persistent stale-while-revalidate cache."""
from __future__ import annotations

import argparse
import copy
import http.server
import json
import math
import os
import socketserver
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE_FILE = Path(os.environ.get("AGPT_CACHE_FILE", Path.home() / ".agpt-dash" / "cache.json"))
UPSTREAM = os.environ.get("AGPT_UPSTREAM", "http://127.0.0.1:8712/api/backbone")
REFRESH_SECONDS = max(5, int(os.environ.get("AGPT_REFRESH_SECONDS", "20")))
STALE_SECONDS = max(REFRESH_SECONDS, int(os.environ.get("AGPT_STALE_SECONDS", "90")))


class NotModified(Exception):
    """The upstream confirmed that the cached representation is current."""


def finite_number(value, fallback=None):
    """Return finite JSON numbers while rejecting booleans and malformed values."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    return value if math.isfinite(value) else fallback


def fetch_upstream(upstream, etag=None, last_modified=None):
    headers = {"Accept": "application/json"}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    request = urllib.request.Request(upstream, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("upstream payload must be a JSON object")
            return data, response.headers.get("ETag"), response.headers.get("Last-Modified")
    except urllib.error.HTTPError as error:
        if error.code == 304:
            raise NotModified from error
        raise


class CacheManager:
    def __init__(self, cache_file=CACHE_FILE, upstream=UPSTREAM,
                 refresh_seconds=REFRESH_SECONDS, stale_seconds=STALE_SECONDS,
                 fetcher=fetch_upstream, clock=time.time):
        self.cache_file = Path(cache_file)
        self.upstream = upstream
        self.refresh_seconds = refresh_seconds
        self.stale_seconds = stale_seconds
        self.fetcher = fetcher
        self.clock = clock
        self._lock = threading.Lock()
        self._refresh_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None
        self._payload = None
        self._cached_at = None
        self._last_attempt_at = None
        self._last_error = None
        self._etag = None
        self._last_modified = None
        self._source_observed_at = None
        self._refreshing = False
        self._revision = 0
        self._load()

    def _load(self):
        try:
            payload = json.loads(self.cache_file.read_text())
            if (not isinstance(payload, dict)
                    or not isinstance(payload.get("chains"), dict)
                    or not payload["chains"]):
                raise ValueError("cache payload is invalid")
            with self._lock:
                self._payload = payload
                mtime = self.cache_file.stat().st_mtime
                self._cached_at = finite_number(payload.get("cached_at"), mtime)
                self._etag = payload.get("cache_etag")
                self._last_modified = payload.get("cache_last_modified")
                self._source_observed_at = finite_number(
                    payload.get("cache_source_observed_at"), self._cached_at
                )
                self._revision = finite_number(
                    payload.get("cache_revision", payload.get("web_revision", 0)), 0
                )
        except FileNotFoundError:
            return
        except (OSError, ValueError, json.JSONDecodeError) as error:
            with self._lock:
                self._last_error = f"could not read local cache: {error}"

    def _write(self, payload):
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix="cache.", suffix=".json", dir=self.cache_file.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(payload, stream, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self.cache_file)
        except Exception:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
            raise

    def refresh(self):
        if not self._refresh_lock.acquire(blocking=False):
            return False
        try:
            with self._lock:
                self._refreshing = True
                self._last_attempt_at = self.clock()
                etag, last_modified = self._etag, self._last_modified
            try:
                data, etag, last_modified = self.fetcher(self.upstream, etag, last_modified)
                if not isinstance(data.get("chains"), dict) or not data["chains"]:
                    raise ValueError("upstream payload contains no chains")
                now = self.clock()
                payload = dict(data)
                source_revision = finite_number(data.get("web_revision"))
                if source_revision is None:
                    source_revision = self._revision + 1
                payload["cache_revision"] = source_revision
                payload.update({
                    "cached_at": now,
                    "cached_from": self.upstream,
                    "cache_etag": etag,
                    "cache_last_modified": last_modified,
                    "cache_source_observed_at": now,
                })
                self._write(payload)
                with self._lock:
                    self._payload = payload
                    self._cached_at = now
                    self._etag = etag
                    self._last_modified = last_modified
                    self._source_observed_at = now
                    self._last_error = None
                    self._revision = source_revision
                return True
            except NotModified:
                now = self.clock()
                with self._lock:
                    self._cached_at = now
                    self._last_error = None
                    if self._payload is not None:
                        self._payload["cached_at"] = now
                        payload = dict(self._payload)
                    else:
                        payload = None
                if payload is not None:
                    try:
                        self._write(payload)
                    except OSError as error:
                        with self._lock:
                            self._last_error = f"could not update local cache: {error}"
                        return False
                return True
            except Exception as error:
                with self._lock:
                    self._last_error = f"upstream unreachable: {error}"
                return False
            finally:
                with self._lock:
                    self._refreshing = False
        finally:
            self._refresh_lock.release()

    def snapshot(self):
        with self._lock:
            now = self.clock()
            payload = copy.deepcopy(self._payload) if self._payload is not None else {"chains": {}}
            age = max(0, now - self._cached_at) if self._cached_at is not None else None
            source_elapsed = max(0, now - self._source_observed_at) if self._source_observed_at is not None else 0
            for key in ("built_age", "web_age"):
                value = finite_number(payload.get(key))
                if value is not None:
                    payload[key] = value + source_elapsed
            stale_age = finite_number(payload.get("stale_age_hours"))
            if stale_age is not None:
                payload["stale_age_hours"] = stale_age + source_elapsed / 3600
            source_stale = bool(payload.get("stale"))
            source_reason = payload.get("stale_reason")
            stale = (self._payload is None or age > self.stale_seconds
                     or self._last_error is not None or source_stale)
            if self._payload is None:
                status = "error" if self._last_error else "empty"
            elif self._last_error:
                status = "error"
            elif age > self.stale_seconds or source_stale:
                status = "stale"
            elif self._refreshing:
                status = "refreshing"
            else:
                status = "fresh"
            payload.update({
                "cached_at": self._cached_at,
                "cached_from": payload.get("cached_from", self.upstream),
                "stale": stale,
                "stale_reason": (self._last_error or source_reason) if stale else None,
                "cache_error": self._last_error,
                "cache_status": status,
                "cache_age_seconds": age,
                "refreshing": self._refreshing,
                "last_attempt_at": self._last_attempt_at,
                "refresh_interval_seconds": self.refresh_seconds,
                "cache_revision": self._revision,
            })
            return payload

    def status(self):
        snapshot = self.snapshot()
        keys = (
            "cached_at", "cached_from", "stale", "stale_reason", "cache_error",
            "cache_status", "cache_age_seconds", "refreshing", "last_attempt_at",
            "refresh_interval_seconds", "built_at", "built_age", "generated_at",
            "stale_age_hours", "live_window",
        )
        return {**{key: snapshot.get(key) for key in keys},
                "cache_revision": snapshot["cache_revision"]}

    def request_refresh(self):
        self._wake.set()

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="aurora-cache-refresh", daemon=True)
        self._thread.start()

    def _run(self):
        while not self._stop.is_set():
            self._wake.clear()
            self.refresh()
            self._wake.wait(self.refresh_seconds)

    def stop(self):
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=2)


INDEX_FILE = HERE / "index.html"
MANAGER = CacheManager()


def read_index(index_file=INDEX_FILE):
    """Read the current page so HTML and separately served assets stay in sync."""
    return index_file.read_bytes()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.split("?")[0] == "/api/refresh":
            MANAGER.request_refresh()
            self._json({"accepted": True}, 202)
        else:
            self.send_error(404)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            body = read_index()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/backbone":
            self._json(MANAGER.snapshot())
        elif path == "/api/status":
            self._json(MANAGER.status())
        elif path.startswith(("/js/", "/css/", "/webassets/")) or path == "/favicon.ico":
            file_path = (HERE / path.lstrip("/")).resolve()
            if HERE not in file_path.parents or not file_path.is_file():
                self.send_error(404)
                return
            body = file_path.read_bytes()
            content_type = {
                ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon"
            }.get(file_path.suffix, "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("AGPT_PORT", "8720")))
    parser.add_argument("--host", default=os.environ.get("AGPT_HOST", "127.0.0.1"))
    args = parser.parse_args()
    print(f"agpt-dash: upstream={UPSTREAM}")
    print(f"agpt-dash: cache={CACHE_FILE}")
    print(f"agpt-dash: refresh={REFRESH_SECONDS}s")
    print(f"agpt-dash: http://{args.host}:{args.port}")
    MANAGER.start()
    with Server((args.host, args.port), Handler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped.")
        finally:
            MANAGER.stop()


if __name__ == "__main__":
    raise SystemExit(main())
