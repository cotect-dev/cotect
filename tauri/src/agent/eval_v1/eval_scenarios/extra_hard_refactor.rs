//! Extra-hard refactor scenarios — pulled in from eval_v2/refactor/*.rs via #[path].

// Re-export everything the child scenario files need.
// They use `use super::*;` and we're their `super`.
#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "../../eval_v2/refactor/01.rs"]
mod _01;

#[path = "../../eval_v2/refactor/02.rs"]
mod _02;

#[path = "../../eval_v2/refactor/03.rs"]
mod _03;

#[path = "../../eval_v2/refactor/04.rs"]
mod _04;

#[path = "../../eval_v2/refactor/05.rs"]
mod _05;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
    _02::scenario(v);
    _03::scenario(v);
    _04::scenario(v);
    _05::scenario(v);
}
