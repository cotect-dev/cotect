//! Extra-hard implement scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/implement_03.rs"]
mod _03;

#[path = "extra_hard/implement_05.rs"]
mod _05;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _03::scenario(v);
    _05::scenario(v);
}
