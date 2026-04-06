//! Code understanding scenarios — analyse, explain, identify patterns & issues.

use std::path::Path;

use crate::agent::types::AgentRole::Research as R;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    // ── Easy ────────────────────────────────────────────────────────────

    fn s_identify_pattern(dir: &Path) -> SetupResult {
        let p = ap(dir, "singleton.py");
        std::fs::write(&p, r#"class _DBPool:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, dsn="sqlite:///db.sqlite"):
        if not hasattr(self, "_initialized"):
            self.dsn = dsn
            self.connections = []
            self._initialized = True

def get_pool():
    return _DBPool()
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p} and identify the design pattern used. Reply with the pattern name.")),
            vec![complete(), succeeded("read"), oc("singleton")]),
            vec![p])
    }
    v.push(scen!("understand_design_pattern", Category::Understanding, Difficulty::Easy, R, s_identify_pattern));

    fn s_what_does_it_compute(dir: &Path) -> SetupResult {
        let p = ap(dir, "mystery.py");
        std::fs::write(&p, r#"def mystery(text: str) -> dict:
    result = {}
    for ch in text.lower():
        if ch.isalpha():
            result[ch] = result.get(ch, 0) + 1
    return dict(sorted(result.items(), key=lambda x: -x[1]))
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Describe in one short phrase what `mystery('Hello World')` returns.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["frequency", "character count", "letter count", "letter frequency",
                          "char frequency", "occurrenc", "histogram", "count of", "counts of",
                          "how many times", "tally", "frequenc"])]),
            vec![p])
    }
    v.push(scen!("understand_char_frequency", Category::Understanding, Difficulty::Easy, R, s_what_does_it_compute));

    fn s_identify_algorithm(dir: &Path) -> SetupResult {
        let p = ap(dir, "sort.rs");
        std::fs::write(&p, r#"pub fn sort(arr: &mut [i32]) {
    let len = arr.len();
    for i in 0..len {
        for j in 0..len - 1 - i {
            if arr[j] > arr[j + 1] {
                arr.swap(j, j + 1);
            }
        }
    }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What sorting algorithm is this? Reply with the algorithm name.")),
            vec![complete(), succeeded("read"), oc_any(&["bubble sort", "bubble"])]),
            vec![p])
    }
    v.push(scen!("understand_sorting_algo", Category::Understanding, Difficulty::Easy, R, s_identify_algorithm));

    // ── Medium ──────────────────────────────────────────────────────────

    fn s_find_bug(dir: &Path) -> SetupResult {
        let p = ap(dir, "search.py");
        std::fs::write(&p, r#"def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. There is a subtle bug in this binary search implementation. \
             Describe the bug. (Hint: think about what happens when `lo == hi`.)")),
            vec![complete(), succeeded("read"),
                 oc_any(&["lo <= hi", "lo < hi", "equal", "off by one", "miss", "lo == hi", "while condition"])]),
            vec![p])
    }
    v.push(scen!("understand_binary_search_bug", Category::Understanding, Difficulty::Medium, R, s_find_bug));

    fn s_complexity(dir: &Path) -> SetupResult {
        let p = ap(dir, "merge.py");
        std::fs::write(&p, r#"def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. What is the time complexity and space complexity of this merge sort implementation? \
             State both in big-O notation.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["O(n log n)", "O(n·log n)", "O(nlogn)", "O(n*log(n))", "O(n * log n)",
                          "O(n log(n))", "n log n", "O(n*logn)", "n*log(n)", "O(N log N)",
                          "\\log n)", "n \\log", "nlogn"]),
                 oc_any(&["O(n)", "space"])]),
            vec![p])
    }
    v.push(scen!("understand_merge_sort_complexity", Category::Understanding, Difficulty::Medium, R, s_complexity));

    fn s_explain_decorator(dir: &Path) -> SetupResult {
        let p = ap(dir, "cached.py");
        std::fs::write(&p, r#"import functools
import time

def timed_cache(max_age_seconds=60):
    def decorator(func):
        cache = {}
        @functools.wraps(func)
        def wrapper(*args):
            now = time.time()
            if args in cache:
                result, timestamp = cache[args]
                if now - timestamp < max_age_seconds:
                    return result
            result = func(*args)
            cache[args] = (result, now)
            return result
        wrapper.cache_clear = lambda: cache.clear()
        return wrapper
    return decorator
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Explain what the `timed_cache` decorator does, how the expiry mechanism works, \
             and what `cache_clear` is for. Mention at least 3 distinct aspects.")),
            vec![complete(), succeeded("read"),
                 oc_all(&["cache", "clear"]),
                 oc_any(&["TTL", "age", "seconds", "time", "stale", "max_age", "expir", "timeout", "invalidat", "fresh"])]),
            vec![p])
    }
    v.push(scen!("understand_timed_cache", Category::Understanding, Difficulty::Medium, R, s_explain_decorator));

    fn s_trace_execution(dir: &Path) -> SetupResult {
        let p = ap(dir, "pipeline.py");
        std::fs::write(&p, r#"def pipeline(*funcs):
    def apply(value):
        for f in funcs:
            value = f(value)
        return value
    return apply

double = lambda x: x * 2
add_ten = lambda x: x + 10
negate = lambda x: -x

transform = pipeline(double, add_ten, negate)
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. If `transform(5)` is called, what is the result? Trace the execution step by step. \
             State your final answer as the last number in your reply.")),
            vec![complete(), succeeded("read"), num(-20)]),
            vec![p])
    }
    v.push(scen!("understand_pipeline_trace", Category::Understanding, Difficulty::Medium, R, s_trace_execution));

    // ── Hard ────────────────────────────────────────────────────────────

    fn s_xss_vulnerability(dir: &Path) -> SetupResult {
        let p = ap(dir, "template.js");
        std::fs::write(&p, r#"function renderProfile(user) {
  return `
    <div class="profile">
      <h1>${user.name}</h1>
      <p>Bio: ${user.bio}</p>
      <a href="${user.website}">Website</a>
      <img src="${user.avatar}" alt="avatar" />
    </div>
  `;
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Identify the security vulnerability and describe how an attacker could exploit it. \
             What specific fields are dangerous and what kind of attack is this?")),
            vec![complete(), succeeded("read"),
                 oc_any(&["XSS", "cross-site scripting", "script injection", "injection"]),
                 oc_any(&["name", "bio", "website", "escap"])]),
            vec![p])
    }
    v.push(scen!("understand_xss_vulnerability", Category::Understanding, Difficulty::Hard, R, s_xss_vulnerability));

    fn s_memory_leak(dir: &Path) -> SetupResult {
        let p = ap(dir, "listeners.ts");
        std::fs::write(&p, r#"class Dashboard {
  private data: any[] = [];

  constructor(private eventBus: EventBus) {}

  mount() {
    this.eventBus.on('data-update', (payload: any) => {
      this.data.push(payload);
      this.render();
    });
    this.eventBus.on('error', (err: any) => {
      console.error('Dashboard error:', err);
    });
  }

  unmount() {
    this.data = [];
    // Nothing else — listeners are still registered
  }

  private render() {
    // Re-renders the dashboard UI
  }
}
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. Identify the resource management issue. Why is `unmount()` insufficient? \
             What will happen if mount/unmount cycles repeat? Explain the problem clearly.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["memory leak", "listener", "event listener", "not removed", "off", "removeListener", "unsubscribe"])]),
            vec![p])
    }
    v.push(scen!("understand_memory_leak", Category::Understanding, Difficulty::Hard, R, s_memory_leak));

    fn s_deadlock(dir: &Path) -> SetupResult {
        let p = ap(dir, "transfer.py");
        std::fs::write(&p, r#"import threading

class Account:
    def __init__(self, name: str, balance: float):
        self.name = name
        self.balance = balance
        self.lock = threading.Lock()

def transfer(from_acc: Account, to_acc: Account, amount: float):
    with from_acc.lock:
        if from_acc.balance < amount:
            raise ValueError("Insufficient funds")
        with to_acc.lock:
            from_acc.balance -= amount
            to_acc.balance += amount
"#).unwrap();
        with_scope(with_checks(pf(format!(
            "Read {p}. If two threads simultaneously call `transfer(A, B, 50)` and `transfer(B, A, 30)`, \
             what concurrency issue can occur? Name the issue and explain why it happens.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["deadlock", "dead lock", "circular wait", "lock ordering"])]),
            vec![p])
    }
    v.push(scen!("understand_deadlock", Category::Understanding, Difficulty::Hard, R, s_deadlock));
}
