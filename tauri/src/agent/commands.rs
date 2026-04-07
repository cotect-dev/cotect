use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, oneshot, RwLock};

use super::llm_client::LlmClient;
use super::orch::Orchestrator;
use super::types::*;

/// Managed state for the agent system.
pub struct AgentState {
    pub config: RwLock<AgentConfig>,
    active_tasks: RwLock<HashMap<String, TaskHandle>>,
}

struct TaskHandle {
    _abort_sender: oneshot::Sender<()>,
}

impl AgentState {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(AgentConfig::default()),
            active_tasks: RwLock::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn agent_start_task(
    app: AppHandle,
    state: State<'_, Arc<AgentState>>,
    request: TaskRequest,
) -> Result<(), String> {
    let config = state.config.read().await;
    let provider = config
        .active_provider()
        .cloned()
        .ok_or("No active provider configured. Open Settings to add one.")?;

    if provider.model.is_empty() {
        return Err("No model selected. Open Settings to select a model.".into());
    }

    drop(config); // Release the lock

    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<TaskEvent>();
    let (abort_tx, abort_rx) = oneshot::channel::<()>();

    let task_id = request.id.clone();

    // Spawn the orchestrator — move owned values directly (no redundant clones)
    let event_tx_orch = event_tx.clone();
    tokio::spawn(async move {
        let mut orch = Orchestrator::new(&provider, &request, event_tx_orch.clone());
        tokio::select! {
            result = orch.run() => {
                if let Err(e) = result {
                    let _ = event_tx_orch
                        .send(TaskEvent::Error { message: e.to_string() });
                }
            }
            _ = abort_rx => {
                let _ = event_tx_orch
                    .send(TaskEvent::Interrupted { reason: "Aborted by user.".into() });
            }
        }
    });

    // Spawn event forwarder: mpsc -> Tauri events
    let app_clone = app.clone();
    let event_name = format!("agent-task-event:{}", task_id);
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = app_clone.emit(&event_name, &event);
        }
    });

    state.active_tasks.write().await.insert(
        task_id,
        TaskHandle {
            _abort_sender: abort_tx,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn agent_abort(
    state: State<'_, Arc<AgentState>>,
    task_id: String,
) -> Result<(), String> {
    // Remove the task handle — dropping the abort_sender closes the channel,
    // which triggers the abort branch in the select!
    state.active_tasks.write().await.remove(&task_id);
    Ok(())
}

#[tauri::command]
pub async fn agent_get_config(
    state: State<'_, Arc<AgentState>>,
) -> Result<AgentConfig, String> {
    Ok(state.config.read().await.clone())
}

#[tauri::command]
pub async fn agent_set_config(
    state: State<'_, Arc<AgentState>>,
    config: AgentConfig,
) -> Result<(), String> {
    *state.config.write().await = config;
    Ok(())
}

#[tauri::command]
pub async fn agent_test_connection(config: ProviderConfig) -> Result<Vec<String>, String> {
    let client = LlmClient::new(&config);
    client.list_models().await.map_err(|e| e.to_string())
}
