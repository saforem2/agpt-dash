import json
import tempfile
import threading
import unittest
from pathlib import Path

from server import CacheManager, NotModified, read_index


class Clock:
    def __init__(self, value=1000):
        self.value = value

    def __call__(self):
        return self.value


class CacheManagerTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.cache_file = Path(self.tempdir.name) / "cache.json"
        self.clock = Clock()

    def tearDown(self):
        self.tempdir.cleanup()

    def manager(self, fetcher):
        return CacheManager(
            cache_file=self.cache_file,
            upstream="http://aurora.test/api/backbone",
            refresh_seconds=20,
            stale_seconds=90,
            fetcher=fetcher,
            clock=self.clock,
        )

    def test_successful_refresh_persists_and_reloads_data(self):
        calls = []

        def fetcher(upstream, etag, modified):
            calls.append((upstream, etag, modified))
            return {"chains": {"run": {"live_tip": {"step": 42}}}}, "v1", "today"

        manager = self.manager(fetcher)
        self.assertTrue(manager.refresh())
        snapshot = manager.snapshot()
        self.assertEqual(snapshot["chains"]["run"]["live_tip"]["step"], 42)
        self.assertEqual(snapshot["cache_status"], "fresh")
        self.assertTrue(self.cache_file.exists())

        reloaded = self.manager(fetcher)
        self.assertEqual(reloaded.snapshot()["chains"], snapshot["chains"])
        reloaded.refresh()
        self.assertEqual(calls[-1][1:], ("v1", "today"))

    def test_failure_serves_last_good_cache_without_overwriting_it(self):
        cached = {
            "chains": {"saved": {"live_tip": {"step": 12}}},
            "cached_at": 950,
            "cached_from": "aurora",
        }
        self.cache_file.write_text(json.dumps(cached))
        original = self.cache_file.read_text()

        def failing_fetcher(*args):
            raise OSError("tunnel closed")

        manager = self.manager(failing_fetcher)
        self.assertFalse(manager.refresh())
        snapshot = manager.snapshot()
        self.assertEqual(snapshot["chains"], cached["chains"])
        self.assertEqual(snapshot["cache_status"], "error")
        self.assertIn("tunnel closed", snapshot["cache_error"])
        self.assertEqual(self.cache_file.read_text(), original)

    def test_empty_upstream_chains_preserve_last_good_cache(self):
        cached = {
            "chains": {"saved": {"live_tip": {"step": 12}}},
            "cached_at": 950,
            "cache_revision": 4,
        }
        self.cache_file.write_text(json.dumps(cached))
        original = self.cache_file.read_text()

        manager = self.manager(lambda *args: ({"chains": {}}, None, None))

        self.assertFalse(manager.refresh())
        snapshot = manager.snapshot()
        self.assertEqual(snapshot["chains"], cached["chains"])
        self.assertEqual(snapshot["cache_status"], "error")
        self.assertIn("no chains", snapshot["cache_error"])
        self.assertEqual(self.cache_file.read_text(), original)

    def test_missing_cache_returns_empty_state_on_failure(self):
        manager = self.manager(lambda *args: (_ for _ in ()).throw(OSError("offline")))
        manager.refresh()
        snapshot = manager.snapshot()
        self.assertEqual(snapshot["chains"], {})
        self.assertEqual(snapshot["cache_status"], "error")
        self.assertFalse(self.cache_file.exists())

    def test_empty_persisted_cache_is_rejected(self):
        self.cache_file.write_text(json.dumps({
            "chains": {}, "cached_at": 999, "cache_revision": 8
        }))

        manager = self.manager(lambda *args: (_ for _ in ()).throw(OSError("offline")))
        snapshot = manager.snapshot()

        self.assertEqual(snapshot["chains"], {})
        self.assertEqual(snapshot["cache_status"], "error")
        self.assertIn("cache payload is invalid", snapshot["cache_error"])
        self.assertEqual(snapshot["cache_revision"], 0)

    def test_not_modified_refreshes_cache_age_without_losing_data(self):
        self.cache_file.write_text(json.dumps({
            "chains": {"run": {}}, "cached_at": 900, "cache_etag": "v1"
        }))

        def not_modified(*args):
            raise NotModified()

        manager = self.manager(not_modified)
        self.assertTrue(manager.refresh())
        self.assertEqual(manager.snapshot()["cache_age_seconds"], 0)
        self.assertEqual(json.loads(self.cache_file.read_text())["cached_at"], 1000)

    def test_old_cache_is_stale_even_without_an_error(self):
        self.cache_file.write_text(json.dumps({"chains": {"run": {}}, "cached_at": 800}))
        manager = self.manager(lambda *args: ({"chains": {}}, None, None))
        snapshot = manager.snapshot()
        self.assertTrue(snapshot["stale"])
        self.assertEqual(snapshot["cache_status"], "stale")

    def test_upstream_stale_state_is_preserved(self):
        def stale_fetcher(*args):
            return ({"chains": {"run": {}}, "stale": True,
                     "stale_reason": "backbone refresh in progress"}, None, None)

        manager = self.manager(stale_fetcher)
        manager.refresh()
        snapshot = manager.snapshot()
        self.assertTrue(snapshot["stale"])
        self.assertEqual(snapshot["cache_status"], "stale")
        self.assertEqual(snapshot["stale_reason"], "backbone refresh in progress")

    def test_status_is_lightweight_and_revision_changes_after_refresh(self):
        manager = self.manager(lambda *args: ({"chains": {"run": {}}, "built_age": 4}, None, None))
        before = manager.status()
        self.assertNotIn("chains", before)
        self.assertEqual(before["cache_revision"], 0)
        manager.refresh()
        after = manager.status()
        self.assertEqual(after["cache_revision"], 1)
        self.assertEqual(after["built_age"], 4)

    def test_status_uses_stable_upstream_revision(self):
        manager = self.manager(lambda *args: ({"chains": {"run": {}}, "web_revision": 7}, None, None))
        manager.refresh()
        self.assertEqual(manager.status()["cache_revision"], 7)
        manager.refresh()
        self.assertEqual(manager.status()["cache_revision"], 7)

        reloaded = self.manager(lambda *args: ({"chains": {}}, None, None))
        self.assertEqual(reloaded.status()["cache_revision"], 7)

    def test_snapshot_includes_revision_from_same_locked_state(self):
        manager = self.manager(lambda *args: ({"chains": {"old": {}}}, None, None))
        manager.refresh()
        original_deepcopy = __import__("server").copy.deepcopy
        snapshot_started = threading.Event()
        allow_snapshot = threading.Event()

        def paused_deepcopy(value):
            copied = original_deepcopy(value)
            snapshot_started.set()
            allow_snapshot.wait(timeout=2)
            return copied

        __import__("server").copy.deepcopy = paused_deepcopy
        result = {}
        try:
            thread = threading.Thread(target=lambda: result.update(manager.snapshot()))
            thread.start()
            self.assertTrue(snapshot_started.wait(timeout=2))
            manager.fetcher = lambda *args: ({"chains": {"new": {}}}, None, None)
            refresh = threading.Thread(target=manager.refresh)
            refresh.start()
            allow_snapshot.set()
            thread.join(timeout=2)
            refresh.join(timeout=2)
        finally:
            __import__("server").copy.deepcopy = original_deepcopy

        self.assertIn("old", result["chains"])
        self.assertEqual(result["cache_revision"], 1)

    def test_source_ages_advance_with_local_clock(self):
        manager = self.manager(lambda *args: ({
            "chains": {"run": {}},
            "built_age": 10,
            "stale_age_hours": 1,
            "generated_at": 900,
        }, None, None))
        manager.refresh()
        self.clock.value = 1030

        snapshot = manager.snapshot()

        self.assertEqual(snapshot["built_age"], 40)
        self.assertEqual(snapshot["stale_age_hours"], 1 + 30 / 3600)

    def test_index_is_read_fresh_for_each_request(self):
        index_file = Path(self.tempdir.name) / "index.html"
        index_file.write_text("first")
        self.assertEqual(read_index(index_file), b"first")

        index_file.write_text("second")
        self.assertEqual(read_index(index_file), b"second")


if __name__ == "__main__":
    unittest.main()
