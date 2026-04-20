//! Extra-hard understanding scenarios.

#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/understanding_01.rs"]
mod _01;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
}
