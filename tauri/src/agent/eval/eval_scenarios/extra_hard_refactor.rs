//! Extra-hard refactor scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/refactor_02.rs"]
mod _02;

#[path = "extra_hard/refactor_03.rs"]
mod _03;

#[path = "extra_hard/refactor_04.rs"]
mod _04;

#[path = "extra_hard/refactor_05.rs"]
mod _05;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _02::scenario(v);
    _03::scenario(v);
    _04::scenario(v);
    _05::scenario(v);
}
