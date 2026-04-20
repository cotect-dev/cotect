//! Bugfix — Test 06: DST boundary double-fire (Python, timezone)
//!
//! `scheduler.py` implements a `DailyScheduler` that fires a callback every
//! day at a configured local wall-clock time. The implementation stores the
//! target time as a naive `datetime.time`, compares against
//! `datetime.now()` (naive local), and records a `last_fired` naive date.
//!
//! Bug: on the DST fall-back (America/New_York, 2025-11-02: 02:00 EDT rolls
//! back to 01:00 EST), the interval 01:00–01:59 happens TWICE. A callback
//! scheduled for 01:30 fires once at 01:30 EDT, and then again at 01:30 EST
//! ~1 hour later. The naive last_fired date doesn't catch the duplicate
//! because it's the same calendar date.
//!
//! Fix: store everything as tz-aware UTC; compute the next fire time in UTC
//! from the user's target local time; track last_fired as a UTC datetime.
//! The zoneinfo module (stdlib) is enough — no third-party deps.
//!
//! The test drives a synthetic clock through the DST boundary and asserts
//! that the callback fires EXACTLY ONCE.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let src = ap(dir, "scheduler.py");
        std::fs::write(&src, r#""""Daily scheduler — fires a callback at a given local wall-clock time.

BUG: uses naive local datetimes, so a job scheduled in a zone with DST
fires twice during the fall-back hour. See `test_scheduler.py` for the
failing case.
"""

from datetime import datetime, time, date
from typing import Callable, Optional


class DailyScheduler:
    """Fires `callback` every day at `target` local wall-clock time.

    Callers drive the scheduler by calling `tick(now)` at some cadence (e.g.
    once per minute). `tick` invokes `callback` iff `now` has reached or
    passed today's target and we haven't fired today yet.
    """

    def __init__(
        self,
        target: time,
        callback: Callable[[datetime], None],
        tz_name: str = "America/New_York",
    ):
        self.target = target
        self.callback = callback
        self.tz_name = tz_name
        self._last_fired: Optional[date] = None

    def tick(self, now: datetime) -> None:
        """Advance the scheduler's notion of 'now'.

        `now` is expected to be a naive local datetime in the configured tz.
        """
        today = now.date()
        if self._last_fired == today:
            return
        if now.time() >= self.target:
            self.callback(now)
            self._last_fired = today
"#).unwrap();

        let test = ap(dir, "test_scheduler.py");
        std::fs::write(&test, r#""""DST fall-back test.

At 2025-11-02 in America/New_York the local clock goes:
    01:00 EDT (UTC-4)
    01:30 EDT
    02:00 EDT  →  rolls back to 01:00 EST (UTC-5)
    01:30 EST
    02:00 EST

A callback scheduled at 01:30 local must fire EXACTLY ONCE over that span.
The buggy implementation (naive localtime compare + naive date-based dedup)
fires twice.
"""

from datetime import datetime, time, timezone, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:  # Python <3.9 fallback
    ZoneInfo = None  # type: ignore

from scheduler import DailyScheduler


def _utc_ticks() -> list[datetime]:
    """Generate one UTC datetime per 5-minute step from 04:00 to 07:00 UTC
    on 2025-11-02. That span covers both 01:30 EDT (05:30 UTC) and 01:30
    EST (06:30 UTC)."""
    start = datetime(2025, 11, 2, 4, 0, tzinfo=timezone.utc)
    end   = datetime(2025, 11, 2, 7, 0, tzinfo=timezone.utc)
    step  = timedelta(minutes=5)
    out = []
    t = start
    while t <= end:
        out.append(t)
        t += step
    return out


def _now_hint(tz_aware_utc: datetime, tz_name: str):
    """Return whatever the DailyScheduler.tick method wants.

    The fixed implementation accepts tz-aware UTC directly and converts
    internally. The buggy implementation insists on naive localtime — we
    pass a naive-local version so both paths can be exercised; the fix
    should accept either or normalize at the boundary.
    """
    assert ZoneInfo is not None, "zoneinfo unavailable — requires Python 3.9+"
    return tz_aware_utc


def test_dst_fallback_fires_once():
    fires = []

    def cb(now):
        fires.append(now)

    sched = DailyScheduler(target=time(1, 30), callback=cb, tz_name="America/New_York")
    for t in _utc_ticks():
        sched.tick(t)

    assert len(fires) == 1, (
        f"scheduler fired {len(fires)} times across the DST boundary; "
        "expected exactly 1 (got timestamps: "
        + ", ".join(str(f) for f in fires) + ")"
    )


def test_normal_day_still_fires_once():
    fires = []

    def cb(now):
        fires.append(now)

    sched = DailyScheduler(target=time(9, 0), callback=cb, tz_name="America/New_York")
    start = datetime(2025, 6, 15, 12, 0, tzinfo=timezone.utc)  # 08:00 EDT
    for i in range(48):  # two hours, 5 min steps
        sched.tick(start + timedelta(minutes=5 * i))

    assert len(fires) == 1, f"expected 1 fire on normal day, got {len(fires)}"


if __name__ == "__main__":
    test_dst_fallback_fires_once()
    test_normal_day_still_fires_once()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_blocked(with_scope(with_checks(pf(
            "`scheduler.py::DailyScheduler` fires a callback once per day at \
             a configured local wall-clock time. It's currently broken at \
             DST transitions: a job scheduled for 01:30 in America/New_York \
             fires TWICE on 2025-11-02 (once at 01:30 EDT, once at 01:30 \
             EST). See `test_scheduler.py` for the failing case.\n\n\
             Fix `DailyScheduler` so `python3 test_scheduler.py` prints \
             ALL_TESTS_PASSED. The test drives the scheduler with tz-aware \
             UTC datetimes through the DST boundary and expects exactly one \
             callback invocation. The normal-day test must also still pass.\n\n\
             Use the stdlib `zoneinfo` module (Python 3.9+). No third-party \
             libraries."
            .to_string()
        ),
            vec![
                complete(),
                succeeded("shell"),
                run_has("python3 test_scheduler.py", &["ALL_TESTS_PASSED"]),
            ]),
            vec![src]),
            vec![test])
    }
    v.push(scen!("xhard_time_01_dst_boundary", Category::Bugfix, Difficulty::Hard, I, setup));
}
