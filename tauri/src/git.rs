use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

/// Read cap for untracked-line counting. Bounds `git_status` runtime when
/// the user has large generated artifacts they haven't .gitignored yet.
const UNTRACKED_LINE_COUNT_MAX_BYTES: u64 = 1024 * 1024; // 1 MiB

/// Newline count of an untracked file. Returns `None` for binary, unreadable,
/// or oversized files — caller leaves `insertions` at 0 in those cases.
fn count_untracked_lines(repo_path: &str, rel_path: &str) -> Option<u32> {
    let full = Path::new(repo_path).join(rel_path);
    let meta = std::fs::metadata(&full).ok()?;
    if !meta.is_file() || meta.len() > UNTRACKED_LINE_COUNT_MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(&full).ok()?;
    if bytes.contains(&0u8) {
        return None;
    }
    if bytes.is_empty() {
        return Some(0);
    }
    let trailing_newline = bytes.ends_with(b"\n");
    let lines = bytes.iter().filter(|&&b| b == b'\n').count() as u32;
    Some(if trailing_newline { lines } else { lines + 1 })
}

const GIT_NOT_FOUND: &str = "GIT_NOT_FOUND";
const NOT_A_REPO: &str = "NOT_A_REPO";
const GIT_TIMEOUT_STR: &str = "GIT_TIMEOUT";
const GIT_TIMEOUT: Duration = Duration::from_secs(15);

async fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(["-C", repo_path, "--no-optional-locks"]).args(args);
    cmd.kill_on_drop(true);

    let fut = async move {
        let output = cmd
            .output()
            .await
            .map_err(|_| GIT_NOT_FOUND.to_string())?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if stderr.contains("not a git repository") {
                Err(NOT_A_REPO.to_string())
            } else {
                Err(stderr)
            }
        }
    };

    match timeout(GIT_TIMEOUT, fut).await {
        Ok(result) => result,
        Err(_) => Err(GIT_TIMEOUT_STR.to_string()),
    }
}

#[derive(Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct GitStatus {
    pub files: Vec<GitFileStatus>,
    pub total_insertions: u32,
    pub total_deletions: u32,
}

fn parse_numstat(numstat: &str) -> HashMap<String, (u32, u32)> {
    let mut stats: HashMap<String, (u32, u32)> = HashMap::new();
    for line in numstat.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() == 3 {
            let ins = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            let entry = stats.entry(parts[2].to_string()).or_insert((0, 0));
            entry.0 += ins;
            entry.1 += del;
        }
    }
    stats
}

fn parse_porcelain(porcelain: &str, stats: &HashMap<String, (u32, u32)>) -> (Vec<GitFileStatus>, u32, u32) {
    let mut files = Vec::new();
    let mut total_insertions = 0u32;
    let mut total_deletions = 0u32;

    for line in porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let status_code = line[..2].trim();
        let path = line[3..].to_string();
        if status_code == "??" {
            files.push(GitFileStatus {
                path,
                status: "U".to_string(),
                insertions: 0,
                deletions: 0,
            });
            continue;
        }
        let status = match status_code {
            "M" | "MM" | "AM" => "M",
            "A" => "A",
            "D" => "D",
            "R" | "RM" => "R",
            _ => "M",
        }
        .to_string();

        let (ins, del) = stats.get(&path).copied().unwrap_or((0, 0));
        total_insertions += ins;
        total_deletions += del;

        files.push(GitFileStatus {
            path,
            status,
            insertions: ins,
            deletions: del,
        });
    }

    (files, total_insertions, total_deletions)
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let porcelain = run_git(&repo_path, &["status", "--porcelain"]).await?;
    let numstat = run_git(&repo_path, &["diff", "--numstat"]).await.unwrap_or_default();
    let cached_numstat = run_git(&repo_path, &["diff", "--cached", "--numstat"]).await.unwrap_or_default();

    let mut stats = parse_numstat(&numstat);
    for (path, (ins, del)) in parse_numstat(&cached_numstat) {
        let entry = stats.entry(path).or_insert((0, 0));
        entry.0 += ins;
        entry.1 += del;
    }

    let (mut files, mut total_insertions, total_deletions) = parse_porcelain(&porcelain, &stats);

    // Backfill insertion counts for untracked files — git reports no diff
    // for them, but visually they're pure additions ("+N" in the UI).
    for f in files.iter_mut().filter(|f| f.status == "U") {
        if let Some(n) = count_untracked_lines(&repo_path, &f.path) {
            f.insertions = n;
            total_insertions += n;
        }
    }

    Ok(GitStatus {
        files,
        total_insertions,
        total_deletions,
    })
}

#[derive(Serialize)]
pub struct GitLogFile {
    pub path: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
    pub insertions: u32,
    pub deletions: u32,
    pub files: Vec<GitLogFile>,
}

fn parse_log_output(output: &str) -> Vec<GitLogEntry> {
    let mut entries = Vec::new();
    let mut lines = output.lines().peekable();

    while lines.peek().is_some() {
        let hash = match lines.next() {
            Some(h) if !h.is_empty() => h.to_string(),
            _ => break,
        };
        let message = lines.next().unwrap_or("").to_string();
        let author = lines.next().unwrap_or("").to_string();
        let timestamp: i64 = lines
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);

        lines.next(); // skip "---END---"

        // Skip blank line between format output and numstat.
        if let Some(line) = lines.peek() {
            if line.is_empty() {
                lines.next();
            }
        }

        let mut files = Vec::new();
        let mut total_ins = 0u32;
        let mut total_del = 0u32;

        while let Some(line) = lines.peek() {
            if line.is_empty() {
                lines.next();
                break;
            }
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() != 3 {
                break;
            }
            let ins = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            total_ins += ins;
            total_del += del;
            files.push(GitLogFile {
                path: parts[2].to_string(),
                insertions: ins,
                deletions: del,
            });
            lines.next();
        }

        entries.push(GitLogEntry {
            hash: hash[..7.min(hash.len())].to_string(),
            message,
            author,
            timestamp,
            insertions: total_ins,
            deletions: total_del,
            files,
        });
    }

    entries
}

#[tauri::command]
pub async fn git_log(repo_path: String, limit: Option<u32>, skip: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let mut args = vec!["log", &limit_str];
    let skip_str;
    if let Some(s) = skip {
        skip_str = format!("--skip={s}");
        args.push(&skip_str);
    }
    args.extend_from_slice(&["--format=%H%n%s%n%an%n%ct%n---END---", "--numstat"]);
    let output = run_git(&repo_path, &args).await?;

    Ok(parse_log_output(&output))
}

#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GitBranch {
    /// Normal case: HEAD points at a named branch ref.
    Branch { name: String },
    /// HEAD points directly at a commit (e.g. `git checkout <sha>`).
    Detached { short_sha: String },
    /// Freshly initialized repo with no commits — HEAD exists as a ref but
    /// resolves to nothing.
    Initial,
}

fn is_connection_error(msg: &str) -> bool {
    msg == NOT_A_REPO || msg == GIT_NOT_FOUND || msg == GIT_TIMEOUT_STR
}

#[tauri::command]
pub async fn git_branch(repo_path: String) -> Result<GitBranch, String> {
    // A freshly-initialized repo has a symbolic HEAD ref but no commit, so
    // `symbolic-ref` alone would falsely report a branch. Ask for HEAD's sha
    // first: that succeeds iff there's at least one commit.
    match run_git(&repo_path, &["rev-parse", "--short", "HEAD"]).await {
        Ok(short_sha_out) => {
            let short_sha = short_sha_out.trim().to_string();
            match run_git(&repo_path, &["symbolic-ref", "--short", "HEAD"]).await {
                Ok(out) => Ok(GitBranch::Branch { name: out.trim().to_string() }),
                Err(e) if is_connection_error(&e) => Err(e),
                Err(_) => Ok(GitBranch::Detached { short_sha }),
            }
        }
        Err(e) if is_connection_error(&e) => Err(e),
        Err(_) => Ok(GitBranch::Initial),
    }
}

#[tauri::command]
pub async fn git_last_commit_time(repo_path: String) -> Result<i64, String> {
    let output = run_git(&repo_path, &["log", "-1", "--format=%ct"]).await?;
    output
        .trim()
        .parse::<i64>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_show_file(repo_path: String, file_path: String) -> Result<String, String> {
    let spec = format!("HEAD:{file_path}");
    run_git(&repo_path, &["show", &spec]).await
}

/// Parse the output of `git log --name-only --format='@%ct' -- <paths>`.
/// Output format (newest-first):
///
///     @1700001000
///     path/a
///     path/b
///
///     @1700000000
///     path/c
///
/// Since `git log` emits commits newest-first, the first timestamp we see
/// for any given path is the most recent commit that touched it.
fn parse_file_times_output(output: &str) -> HashMap<String, i64> {
    let mut map: HashMap<String, i64> = HashMap::new();
    let mut current_ts: Option<i64> = None;
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix('@') {
            current_ts = rest.parse::<i64>().ok();
            continue;
        }
        if let Some(ts) = current_ts {
            map.entry(line.to_string()).or_insert(ts);
        }
    }
    map
}

/// Returns, for each requested repo-relative path, the unix timestamp of the
/// most recent commit that touched it. Paths that have never been committed
/// (e.g. untracked files) return None. Order matches input order.
///
/// Implemented as a single `git log` pathspec-scoped invocation so that large
/// dirty trees don't spawn N subprocesses.
#[tauri::command]
pub async fn git_file_times(
    repo_path: String,
    paths: Vec<String>,
) -> Result<Vec<(String, Option<i64>)>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut args: Vec<&str> = vec!["log", "--name-only", "--format=@%ct", "--"];
    for p in &paths {
        args.push(p.as_str());
    }

    let times = match run_git(&repo_path, &args).await {
        Ok(output) => parse_file_times_output(&output),
        // Empty repo / no commits / pathspec miss all collapse to "no timestamps".
        // Preserve the requested paths with None rather than propagating the error,
        // so the caller can still render a file list without timestamps.
        Err(_) => HashMap::new(),
    };

    Ok(paths
        .into_iter()
        .map(|p| {
            let ts = times.get(&p).copied();
            (p, ts)
        })
        .collect())
}

#[tauri::command]
pub async fn git_init(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["init"]).await.map(|_| ())
}

/// List local branch names, one per line, in git's natural ordering. Used by
/// the branch dropdown in the top bar — remote-tracking branches are intentionally
/// excluded since switching to those requires a more involved flow (creating a
/// local tracking branch).
#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<String>, String> {
    let output = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )
    .await?;
    Ok(output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Switch the working tree to `branch`. Errors propagate verbatim (e.g. when
/// the working tree is dirty and the checkout would overwrite local changes),
/// so the UI can surface them to the user.
#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    run_git(&repo_path, &["checkout", &branch]).await.map(|_| ())
}

#[tauri::command]
pub async fn git_remote_url(repo_path: String) -> Result<Option<String>, String> {
    match run_git(&repo_path, &["remote", "get-url", "origin"]).await {
        Ok(url) => Ok(Some(url.trim().to_string())),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    /// Create an empty initialized git repo in a fresh tempdir.
    /// Returns the TempDir (keeps the dir alive) and the path as String.
    fn make_repo() -> (TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_str().unwrap().to_string();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@test"],
            vec!["config", "user.name", "Test"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            let status = StdCommand::new("git")
                .arg("-C")
                .arg(&path)
                .args(&args)
                .status()
                .expect("git");
            assert!(status.success(), "git {:?} failed", args);
        }
        (dir, path)
    }

    fn write_and_commit(repo: &str, rel_path: &str, content: &str, msg: &str) {
        let full = format!("{repo}/{rel_path}");
        if let Some(parent) = std::path::Path::new(&full).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&full, content).unwrap();
        StdCommand::new("git").arg("-C").arg(repo).args(["add", rel_path]).status().unwrap();
        StdCommand::new("git").arg("-C").arg(repo).args(["commit", "-q", "-m", msg]).status().unwrap();
    }

    #[tokio::test]
    async fn git_show_file_returns_committed_content() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "hello\n", "init");
        // Modify in working tree — git_show_file should still return HEAD content
        std::fs::write(format!("{repo}/a.txt"), "changed\n").unwrap();

        let head = git_show_file(repo.clone(), "a.txt".to_string()).await.unwrap();
        assert_eq!(head, "hello\n");
    }

    #[tokio::test]
    async fn git_show_file_errors_when_path_not_in_head() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "x\n", "init");
        // b.txt has never existed
        let result = git_show_file(repo, "b.txt".to_string()).await;
        assert!(result.is_err(), "expected Err for missing path, got {:?}", result);
    }

    #[tokio::test]
    async fn git_show_file_handles_binary_gracefully() {
        let (_dir, repo) = make_repo();
        let full = format!("{repo}/bin.dat");
        std::fs::write(&full, [0xFF, 0xFE, 0x00, 0x01, 0xFF]).unwrap();
        StdCommand::new("git").arg("-C").arg(&repo).args(["add", "bin.dat"]).status().unwrap();
        StdCommand::new("git").arg("-C").arg(&repo).args(["commit", "-q", "-m", "add binary"]).status().unwrap();

        let result = git_show_file(repo, "bin.dat".to_string()).await;
        // We just care that it doesn't panic and returns something — either Ok(lossy) or Err.
        // DiffNode handles both by rendering a placeholder.
        if let Ok(s) = result {
            assert!(!s.is_empty());
        }
    }

    #[tokio::test]
    async fn git_file_times_returns_committed_file_timestamp() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "hi\n", "init");

        let result = git_file_times(repo.clone(), vec!["a.txt".to_string()])
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        let (path, ts) = &result[0];
        assert_eq!(path, "a.txt");
        assert!(ts.is_some(), "expected Some timestamp for committed file");
        assert!(ts.unwrap() > 0);
    }

    #[tokio::test]
    async fn git_file_times_returns_none_for_untracked_path() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "hi\n", "init");
        std::fs::write(format!("{repo}/new.txt"), "x\n").unwrap();

        let result = git_file_times(repo, vec!["new.txt".to_string()])
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "new.txt");
        assert!(result[0].1.is_none());
    }

    #[tokio::test]
    async fn git_branch_reports_named_branch() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "x\n", "init");
        // make_repo leaves the default branch (main or master depending on git config).
        let branch = git_branch(repo).await.unwrap();
        match branch {
            GitBranch::Branch { name } => assert!(!name.is_empty()),
            other => panic!("expected Branch, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_branch_reports_initial_for_empty_repo() {
        let (_dir, repo) = make_repo();
        // No commits yet — symbolic-ref fails, rev-parse HEAD fails.
        let branch = git_branch(repo).await.unwrap();
        assert!(matches!(branch, GitBranch::Initial), "got {branch:?}");
    }

    #[tokio::test]
    async fn git_branch_reports_detached_after_checkout_of_sha() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "x\n", "first");
        write_and_commit(&repo, "b.txt", "y\n", "second");

        // Check out the first commit's SHA directly to get a detached HEAD.
        let first_sha = StdCommand::new("git")
            .arg("-C").arg(&repo)
            .args(["rev-parse", "HEAD~1"])
            .output().unwrap();
        let sha = String::from_utf8_lossy(&first_sha.stdout).trim().to_string();
        StdCommand::new("git")
            .arg("-C").arg(&repo)
            .args(["checkout", "--quiet", &sha])
            .status().unwrap();

        let branch = git_branch(repo).await.unwrap();
        match branch {
            GitBranch::Detached { short_sha } => {
                assert!(!short_sha.is_empty());
                assert!(sha.starts_with(&short_sha));
            }
            other => panic!("expected Detached, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn git_file_times_empty_input_returns_empty() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "a.txt", "hi\n", "init");

        let result = git_file_times(repo, vec![]).await.unwrap();
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn git_file_times_handles_paths_with_spaces() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "has space.txt", "x\n", "init");

        let result = git_file_times(repo, vec!["has space.txt".to_string()])
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "has space.txt");
        assert!(result[0].1.is_some());
    }

    #[tokio::test]
    async fn git_file_times_batches_many_paths_in_single_call() {
        // Create 30 files across 3 commits. The batched implementation should
        // still be fast; more importantly, all timestamps come back correctly.
        let (_dir, repo) = make_repo();
        for i in 0..10 {
            write_and_commit(&repo, &format!("a{i}.txt"), "x\n", "batch 1");
        }
        for i in 0..10 {
            write_and_commit(&repo, &format!("b{i}.txt"), "x\n", "batch 2");
        }
        for i in 0..10 {
            write_and_commit(&repo, &format!("c{i}.txt"), "x\n", "batch 3");
        }

        let paths: Vec<String> = (0..10)
            .flat_map(|i| [format!("a{i}.txt"), format!("b{i}.txt"), format!("c{i}.txt")])
            .collect();

        let result = git_file_times(repo, paths.clone()).await.unwrap();
        assert_eq!(result.len(), paths.len());
        for (p, ts) in &result {
            assert!(ts.is_some(), "expected timestamp for {p}");
        }
    }

    #[test]
    fn parse_file_times_output_empty() {
        let map = parse_file_times_output("");
        assert!(map.is_empty());
    }

    #[test]
    fn parse_file_times_output_single_commit() {
        let input = "@1700000000\nsrc/main.rs\nsrc/lib.rs\n";
        let map = parse_file_times_output(input);
        assert_eq!(map.get("src/main.rs"), Some(&1700000000));
        assert_eq!(map.get("src/lib.rs"), Some(&1700000000));
    }

    #[test]
    fn parse_file_times_output_keeps_newest_timestamp_per_path() {
        // git log outputs newest commit first. If a file appears in both commits,
        // we should keep the newest (first encountered) timestamp.
        let input = "@1700001000\nshared.rs\n\n@1700000000\nshared.rs\nold.rs\n";
        let map = parse_file_times_output(input);
        assert_eq!(map.get("shared.rs"), Some(&1700001000));
        assert_eq!(map.get("old.rs"), Some(&1700000000));
    }

    #[test]
    fn parse_file_times_output_ignores_blank_lines_and_unknown_prefixes() {
        let input = "\n@1700000000\n\nfoo.rs\nnot-a-timestamp\n";
        let map = parse_file_times_output(input);
        assert_eq!(map.get("foo.rs"), Some(&1700000000));
        // "not-a-timestamp" is treated as a file path under the same commit.
        assert_eq!(map.get("not-a-timestamp"), Some(&1700000000));
    }

    #[test]
    fn parse_file_times_output_skips_files_before_first_commit_marker() {
        // Malformed output: file lines before any @timestamp. Skip them.
        let input = "stray.rs\n@1700000000\nreal.rs\n";
        let map = parse_file_times_output(input);
        assert!(!map.contains_key("stray.rs"));
        assert_eq!(map.get("real.rs"), Some(&1700000000));
    }

    #[tokio::test]
    async fn git_file_times_preserves_order_for_multiple_paths() {
        let (_dir, repo) = make_repo();
        write_and_commit(&repo, "first.txt", "1\n", "add first");
        // Sleep a bit so the timestamps differ
        std::thread::sleep(std::time::Duration::from_secs(1));
        write_and_commit(&repo, "second.txt", "2\n", "add second");

        let result = git_file_times(
            repo,
            vec!["second.txt".to_string(), "first.txt".to_string()],
        )
        .await
        .unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].0, "second.txt");
        assert_eq!(result[1].0, "first.txt");
        // second.txt should have a larger timestamp than first.txt
        assert!(result[0].1.unwrap() > result[1].1.unwrap());
    }

    #[test]
    fn parse_numstat_empty() {
        let stats = parse_numstat("");
        assert!(stats.is_empty());
    }

    #[test]
    fn parse_numstat_single_file() {
        let input = "10\t5\tsrc/main.rs";
        let stats = parse_numstat(input);
        assert_eq!(stats.get("src/main.rs"), Some(&(10, 5)));
    }

    #[test]
    fn parse_numstat_multiple_files() {
        let input = "10\t5\tsrc/main.rs\n3\t1\tsrc/lib.rs";
        let stats = parse_numstat(input);
        assert_eq!(stats.len(), 2);
        assert_eq!(stats.get("src/main.rs"), Some(&(10, 5)));
        assert_eq!(stats.get("src/lib.rs"), Some(&(3, 1)));
    }

    #[test]
    fn parse_numstat_binary_file_dashes() {
        // Binary files show "-" for insertions/deletions
        let input = "-\t-\tbinary.png";
        let stats = parse_numstat(input);
        assert_eq!(stats.get("binary.png"), Some(&(0, 0)));
    }

    #[test]
    fn parse_numstat_duplicate_paths_accumulate() {
        let input = "5\t2\tsrc/main.rs\n3\t1\tsrc/main.rs";
        let stats = parse_numstat(input);
        assert_eq!(stats.get("src/main.rs"), Some(&(8, 3)));
    }

    #[test]
    fn parse_porcelain_empty() {
        let stats = HashMap::new();
        let (files, ins, del) = parse_porcelain("", &stats);
        assert!(files.is_empty());
        assert_eq!(ins, 0);
        assert_eq!(del, 0);
    }

    #[test]
    fn parse_porcelain_modified_file() {
        let mut stats = HashMap::new();
        stats.insert("src/main.rs".to_string(), (10, 5));
        let (files, ins, del) = parse_porcelain(" M src/main.rs", &stats);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].insertions, 10);
        assert_eq!(files[0].deletions, 5);
        assert_eq!(ins, 10);
        assert_eq!(del, 5);
    }

    #[test]
    fn parse_porcelain_added_file() {
        let stats = HashMap::new();
        let (files, _, _) = parse_porcelain("A  new_file.rs", &stats);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "A");
    }

    #[test]
    fn parse_porcelain_deleted_file() {
        let stats = HashMap::new();
        let (files, _, _) = parse_porcelain("D  removed.rs", &stats);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "D");
    }

    #[test]
    fn parse_porcelain_untracked_file() {
        let stats = HashMap::new();
        let (files, _, _) = parse_porcelain("?? untracked.txt", &stats);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "U");
        assert_eq!(files[0].insertions, 0);
        assert_eq!(files[0].deletions, 0);
    }

    #[test]
    fn parse_porcelain_renamed_file() {
        let stats = HashMap::new();
        let (files, _, _) = parse_porcelain("R  old.rs -> new.rs", &stats);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "R");
    }

    #[test]
    fn parse_porcelain_skips_short_lines() {
        let stats = HashMap::new();
        let (files, _, _) = parse_porcelain("ab", &stats);
        assert!(files.is_empty());
    }

    #[test]
    fn parse_porcelain_mixed_statuses() {
        let mut stats = HashMap::new();
        stats.insert("a.rs".to_string(), (2, 1));
        let input = " M a.rs\nA  b.rs\n?? c.txt";
        let (files, ins, del) = parse_porcelain(input, &stats);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].status, "M");
        assert_eq!(files[1].status, "A");
        assert_eq!(files[2].status, "U");
        assert_eq!(ins, 2);
        assert_eq!(del, 1);
    }

    #[test]
    fn parse_log_output_empty() {
        let entries = parse_log_output("");
        assert!(entries.is_empty());
    }

    #[test]
    fn parse_log_output_single_commit_no_files() {
        let output = "abc1234567890\nInitial commit\nJohn Doe\n1700000000\n---END---\n";
        let entries = parse_log_output(output);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, "abc1234");
        assert_eq!(entries[0].message, "Initial commit");
        assert_eq!(entries[0].author, "John Doe");
        assert_eq!(entries[0].timestamp, 1700000000);
        assert!(entries[0].files.is_empty());
    }

    #[test]
    fn parse_log_output_commit_with_files() {
        let output = "abc1234567890\nFix bug\nJane\n1700000000\n---END---\n\n10\t5\tsrc/main.rs\n3\t1\tsrc/lib.rs\n";
        let entries = parse_log_output(output);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].files.len(), 2);
        assert_eq!(entries[0].insertions, 13);
        assert_eq!(entries[0].deletions, 6);
        assert_eq!(entries[0].files[0].path, "src/main.rs");
        assert_eq!(entries[0].files[1].path, "src/lib.rs");
    }

    #[test]
    fn parse_log_output_multiple_commits() {
        let output = "\
abc1234567890\nFirst\nAlice\n1700000000\n---END---\n\n2\t1\ta.rs\n\n\
def7890123456\nSecond\nBob\n1700001000\n---END---\n\n1\t0\tb.rs\n";
        let entries = parse_log_output(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].hash, "abc1234");
        assert_eq!(entries[0].message, "First");
        assert_eq!(entries[1].hash, "def7890");
        assert_eq!(entries[1].message, "Second");
    }

    #[test]
    fn parse_log_hash_truncated_to_7() {
        let output = "abcdefghijklmnop\nMsg\nAuthor\n0\n---END---\n";
        let entries = parse_log_output(output);
        assert_eq!(entries[0].hash, "abcdefg");
    }

    #[test]
    fn parse_log_short_hash() {
        let output = "abc\nMsg\nAuthor\n0\n---END---\n";
        let entries = parse_log_output(output);
        assert_eq!(entries[0].hash, "abc");
    }
}
