use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum HealthState {
    Healthy,
    Degraded,
    Unhealthy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCache {
    pub state: HealthState,
    pub consecutive_failures: u32,
    pub last_ok_at_ms: Option<i64>,
    pub p50_first_token_ms: Option<i64>,
    pub last_error: Option<String>,
}

impl Default for HealthCache {
    fn default() -> Self {
        Self {
            state: HealthState::Healthy,
            consecutive_failures: 0,
            last_ok_at_ms: None,
            p50_first_token_ms: None,
            last_error: None,
        }
    }
}

impl HealthCache {
    pub fn record_success(&mut self, now_ms: i64, first_token_ms: Option<i64>) {
        self.consecutive_failures = 0;
        self.state = HealthState::Healthy;
        self.last_ok_at_ms = Some(now_ms);
        self.last_error = None;
        if let Some(ft) = first_token_ms {
            self.p50_first_token_ms = Some(match self.p50_first_token_ms {
                Some(prev) => (prev * 7 + ft) / 8,    // EMA, alpha = 1/8
                None => ft,
            });
        }
    }

    pub fn record_failure(&mut self, error: String) {
        self.consecutive_failures += 1;
        self.last_error = Some(error);
        self.state = if self.consecutive_failures >= 3 {
            HealthState::Unhealthy
        } else {
            HealthState::Degraded
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_success_updates_state_and_ema() {
        let mut h = HealthCache::default();
        h.record_success(1000, Some(220));
        assert_eq!(h.state, HealthState::Healthy);
        assert_eq!(h.last_ok_at_ms, Some(1000));
        assert_eq!(h.p50_first_token_ms, Some(220));
    }

    #[test]
    fn ema_smooths_subsequent_first_token() {
        let mut h = HealthCache::default();
        h.record_success(1000, Some(200));
        h.record_success(2000, Some(280));
        // (200*7 + 280)/8 = (1400+280)/8 = 210
        assert_eq!(h.p50_first_token_ms, Some(210));
    }

    #[test]
    fn one_failure_marks_degraded() {
        let mut h = HealthCache::default();
        h.record_failure("nope".into());
        assert_eq!(h.state, HealthState::Degraded);
        assert_eq!(h.consecutive_failures, 1);
    }

    #[test]
    fn three_failures_marks_unhealthy() {
        let mut h = HealthCache::default();
        h.record_failure("a".into());
        h.record_failure("b".into());
        h.record_failure("c".into());
        assert_eq!(h.state, HealthState::Unhealthy);
    }

    #[test]
    fn success_resets_consecutive_failures() {
        let mut h = HealthCache::default();
        h.record_failure("a".into());
        h.record_failure("b".into());
        h.record_success(1000, Some(100));
        assert_eq!(h.consecutive_failures, 0);
        assert_eq!(h.state, HealthState::Healthy);
    }
}
