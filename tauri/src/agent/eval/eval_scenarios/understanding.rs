//! Code understanding scenarios — analyse, explain, identify patterns & issues.

use std::path::Path;

use crate::agent::types::AgentRole::Research as R;
use super::*;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {

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
            "Read {p}. What class of vulnerability does this template have, and how would an attacker exploit it through the user object? Be specific about the mechanism.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["XSS", "cross-site scripting", "script injection", "HTML injection"]),
                 oc_any(&["<script", "javascript:", "onerror", "onload", "escap", "sanitiz", "innerHTML"])]),
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
            "Read {p}. Review the lifecycle methods on this class. What goes wrong if a consumer repeatedly mounts and unmounts the Dashboard, and why?")),
            vec![complete(), succeeded("read"),
                 oc_any(&["memory leak", "leak", "accumulat", "grow unbounded", "retain"]),
                 oc_any(&["event listener", "listeners are", "handler", "subscription", "eventBus.off", "removeListener", "unsubscribe", "not removed", "never removed", "still registered"])]),
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
            "Read {p}. Two threads call `transfer(A, B, 50)` and `transfer(B, A, 30)` at the same moment. Walk through a concrete interleaving that causes a failure, then name the failure mode.")),
            vec![complete(), succeeded("read"),
                 oc_any(&["deadlock", "dead lock", "dead-lock"]),
                 oc_any(&["circular wait", "lock ordering", "acquire", "holds", "waiting for", "each other", "cycle"])]),
            vec![p])
    }
    v.push(scen!("understand_deadlock", Category::Understanding, Difficulty::Hard, R, s_deadlock));
}
