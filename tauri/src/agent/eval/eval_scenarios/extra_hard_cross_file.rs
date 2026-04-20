//! Extra-hard cross-file scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/cross_file_01.rs"]
mod _01;

#[path = "extra_hard/cross_file_03.rs"]
mod _03;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
    _03::scenario(v);
}
