//! Extra-hard testing scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/testing_02.rs"]
mod _02;

#[path = "extra_hard/testing_04.rs"]
mod _04;

#[path = "extra_hard/testing_05.rs"]
mod _05;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _02::scenario(v);
    _04::scenario(v);
    _05::scenario(v);
}
