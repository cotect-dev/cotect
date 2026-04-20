//! Extra-hard performance scenarios.

#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/perf_01.rs"]
mod _01;

#[path = "extra_hard/perf_02.rs"]
mod _02;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
    _02::scenario(v);
}
