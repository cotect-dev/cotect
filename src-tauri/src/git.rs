use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;

const GIT_NOT_FOUND: &str = "GIT_NOT_FOUND";
const NOT_A_REPO: &str = "NOT_A_REPO";

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", repo_path, "--no-optional-locks"])
        .args(args)
        .output()
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

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let porcelain = run_git(&repo_path, &["status", "--porcelain"])?;
    let numstat = run_git(&repo_path, &["diff", "--numstat"]).unwrap_or_default();
    let cached_numstat = run_git(&repo_path, &["diff", "--cached", "--numstat"]).unwrap_or_default();

    let mut stats: HashMap<String, (u32, u32)> = HashMap::new();
    for line in numstat.lines().chain(cached_numstat.lines()) {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() == 3 {
            let ins = parts[0].parse::<u32>().unwrap_or(0);
            let del = parts[1].parse::<u32>().unwrap_or(0);
            let entry = stats.entry(parts[2].to_string()).or_insert((0, 0));
            entry.0 += ins;
            entry.1 += del;
        }
    }

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

#[tauri::command]
pub fn git_log(repo_path: String, limit: Option<u32>, skip: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let mut args = vec!["log", &limit_str];
    let skip_str;
    if let Some(s) = skip {
        skip_str = format!("--skip={s}");
        args.push(&skip_str);
    }
    args.extend_from_slice(&["--format=%H%n%s%n%an%n%ct%n---END---", "--numstat"]);
    let output = run_git(&repo_path, &args)?;

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

    Ok(entries)
}

#[derive(Serialize)]
pub struct GitBranch {
    pub current: String,
}

#[tauri::command]
pub fn git_branch(repo_path: String) -> Result<GitBranch, String> {
    let output = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(GitBranch {
        current: output.trim().to_string(),
    })
}

#[tauri::command]
pub fn git_last_commit_time(repo_path: String) -> Result<i64, String> {
    let output = run_git(&repo_path, &["log", "-1", "--format=%ct"])?;
    output
        .trim()
        .parse::<i64>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_init(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["init"]).map(|_| ())
}
