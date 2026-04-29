//! Extra-hard bugfix scenarios.

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/bugfix_01.rs"]
mod _01;

#[path = "extra_hard/bugfix_02.rs"]
mod _02;

#[path = "extra_hard/bugfix_03.rs"]
mod _03;

#[path = "extra_hard/bugfix_04.rs"]
mod _04;

#[path = "extra_hard/bugfix_05.rs"]
mod _05;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
    _02::scenario(v);
    _03::scenario(v);
    _04::scenario(v);
    _05::scenario(v);
}
