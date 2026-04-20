//! Search — Test 01: Git-bisect regression hunt (Python + git)
//!
//! The setup builds a REAL git repository with 15 commits. `pagination.py`
//! starts out correct at commit 1, and commit 9 introduces an off-by-one
//! in `page_slice`. Commits 10-15 add unrelated features. The regression
//! is therefore only visible on HEAD (the test suite fails), not on
//! earlier commits.
//!
//! The task forces the model to use `git log` / `git bisect` / `git show`
//! — the source on HEAD alone doesn't reveal "what changed". It also
//! exercises the model's ability to report findings: the rubric requires
//! the buggy commit's SHA prefix to appear in the final response text.

use std::path::Path;
use std::process::Command;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        // Initialise the git repo. We pin the author + date so commit hashes
        // would be deterministic if the harness ever wanted to hard-code
        // them — but we let them drift naturally here and read the bad SHA
        // back at the end.
        run_git(dir, &["init", "-q", "-b", "main"]);
        run_git(dir, &["config", "user.email", "eval@cotect.local"]);
        run_git(dir, &["config", "user.name",  "cotect-eval"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        // Helper: write a file, stage it, commit with a subject.
        let commit = |rel: &str, content: &str, subject: &str| {
            let p = dir.join(rel);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&p, content).unwrap();
            run_git(dir, &["add", rel]);
            run_git(dir, &["commit", "-q", "-m", subject]);
        };

        // Commit 1: initial correct pagination.
        commit(
            "pagination.py",
            r#""""Pagination helper."""


def page_slice(items, page, per_page):
    """Return the items on `page` (1-indexed) with `per_page` items per page."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be >= 1")
    start = (page - 1) * per_page
    end = start + per_page
    return items[start:end]


def total_pages(total_items, per_page):
    if per_page < 1:
        raise ValueError("per_page must be >= 1")
    if total_items <= 0:
        return 0
    return (total_items + per_page - 1) // per_page
"#,
            "initial pagination helper",
        );

        commit(
            "README.md",
            "# Pagination sandbox\n\nTiny helper library for integration tests.\n",
            "add README",
        );

        commit(
            "LICENSE",
            "Copyright 2025. Eval fixture — all rights reserved.\n",
            "add LICENSE",
        );

        commit(
            "pagination.py",
            r#""""Pagination helper."""


def page_slice(items, page, per_page):
    """Return the items on `page` (1-indexed) with `per_page` items per page."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be >= 1")
    start = (page - 1) * per_page
    end = start + per_page
    return items[start:end]


def total_pages(total_items, per_page):
    if per_page < 1:
        raise ValueError("per_page must be >= 1")
    if total_items <= 0:
        return 0
    return (total_items + per_page - 1) // per_page


def clamp_page(page, total_items, per_page):
    """Clamp a requested page number into the valid range."""
    last = total_pages(total_items, per_page) or 1
    return max(1, min(page, last))
"#,
            "add clamp_page helper",
        );

        commit(
            "docs/usage.md",
            "## Usage\n\nCall `page_slice(items, page, per_page)`.\n",
            "docs: initial usage guide",
        );

        commit(
            "docs/usage.md",
            "## Usage\n\nCall `page_slice(items, page, per_page)`.\n\n\
             `clamp_page` is useful for defensive UI code.\n",
            "docs: mention clamp_page",
        );

        commit(
            "CHANGELOG.md",
            "## Unreleased\n\n- initial version\n",
            "add CHANGELOG",
        );

        commit(
            "pagination.py",
            r#""""Pagination helper."""


def page_slice(items, page, per_page):
    """Return the items on `page` (1-indexed) with `per_page` items per page."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be >= 1")
    start = (page - 1) * per_page
    end = start + per_page
    return items[start:end]


def total_pages(total_items, per_page):
    if per_page < 1:
        raise ValueError("per_page must be >= 1")
    if total_items <= 0:
        return 0
    return (total_items + per_page - 1) // per_page


def clamp_page(page, total_items, per_page):
    """Clamp a requested page number into the valid range."""
    last = total_pages(total_items, per_page) or 1
    return max(1, min(page, last))


def page_window(page, total_pages_n, radius=2):
    """Return the [start, end] page numbers for a pagination UI window."""
    start = max(1, page - radius)
    end = min(total_pages_n, page + radius)
    return (start, end)
"#,
            "add page_window helper",
        );

        // --- Commit 9: introduces the BUG ---
        // Off-by-one in page_slice: `end = start + per_page - 1`.
        // `items[start:end]` then returns per_page-1 items instead of per_page.
        commit(
            "pagination.py",
            r#""""Pagination helper."""


def page_slice(items, page, per_page):
    """Return the items on `page` (1-indexed) with `per_page` items per page."""
    if page < 1 or per_page < 1:
        raise ValueError("page and per_page must be >= 1")
    start = (page - 1) * per_page
    # "simplification" — actually introduces an off-by-one at the end slice.
    end = start + per_page - 1
    return items[start:end]


def total_pages(total_items, per_page):
    if per_page < 1:
        raise ValueError("per_page must be >= 1")
    if total_items <= 0:
        return 0
    return (total_items + per_page - 1) // per_page


def clamp_page(page, total_items, per_page):
    """Clamp a requested page number into the valid range."""
    last = total_pages(total_items, per_page) or 1
    return max(1, min(page, last))


def page_window(page, total_pages_n, radius=2):
    """Return the [start, end] page numbers for a pagination UI window."""
    start = max(1, page - radius)
    end = min(total_pages_n, page + radius)
    return (start, end)
"#,
            "refactor: simplify page_slice end computation",
        );

        // Capture the bad commit SHA.
        let bad_sha = run_git_output(dir, &["rev-parse", "HEAD"]).trim().to_string();
        let bad_short: String = bad_sha.chars().take(7).collect();

        // Commits 10-15: unrelated work.
        commit("CHANGELOG.md",
            "## Unreleased\n\n- initial version\n- page_window helper\n- refactor: simpler slice math\n",
            "changelog: refactor note");
        commit("docs/usage.md",
            "## Usage\n\n`page_slice(items, page, per_page)` is the main helper.\n\n\
             `clamp_page` for defensive UI code, `page_window` for rendering a window.\n",
            "docs: expand usage");
        commit(".gitignore",
            "__pycache__/\n*.pyc\n.pytest_cache/\n",
            "add .gitignore");
        commit("docs/api.md",
            "## API\n\nSee `pagination.py` for the full surface.\n",
            "docs: add API overview");
        commit("CHANGELOG.md",
            "## Unreleased\n\n- initial version\n- page_window helper\n- refactor: simpler slice math\n- docs polish\n",
            "changelog: docs polish");
        commit("docs/usage.md",
            "## Usage\n\n`page_slice(items, page, per_page)` is the main helper.\n\n\
             `clamp_page` for defensive UI code; `page_window` renders the UI.\n\n\
             ### Examples\n\nSee `tests/` for concrete invocations.\n",
            "docs: mention tests");

        // Test harness on HEAD — fails because of the commit-9 bug.
        commit(
            "test_pagination.py",
            r#""""Integration tests that must pass on HEAD after the fix."""

from pagination import page_slice, total_pages, clamp_page, page_window


def test_page_slice_returns_full_page():
    items = list(range(1, 21))  # 1..20
    assert page_slice(items, 1, 5) == [1, 2, 3, 4, 5]
    assert page_slice(items, 2, 5) == [6, 7, 8, 9, 10]
    assert page_slice(items, 4, 5) == [16, 17, 18, 19, 20]


def test_page_slice_partial_page():
    items = list(range(1, 8))  # 1..7
    assert page_slice(items, 1, 3) == [1, 2, 3]
    assert page_slice(items, 3, 3) == [7]
    assert page_slice(items, 4, 3) == []


def test_total_pages():
    assert total_pages(0, 10) == 0
    assert total_pages(10, 10) == 1
    assert total_pages(11, 10) == 2


def test_clamp_and_window():
    assert clamp_page(5, 30, 10) == 3
    assert clamp_page(0, 30, 10) == 1
    assert page_window(3, 10, 2) == (1, 5)
    assert page_window(8, 10, 2) == (6, 10)


if __name__ == "__main__":
    test_page_slice_returns_full_page()
    test_page_slice_partial_page()
    test_total_pages()
    test_clamp_and_window()
    print("ALL_TESTS_PASSED")
"#,
            "tests: pagination integration",
        );

        // Prompt that embeds the expected short-SHA shape so the model knows
        // what "report the bad commit" means.
        let prompt = format!(
            "The `pagination` repo in this tempdir has a regression: \
             `python3 test_pagination.py` fails on HEAD, but it used to pass. \
             Use `git log` / `git bisect` / `git show` to find the commit \
             that introduced the bug, fix the bug on HEAD, and make the \
             tests pass.\n\n\
             In your FINAL response text (not just in a commit message or \
             shell output), include the 7-character abbreviated SHA of the \
             bad commit so the rubric can confirm you identified it. \
             Example format: `bad commit: {}`.",
            &bad_short,
        );

        let mut scope = vec![ap(dir, "pagination.py"), ap(dir, "test_pagination.py")];
        scope.push(ap(dir, "README.md"));

        with_scope(with_checks(pf(prompt),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_pagination.py", &["ALL_TESTS_PASSED"]),
                // Final output must mention the 7-char bad-commit prefix.
                Check::OutputContains(bad_short.clone()),
            ]),
            scope)
    }
    v.push(scen!(
        "xhard_search_01_git_regression",
        Category::Search, Difficulty::Hard, I, setup,
        tools = &["git", "python3"]
    ));
}

fn run_git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status();
    if !matches!(status, Ok(s) if s.success()) {
        panic!("git {:?} failed in {:?}", args, dir);
    }
}

fn run_git_output(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git output");
    String::from_utf8(output.stdout).expect("git stdout utf8")
}
