//! Implement v2 — Test 05: Add middleware pipeline to existing HTTP handler
//!
//! A 3-file HTTP request handling system with `request.py` (Request/Response
//! classes), `handlers.py` (route handlers), and `app.py` (application
//! router). The model must implement a middleware system that can intercept
//! requests before handlers and responses after handlers.
//!
//! The model must:
//! 1. Implement `Middleware` base class in `middleware.py`
//! 2. Implement `LoggingMiddleware` that logs requests
//! 3. Implement `AuthMiddleware` that checks for auth tokens
//! 4. Implement `CorsMiddleware` that adds CORS headers to responses
//! 5. Wire middleware into App so they execute in order
//!
//! Existing patterns to follow:
//! - Request/Response use dict-like headers
//! - Handlers are simple functions taking Request, returning Response
//! - App.route() registers path -> handler mappings
//!
//! Hidden test coverage:
//! - Middleware executes in registration order
//! - AuthMiddleware short-circuits (returns 401 without calling handler)
//! - CorsMiddleware adds headers to ALL responses
//! - Middleware interacts correctly with existing route handling
//! - Unknown routes still return 404 even with middleware

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let request_file = ap(dir, "request.py");
        std::fs::write(&request_file, r#"class Request:
    """HTTP request object."""

    def __init__(self, method: str, path: str, headers: dict | None = None,
                 body: str = ""):
        self.method = method
        self.path = path
        self.headers = headers or {}
        self.body = body

    def get_header(self, name: str, default: str = "") -> str:
        """Get a header value (case-insensitive lookup)."""
        for key, value in self.headers.items():
            if key.lower() == name.lower():
                return value
        return default


class Response:
    """HTTP response object."""

    def __init__(self, status: int = 200, body: str = "",
                 headers: dict | None = None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    def set_header(self, name: str, value: str) -> None:
        """Set a response header."""
        self.headers[name] = value

    def to_dict(self) -> dict:
        """Convert to a dictionary for easy testing."""
        return {
            "status": self.status,
            "body": self.body,
            "headers": dict(self.headers),
        }
"#).unwrap();

        let handlers_file = ap(dir, "handlers.py");
        std::fs::write(&handlers_file, r#"from request import Request, Response


def handle_home(request: Request) -> Response:
    """Handle GET /"""
    return Response(200, "Welcome home")


def handle_users(request: Request) -> Response:
    """Handle GET /users"""
    return Response(200, '{"users": ["Alice", "Bob"]}',
                    {"Content-Type": "application/json"})


def handle_create_user(request: Request) -> Response:
    """Handle POST /users"""
    if not request.body:
        return Response(400, "Body required")
    return Response(201, f"Created: {request.body}")


def handle_health(request: Request) -> Response:
    """Handle GET /health"""
    return Response(200, "OK")
"#).unwrap();

        let app_file = ap(dir, "app.py");
        std::fs::write(&app_file, r#"from request import Request, Response


class App:
    """Simple HTTP application router."""

    def __init__(self):
        self._routes: dict[tuple[str, str], callable] = {}
        self._middleware: list = []

    def route(self, method: str, path: str, handler) -> None:
        """Register a route handler."""
        self._routes[(method.upper(), path)] = handler

    def _find_handler(self, method: str, path: str):
        """Find a handler for the given method and path."""
        return self._routes.get((method.upper(), path))

    def handle(self, request: Request) -> Response:
        """Process a request through middleware and routing.

        Currently just routes directly to handlers.
        """
        handler = self._find_handler(request.method, request.path)
        if handler is None:
            return Response(404, "Not Found")
        return handler(request)

    # TODO: implement use(self, middleware) -> None
    # Add a middleware to the pipeline. Middleware should be applied in
    # the order they are added (first added = first to process request).
    #
    # The handle() method must be updated to run the request through
    # all middleware before reaching the handler, and the response
    # through all middleware after the handler (in reverse order).
    #
    # Each middleware has:
    #   process_request(request: Request) -> Request | Response
    #     - If it returns a Request, continue the chain
    #     - If it returns a Response, short-circuit (skip handler and
    #       remaining request middleware, but still run response middleware)
    #   process_response(response: Response) -> Response
    #     - Always called, even on short-circuit, to allow cleanup/header adding
"#).unwrap();

        let middleware_file = ap(dir, "middleware.py");
        std::fs::write(&middleware_file, r#"from request import Request, Response


# TODO: implement the following middleware classes.
# Each must have:
#   process_request(self, request: Request) -> Request | Response
#   process_response(self, response: Response) -> Response


# LoggingMiddleware:
#   - Has a 'log' attribute (list of strings)
#   - process_request: appends "{method} {path}" to self.log, returns request
#   - process_response: returns response unchanged

# AuthMiddleware:
#   - __init__(self, token: str) - the valid auth token
#   - process_request: checks for "Authorization" header matching
#     "Bearer {token}". If missing or wrong, returns Response(401, "Unauthorized").
#     If valid, returns request.
#   - process_response: returns response unchanged

# CorsMiddleware:
#   - __init__(self, allowed_origin: str = "*")
#   - process_request: returns request unchanged
#   - process_response: adds these headers to every response:
#       "Access-Control-Allow-Origin": self.allowed_origin
#       "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE"
#     returns the modified response
"#).unwrap();

        let test_file = ap(dir, "test_app.py");
        std::fs::write(&test_file, r#"from request import Request, Response
from handlers import handle_home, handle_users, handle_create_user, handle_health
from app import App
from middleware import LoggingMiddleware, AuthMiddleware, CorsMiddleware


def _make_app(with_auth=False, auth_token="secret"):
    app = App()
    app.route("GET", "/", handle_home)
    app.route("GET", "/users", handle_users)
    app.route("POST", "/users", handle_create_user)
    app.route("GET", "/health", handle_health)
    return app


def test_basic_routing_still_works():
    app = _make_app()
    req = Request("GET", "/")
    resp = app.handle(req)
    assert resp.status == 200
    assert resp.body == "Welcome home"


def test_404_for_unknown_route():
    app = _make_app()
    req = Request("GET", "/unknown")
    resp = app.handle(req)
    assert resp.status == 404


def test_logging_middleware():
    app = _make_app()
    logger = LoggingMiddleware()
    app.use(logger)

    app.handle(Request("GET", "/"))
    app.handle(Request("GET", "/users"))

    assert len(logger.log) == 2, f"expected 2 log entries, got {len(logger.log)}"
    assert logger.log[0] == "GET /"
    assert logger.log[1] == "GET /users"


def test_auth_middleware_blocks_unauthorized():
    app = _make_app()
    auth = AuthMiddleware("my-token")
    app.use(auth)

    req = Request("GET", "/users")
    resp = app.handle(req)
    assert resp.status == 401, f"expected 401, got {resp.status}"


def test_auth_middleware_allows_authorized():
    app = _make_app()
    auth = AuthMiddleware("my-token")
    app.use(auth)

    req = Request("GET", "/users", headers={"Authorization": "Bearer my-token"})
    resp = app.handle(req)
    assert resp.status == 200, f"expected 200, got {resp.status}"


def test_cors_middleware_adds_headers():
    app = _make_app()
    cors = CorsMiddleware("https://example.com")
    app.use(cors)

    req = Request("GET", "/")
    resp = app.handle(req)
    assert resp.headers.get("Access-Control-Allow-Origin") == "https://example.com", \
        f"missing CORS origin header: {resp.headers}"
    assert "Access-Control-Allow-Methods" in resp.headers


def test_cors_on_404():
    app = _make_app()
    cors = CorsMiddleware()
    app.use(cors)

    req = Request("GET", "/nonexistent")
    resp = app.handle(req)
    assert resp.status == 404
    assert "Access-Control-Allow-Origin" in resp.headers, \
        "CORS headers should be added even on 404"


def test_middleware_order():
    app = _make_app()
    logger = LoggingMiddleware()
    auth = AuthMiddleware("tok")
    cors = CorsMiddleware()

    app.use(logger)
    app.use(auth)
    app.use(cors)

    req = Request("GET", "/", headers={"Authorization": "Bearer tok"})
    resp = app.handle(req)

    assert resp.status == 200
    assert len(logger.log) == 1, "logger should have recorded the request"
    assert "Access-Control-Allow-Origin" in resp.headers


def test_auth_short_circuit_still_gets_cors():
    app = _make_app()
    auth = AuthMiddleware("tok")
    cors = CorsMiddleware()
    app.use(auth)
    app.use(cors)

    req = Request("GET", "/users")
    resp = app.handle(req)
    assert resp.status == 401
    assert "Access-Control-Allow-Origin" in resp.headers, \
        "CORS should be added even when auth short-circuits"


def test_logging_with_auth_short_circuit():
    app = _make_app()
    logger = LoggingMiddleware()
    auth = AuthMiddleware("tok")
    app.use(logger)
    app.use(auth)

    app.handle(Request("GET", "/"))
    assert len(logger.log) == 1, \
        "logger runs before auth, should log even on auth failure"


def test_post_with_middleware():
    app = _make_app()
    auth = AuthMiddleware("tok")
    cors = CorsMiddleware()
    app.use(auth)
    app.use(cors)

    req = Request("POST", "/users",
                  headers={"Authorization": "Bearer tok"},
                  body='{"name": "Charlie"}')
    resp = app.handle(req)
    assert resp.status == 201
    assert "Charlie" in resp.body
    assert "Access-Control-Allow-Origin" in resp.headers


def test_no_middleware_still_works():
    app = _make_app()
    req = Request("GET", "/health")
    resp = app.handle(req)
    assert resp.status == 200
    assert resp.body == "OK"


if __name__ == "__main__":
    test_basic_routing_still_works()
    test_404_for_unknown_route()
    test_logging_middleware()
    test_auth_middleware_blocks_unauthorized()
    test_auth_middleware_allows_authorized()
    test_cors_middleware_adds_headers()
    test_cors_on_404()
    test_middleware_order()
    test_auth_short_circuit_still_gets_cors()
    test_logging_with_auth_short_circuit()
    test_post_with_middleware()
    test_no_middleware_still_works()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(format!(
            "The HTTP application in {} needs a middleware system. Implement \
             the `use()` method on App and update `handle()` to run requests \
             through middleware. Also implement the three middleware classes \
             in {}: LoggingMiddleware, AuthMiddleware, and CorsMiddleware.\n\n\
             Step 1: Read all source files and understand the request/response \
             flow, then implement the middleware system WITHOUT running the \
             code first.\n\
             Step 2: Run `python3 test_app.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             implementation, and re-run until all tests pass.",
            app_file, middleware_file)),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_app.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![request_file, handlers_file, app_file, middleware_file]),
            vec![test_file])
    }
    v.push(scen!("v2_implement_05_middleware_pipeline", Category::Implement, Difficulty::Hard, I, setup));
}
