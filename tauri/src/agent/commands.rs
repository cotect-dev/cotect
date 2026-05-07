use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, RwLock};

use super::orch::Orchestrator;
use super::probe::{self, ProbeInput, Probed};
use super::types::*;
use crate::db::{providers as db_providers, Db};

pub struct AgentState {
    active_tasks: RwLock<HashMap<String, TaskHandle>>,
}

struct TaskHandle {
    _abort_sender: oneshot::Sender<()>,
}

impl AgentState {
    pub fn new() -> Self {
        Self { active_tasks: RwLock::new(HashMap::new()) }
    }
}

fn build_provider_config(
    db_provider: &db_providers::Provider,
    model: &str,
) -> ProviderConfig {
    ProviderConfig {
        id: db_provider.id.clone(),
        name: db_provider.label.clone(),
        endpoint: db_provider.endpoint.clone(),
        api_key: db_provider.api_key.clone(),
        model: model.into(),
        format: db_provider.detected_json.as_ref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.get("format_per_model").cloned())
            .and_then(|fpm| fpm.get(model).and_then(|s| s.as_str().map(String::from)))
            .and_then(|s| super::adapter::PromptFormat::parse(&s)),
        disable_thinking: None,    // sourced from kv `agent.disable_thinking` in orchestrator
    }
}

fn lookup_provider_for_role(
    a: &db_providers::ActiveAssignment,
    providers: &[db_providers::Provider],
    role: AgentRole,
) -> Option<(db_providers::Provider, String)> {
    let (pid, model) = match role {
        AgentRole::Implement => (a.implement_provider_id.as_deref(), a.implement_model.as_deref()),
        AgentRole::Research  => (a.research_provider_id.as_deref(),  a.research_model.as_deref()),
        AgentRole::Plan      => (a.plan_provider_id.as_deref(),      a.plan_model.as_deref()),
    };
    let pid = pid.or(a.default_provider_id.as_deref())?;
    let model = model.or(a.default_model.as_deref())?;
    let provider = providers.iter().find(|p| p.id == pid)?.clone();
    Some((provider, model.into()))
}

#[tauri::command]
pub async fn agent_start_task(
    app: AppHandle,
    state: State<'_, Arc<AgentState>>,
    db: State<'_, Arc<Db>>,
    request: TaskRequest,
) -> Result<(), String> {
    let c = db.conn().map_err(|e| e.to_string())?;
    let assignment = db_providers::get_assignment(&c).map_err(|e| e.to_string())?;
    let providers = db_providers::list(&c).map_err(|e| e.to_string())?;
    drop(c);

    let (provider_row, model) = lookup_provider_for_role(&assignment, &providers, request.role)
        .ok_or("No provider configured for this role. Open Settings to add one.")?;
    let provider = build_provider_config(&provider_row, &model);

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<TaskEvent>();
    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    let task_id = request.id.clone();

    let event_tx_orch = event_tx.clone();
    let db_for_orch: Arc<Db> = (*db).clone();
    let app_for_orch = app.clone();
    tokio::spawn(async move {
        let mut orch = Orchestrator::new(
            &provider,
            &request,
            event_tx_orch.clone(),
            Some(db_for_orch),
            Some(app_for_orch),
        );
        tokio::select! {
            result = orch.run() => {
                if let Err(e) = result {
                    let _ = event_tx_orch.send(TaskEvent::Error { message: e.to_string() });
                }
            }
            _ = abort_rx => {
                let _ = event_tx_orch.send(TaskEvent::Interrupted { reason: "Aborted by user.".into() });
            }
        }
    });

    let app_clone = app.clone();
    let event_name = format!("agent-task-event:{}", task_id);
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = app_clone.emit(&event_name, &event);
        }
    });

    state.active_tasks.write().await.insert(task_id, TaskHandle { _abort_sender: abort_tx });
    Ok(())
}

#[tauri::command]
pub async fn agent_abort(
    state: State<'_, Arc<AgentState>>,
    task_id: String,
) -> Result<(), String> {
    state.active_tasks.write().await.remove(&task_id);
    Ok(())
}

#[tauri::command]
pub async fn probe_provider(input: ProbeInput) -> Result<Probed, String> {
    probe::probe(&input).await.map_err(|e| {
        let endpoint = input.endpoint.clone();
        format!("{}\n\n{}", e, probe::diagnostic(&e, &endpoint))
    })
}
