//! Cross-file v2 — Test 05: Extract hardcoded config into shared constants
//!
//! A web application where timeout, retry, and limit values are hardcoded
//! as magic numbers in 4 different files. The task: extract all
//! configuration into a new `config.py` module and update all files to
//! import from it.
//!
//! Files to modify:
//! - http_client.py: hardcoded TIMEOUT = 30 and MAX_RETRIES = 3
//! - cache.py: hardcoded TTL = 300 and MAX_ENTRIES = 1000
//! - rate_limiter.py: hardcoded RATE_LIMIT = 100 and WINDOW = 60
//! - worker.py: hardcoded BATCH_SIZE = 50 and POLL_INTERVAL = 5
//!
//! The model must:
//! 1. Create config.py with ALL constants centralized
//! 2. Update each file to import its constants from config.py
//! 3. Remove the local constant definitions
//! 4. NOT change any logic — only where constants are defined
//!
//! Red herrings:
//! - http_client.py has a local `_DEFAULT_HEADERS` dict that looks like
//!   config but is request-specific and should stay local
//! - cache.py has a `_CACHE_VERSION = 2` constant that is internal
//!   bookkeeping and should NOT be moved to config
//! - rate_limiter.py has inline numeric literals in type hints and
//!   docstrings that should NOT be replaced with config references

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let http_file = ap(dir, "http_client.py");
        std::fs::write(&http_file, r#"import time

TIMEOUT = 30
MAX_RETRIES = 3

_DEFAULT_HEADERS = {
    "User-Agent": "MyApp/1.0",
    "Accept": "application/json",
}


class HttpClient:
    """Simple HTTP client with retry logic."""

    def __init__(self):
        self.timeout = TIMEOUT
        self.max_retries = MAX_RETRIES

    def get(self, url: str) -> dict:
        """Simulate GET request with retries."""
        for attempt in range(self.max_retries):
            result = self._do_request("GET", url)
            if result["status"] < 500:
                return result
            time.sleep(0.01)
        return {"status": 503, "error": "Max retries exceeded"}

    def _do_request(self, method: str, url: str) -> dict:
        """Simulate a single request."""
        return {"status": 200, "method": method, "url": url,
                "timeout": self.timeout, "headers": dict(_DEFAULT_HEADERS)}

    def get_config(self) -> dict:
        return {"timeout": self.timeout, "max_retries": self.max_retries}
"#).unwrap();

        let cache_file = ap(dir, "cache.py");
        std::fs::write(&cache_file, r#"import time

TTL = 300
MAX_ENTRIES = 1000
_CACHE_VERSION = 2


class Cache:
    """In-memory cache with TTL and max size."""

    def __init__(self):
        self._store = {}
        self._timestamps = {}

    def get(self, key: str):
        """Get value if exists and not expired."""
        if key not in self._store:
            return None
        if time.time() - self._timestamps[key] > TTL:
            del self._store[key]
            del self._timestamps[key]
            return None
        return self._store[key]

    def put(self, key: str, value) -> bool:
        """Store a value. Returns False if cache is full."""
        if len(self._store) >= MAX_ENTRIES and key not in self._store:
            return False
        self._store[key] = value
        self._timestamps[key] = time.time()
        return True

    def size(self) -> int:
        return len(self._store)

    def version(self) -> int:
        return _CACHE_VERSION

    def get_config(self) -> dict:
        return {"ttl": TTL, "max_entries": MAX_ENTRIES}
"#).unwrap();

        let limiter_file = ap(dir, "rate_limiter.py");
        std::fs::write(&limiter_file, r#"import time

RATE_LIMIT = 100
WINDOW = 60


class RateLimiter:
    """Token bucket rate limiter.

    Allows up to 100 requests per 60-second window by default.
    """

    def __init__(self):
        self._requests = []

    def allow(self) -> bool:
        """Check if a request is allowed under the rate limit."""
        now = time.time()
        # Remove requests outside the window
        self._requests = [t for t in self._requests if now - t < WINDOW]
        if len(self._requests) >= RATE_LIMIT:
            return False
        self._requests.append(now)
        return True

    def remaining(self) -> int:
        """Return how many requests are left in the current window."""
        now = time.time()
        self._requests = [t for t in self._requests if now - t < WINDOW]
        return max(0, RATE_LIMIT - len(self._requests))

    def get_config(self) -> dict:
        return {"rate_limit": RATE_LIMIT, "window": WINDOW}
"#).unwrap();

        let worker_file = ap(dir, "worker.py");
        std::fs::write(&worker_file, r#"import time

BATCH_SIZE = 50
POLL_INTERVAL = 5


class Worker:
    """Background job worker that processes items in batches."""

    def __init__(self):
        self._queue = []
        self._processed = 0

    def enqueue(self, items: list):
        self._queue.extend(items)

    def process_batch(self) -> list:
        """Process up to BATCH_SIZE items from the queue."""
        batch = self._queue[:BATCH_SIZE]
        self._queue = self._queue[BATCH_SIZE:]
        self._processed += len(batch)
        return batch

    def pending(self) -> int:
        return len(self._queue)

    def processed_total(self) -> int:
        return self._processed

    def get_config(self) -> dict:
        return {"batch_size": BATCH_SIZE, "poll_interval": POLL_INTERVAL}
"#).unwrap();

        let test_file = ap(dir, "test_config.py");
        std::fs::write(&test_file, r#"import config
from http_client import HttpClient
from cache import Cache
from rate_limiter import RateLimiter
from worker import Worker


def test_config_module_has_all_constants():
    """config.py must define all configuration constants."""
    assert hasattr(config, 'TIMEOUT'), "config missing TIMEOUT"
    assert hasattr(config, 'MAX_RETRIES'), "config missing MAX_RETRIES"
    assert hasattr(config, 'TTL'), "config missing TTL"
    assert hasattr(config, 'MAX_ENTRIES'), "config missing MAX_ENTRIES"
    assert hasattr(config, 'RATE_LIMIT'), "config missing RATE_LIMIT"
    assert hasattr(config, 'WINDOW'), "config missing WINDOW"
    assert hasattr(config, 'BATCH_SIZE'), "config missing BATCH_SIZE"
    assert hasattr(config, 'POLL_INTERVAL'), "config missing POLL_INTERVAL"


def test_config_values_correct():
    """Config values must match the original hardcoded values."""
    assert config.TIMEOUT == 30, f"TIMEOUT should be 30, got {config.TIMEOUT}"
    assert config.MAX_RETRIES == 3, f"MAX_RETRIES should be 3, got {config.MAX_RETRIES}"
    assert config.TTL == 300, f"TTL should be 300, got {config.TTL}"
    assert config.MAX_ENTRIES == 1000, f"MAX_ENTRIES should be 1000, got {config.MAX_ENTRIES}"
    assert config.RATE_LIMIT == 100, f"RATE_LIMIT should be 100, got {config.RATE_LIMIT}"
    assert config.WINDOW == 60, f"WINDOW should be 60, got {config.WINDOW}"
    assert config.BATCH_SIZE == 50, f"BATCH_SIZE should be 50, got {config.BATCH_SIZE}"
    assert config.POLL_INTERVAL == 5, f"POLL_INTERVAL should be 5, got {config.POLL_INTERVAL}"


def test_http_client_uses_config():
    """HttpClient must use config values."""
    c = HttpClient()
    cfg = c.get_config()
    assert cfg["timeout"] == 30
    assert cfg["max_retries"] == 3


def test_http_client_get_works():
    """HttpClient.get must still function correctly."""
    c = HttpClient()
    result = c.get("http://example.com")
    assert result["status"] == 200
    assert result["headers"]["User-Agent"] == "MyApp/1.0"


def test_cache_uses_config():
    """Cache must use config values."""
    c = Cache()
    cfg = c.get_config()
    assert cfg["ttl"] == 300
    assert cfg["max_entries"] == 1000


def test_cache_operations():
    """Cache must still work correctly."""
    c = Cache()
    assert c.put("key1", "value1")
    assert c.get("key1") == "value1"
    assert c.size() == 1


def test_cache_version_unchanged():
    """Cache._CACHE_VERSION should NOT be moved to config."""
    c = Cache()
    assert c.version() == 2


def test_rate_limiter_uses_config():
    """RateLimiter must use config values."""
    rl = RateLimiter()
    cfg = rl.get_config()
    assert cfg["rate_limit"] == 100
    assert cfg["window"] == 60


def test_rate_limiter_operations():
    """RateLimiter must still function correctly."""
    rl = RateLimiter()
    assert rl.allow()
    assert rl.remaining() == 99


def test_worker_uses_config():
    """Worker must use config values."""
    w = Worker()
    cfg = w.get_config()
    assert cfg["batch_size"] == 50
    assert cfg["poll_interval"] == 5


def test_worker_operations():
    """Worker must still function correctly."""
    w = Worker()
    w.enqueue(list(range(120)))
    batch = w.process_batch()
    assert len(batch) == 50
    assert w.pending() == 70
    assert w.processed_total() == 50


def test_no_local_constant_definitions():
    """Original files should import from config, not define locally."""
    import http_client
    import cache
    import rate_limiter
    import worker

    checks = [
        (http_client, ["TIMEOUT", "MAX_RETRIES"]),
        (cache, ["TTL", "MAX_ENTRIES"]),
        (rate_limiter, ["RATE_LIMIT", "WINDOW"]),
        (worker, ["BATCH_SIZE", "POLL_INTERVAL"]),
    ]
    for mod, names in checks:
        source_file = mod.__file__
        with open(source_file) as f:
            source = f.read()
        for name in names:
            for line in source.split("\n"):
                stripped = line.strip()
                if stripped.startswith(name) and "=" in stripped:
                    lhs = stripped.split("=")[0].strip()
                    if lhs == name and "import" not in stripped:
                        assert False, (
                            mod.__name__ + " still has local " + name + ": " + stripped
                        )


if __name__ == "__main__":
    test_config_module_has_all_constants()
    test_config_values_correct()
    test_http_client_uses_config()
    test_http_client_get_works()
    test_cache_uses_config()
    test_cache_operations()
    test_cache_version_unchanged()
    test_rate_limiter_uses_config()
    test_rate_limiter_operations()
    test_worker_uses_config()
    test_worker_operations()
    test_no_local_constant_definitions()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The configuration constants (TIMEOUT, MAX_RETRIES, TTL, MAX_ENTRIES, \
             RATE_LIMIT, WINDOW, BATCH_SIZE, POLL_INTERVAL) are scattered across \
             {}, {}, {}, and {} as hardcoded local constants. \
             Create a new config.py file that centralizes all of them, then update \
             each file to import its constants from config.py instead of defining \
             them locally.\n\n\
             Keep all values the same. Do NOT move `_DEFAULT_HEADERS` from \
             http_client.py or `_CACHE_VERSION` from cache.py — those are \
             internal to their respective modules.\n\n\
             Step 1: Read all files and identify every constant to extract.\n\
             Step 2: Create config.py and update all files WITHOUT running code first.\n\
             Step 3: Run the existing `python3 test_config.py` to verify. If tests fail, \
             read the errors and iterate until all tests pass.",
            http_file, cache_file, limiter_file, worker_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_config.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![http_file, cache_file, limiter_file, worker_file]),
            vec![test_file])
    }
    v.push(scen!("v2_cross_file_05_extract_config", Category::CrossFile, Difficulty::Hard, I, setup));
}
