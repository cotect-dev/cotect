//! Extra-hard bugfix scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/bugfix_04.rs"]
mod _04;

#[path = "extra_hard/bugfix_05.rs"]
mod _05;

#[path = "extra_hard/time_01.rs"]
mod _time_01;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _04::scenario(v);
    _05::scenario(v);
    _time_01::scenario(v);
}
