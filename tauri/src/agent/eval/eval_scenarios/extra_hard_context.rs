//! Extra-hard long-context scenarios.

#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/context_01.rs"]
mod _01;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
}
