use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

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

    let (files, total_insertions, total_deletions) = parse_porcelain(&porcelain, &stats);

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

        lines.next(); // Skip "---END---"

        // Skip blank line between format output and numstat
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

#[derive(Serialize)]
pub struct GitBranch {
    pub current: String,
}

#[tauri::command]
pub async fn git_branch(repo_path: String) -> Result<GitBranch, String> {
    let output = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    Ok(GitBranch {
        current: output.trim().to_string(),
    })
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

#[tauri::command]
pub async fn git_init(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["init"]).await.map(|_| ())
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
        match result {
            Ok(s) => assert!(!s.is_empty()),
            Err(_) => {} // also acceptable
        }
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
