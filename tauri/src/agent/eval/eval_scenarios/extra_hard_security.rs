//! Extra-hard security scenarios.

#[allow(unused_imports)]
pub(crate) use super::*;

#[path = "extra_hard/security_01.rs"]
mod _01;

#[path = "extra_hard/security_02.rs"]
mod _02;

pub(super) fn scenarios(v: &mut Vec<ScenarioSpec>) {
    _01::scenario(v);
    _02::scenario(v);
}
