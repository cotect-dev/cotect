//! Patch v2 — Test 05: Multi-file middleware insertion with dependency chain
//!
//! A 4-file HTTP middleware pipeline where a new "rate limit" header must
//! be threaded through. The task is to add a `X-RateLimit-Remaining` header
//! that starts at the limiter, passes through the chain, and appears in
//! the final response.
//!
//! Files:
//! - limiter.py: Rate limiter that must ADD the header to context
//! - middleware.py: 3 middleware classes in a chain; `LoggingMiddleware`
//!   must PASS the header through, `AuthMiddleware` must NOT strip it,
//!   and `CorsMiddleware` has its own header logic that must be untouched
//! - handler.py: Request handler that must include the header in response
//! - pipeline.py: Orchestrator that wires everything together
//!
//! The challenge: middleware.py has 3 nearly identical `process()` methods.
//! Only `LoggingMiddleware` and `AuthMiddleware` need changes (to not drop
//! headers from context), while `CorsMiddleware` has its own independent
//! headers dict that must NOT be confused with the rate limit header.
//!
//! Red herrings:
//! - CorsMiddleware already adds `X-` prefixed headers — model might think
//!   rate limit header should go there too (wrong, it comes from limiter)
//! - pipeline.py has a `_debug_headers()` method that logs all headers —
//!   it should NOT be modified
//! - limiter.py has a `_reset_window()` that looks like it should be
//!   called but is correctly managed by time-based expiry

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let limiter_file = ap(dir, "limiter.py");
        std::fs::write(&limiter_file, r#"import time


class RateLimiter:
    """Token-bucket rate limiter for the middleware pipeline."""

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._tokens = max_requests
        self._window_start = time.monotonic()

    def _reset_window(self):
        """Reset the token bucket. Called automatically when the window expires."""
        self._tokens = self.max_requests
        self._window_start = time.monotonic()

    def check(self, context: dict) -> dict:
        """Check rate limit and return updated context.

        If allowed, decrements tokens and returns context with allowed=True.
        If denied, returns context with allowed=False.

        Does NOT currently add rate limit headers to context — this needs
        to be added.
        """
        now = time.monotonic()
        if now - self._window_start >= self.window_seconds:
            self._reset_window()

        if self._tokens > 0:
            self._tokens -= 1
            context["allowed"] = True
        else:
            context["allowed"] = False

        return context

    @property
    def remaining(self) -> int:
        return self._tokens
"#).unwrap();

        let middleware_file = ap(dir, "middleware.py");
        std::fs::write(&middleware_file, r#""""Request processing middleware chain."""


class LoggingMiddleware:
    """Logs request details and passes through."""

    def __init__(self):
        self.log = []

    def process(self, context: dict) -> dict:
        """Log the request and pass context to next middleware."""
        path = context.get("path", "/unknown")
        method = context.get("method", "GET")
        self.log.append(f"{method} {path}")

        # Pass through all context fields
        return {
            "path": context.get("path"),
            "method": context.get("method"),
            "body": context.get("body"),
            "allowed": context.get("allowed", True),
        }


class AuthMiddleware:
    """Validates authentication tokens."""

    def __init__(self, valid_tokens: list[str]):
        self.valid_tokens = valid_tokens

    def process(self, context: dict) -> dict:
        """Check auth token and pass context through."""
        token = context.get("auth_token", "")
        is_authed = token in self.valid_tokens

        return {
            "path": context.get("path"),
            "method": context.get("method"),
            "body": context.get("body"),
            "allowed": context.get("allowed", True) and is_authed,
            "authenticated": is_authed,
        }


class CorsMiddleware:
    """Adds CORS headers to the response context.

    This middleware manages its OWN set of headers independently.
    These are response headers, not request context headers.
    """

    CORS_HEADERS = {
        "X-Cors-Allow-Origin": "*",
        "X-Cors-Allow-Methods": "GET, POST, PUT, DELETE",
        "X-Cors-Max-Age": "3600",
    }

    def process(self, context: dict) -> dict:
        """Add CORS headers and pass through."""
        response_headers = dict(self.CORS_HEADERS)

        return {
            "path": context.get("path"),
            "method": context.get("method"),
            "body": context.get("body"),
            "allowed": context.get("allowed", True),
            "authenticated": context.get("authenticated", False),
            "response_headers": response_headers,
        }
"#).unwrap();

        let handler_file = ap(dir, "handler.py");
        std::fs::write(&handler_file, r#""""Request handler — produces the final HTTP response."""


def handle_request(context: dict) -> dict:
    """Generate an HTTP response from the processed context.

    Returns a response dict with status, body, and headers.
    """
    if not context.get("allowed", False):
        status = 403 if not context.get("authenticated", True) else 429
        return {
            "status": status,
            "body": {"error": "Access denied"},
            "headers": context.get("response_headers", {}),
        }

    # Normal response
    headers = context.get("response_headers", {})

    return {
        "status": 200,
        "body": {"message": "OK", "path": context.get("path", "/")},
        "headers": headers,
    }
"#).unwrap();

        let pipeline_file = ap(dir, "pipeline.py");
        std::fs::write(&pipeline_file, r#""""Pipeline orchestrator — wires middleware together."""

from limiter import RateLimiter
from middleware import LoggingMiddleware, AuthMiddleware, CorsMiddleware
from handler import handle_request


class Pipeline:
    """HTTP request processing pipeline.

    Order: RateLimiter -> LoggingMiddleware -> AuthMiddleware
           -> CorsMiddleware -> Handler
    """

    def __init__(self, max_rps: int = 10, valid_tokens: list[str] = None):
        self.limiter = RateLimiter(max_rps, 1.0)
        self.logger = LoggingMiddleware()
        self.auth = AuthMiddleware(valid_tokens or ["valid-token"])
        self.cors = CorsMiddleware()

    def execute(self, request: dict) -> dict:
        """Process a request through the full pipeline."""
        context = dict(request)
        context = self.limiter.check(context)
        context = self.logger.process(context)
        context = self.auth.process(context)
        context = self.cors.process(context)
        return handle_request(context)

    def _debug_headers(self, context: dict) -> None:
        """Debug helper — print all headers in context. Do NOT modify."""
        headers = context.get("response_headers", {})
        for key, value in sorted(headers.items()):
            print(f"  {key}: {value}")


def quick_request(path: str, token: str = "valid-token") -> dict:
    """Convenience function for quick single requests."""
    pipe = Pipeline(max_rps=100, valid_tokens=[token])
    return pipe.execute({
        "path": path,
        "method": "GET",
        "auth_token": token,
    })
"#).unwrap();

        let test_file = ap(dir, "test_pipeline.py");
        std::fs::write(&test_file, r#"from pipeline import Pipeline, quick_request
from limiter import RateLimiter


def test_rate_limit_header_present():
    """Response must include X-RateLimit-Remaining header."""
    pipe = Pipeline(max_rps=10, valid_tokens=["tok"])
    resp = pipe.execute({"path": "/api/data", "method": "GET", "auth_token": "tok"})
    assert resp["status"] == 200
    assert "X-RateLimit-Remaining" in resp["headers"], \
        f"Missing X-RateLimit-Remaining header in: {resp['headers']}"


def test_rate_limit_header_decrements():
    """X-RateLimit-Remaining should decrease with each request."""
    pipe = Pipeline(max_rps=5, valid_tokens=["tok"])

    resp1 = pipe.execute({"path": "/a", "method": "GET", "auth_token": "tok"})
    remaining1 = int(resp1["headers"]["X-RateLimit-Remaining"])

    resp2 = pipe.execute({"path": "/b", "method": "GET", "auth_token": "tok"})
    remaining2 = int(resp2["headers"]["X-RateLimit-Remaining"])

    assert remaining1 == 4, f"After 1st request with 5 max, should have 4, got {remaining1}"
    assert remaining2 == 3, f"After 2nd request, should have 3, got {remaining2}"


def test_rate_limit_header_on_denied():
    """Even denied requests should show the rate limit header."""
    pipe = Pipeline(max_rps=1, valid_tokens=["tok"])

    # First request uses the token
    pipe.execute({"path": "/a", "method": "GET", "auth_token": "tok"})

    # Second request should be rate-limited
    resp = pipe.execute({"path": "/b", "method": "GET", "auth_token": "tok"})
    assert "X-RateLimit-Remaining" in resp["headers"], \
        f"Rate-limited response should still have header: {resp['headers']}"
    assert int(resp["headers"]["X-RateLimit-Remaining"]) == 0


def test_cors_headers_still_present():
    """CORS headers must not be lost."""
    resp = quick_request("/test")
    assert "X-Cors-Allow-Origin" in resp["headers"], \
        f"CORS header missing: {resp['headers']}"
    assert resp["headers"]["X-Cors-Allow-Origin"] == "*"


def test_cors_headers_unchanged():
    """CORS headers must have their original values."""
    resp = quick_request("/test")
    assert resp["headers"]["X-Cors-Allow-Methods"] == "GET, POST, PUT, DELETE"
    assert resp["headers"]["X-Cors-Max-Age"] == "3600"


def test_auth_still_works():
    """Invalid tokens should still be rejected."""
    pipe = Pipeline(max_rps=10, valid_tokens=["good-token"])
    resp = pipe.execute({
        "path": "/secret",
        "method": "GET",
        "auth_token": "bad-token",
    })
    assert resp["status"] == 403, f"Bad token should get 403, got {resp['status']}"


def test_quick_request_convenience():
    """quick_request should return a successful response with rate limit."""
    resp = quick_request("/hello", token="valid-token")
    assert resp["status"] == 200
    assert "X-RateLimit-Remaining" in resp["headers"]


if __name__ == "__main__":
    test_rate_limit_header_present()
    test_rate_limit_header_decrements()
    test_rate_limit_header_on_denied()
    test_cors_headers_still_present()
    test_cors_headers_unchanged()
    test_auth_still_works()
    test_quick_request_convenience()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "We need to thread a `X-RateLimit-Remaining` header through the \
             HTTP middleware pipeline so it appears in every response. The header \
             value should be the number of remaining requests in the rate limiter.\n\n\
             The rate limiter must set this value in the context, the middleware \
             chain must preserve it through each stage, and the handler must \
             include it in the response headers.\n\n\
             IMPORTANT: Don't modify CorsMiddleware's CORS_HEADERS or the \
             pipeline's _debug_headers method.\n\n\
             Step 1: Read all source files and trace the context flow.\n\
             Step 2: Apply coordinated patches WITHOUT running the code first.\n\
             Step 3: Run the existing `python3 test_pipeline.py` to verify. If tests fail, \
             read the errors and iterate until all tests pass.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: test suite must pass — it verifies the rate limit
                // header is present, decrements, appears on denied requests,
                // CORS headers are preserved, and auth still works.
                run_has("python3 test_pipeline.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![limiter_file, middleware_file, handler_file, pipeline_file]),
            vec![test_file])
    }
    v.push(scen!("xhard_patch_05_middleware_header_threading", Category::Patch, Difficulty::Hard, I, setup));
}
