//! 창의 현재 정의와 기기 권한을 실행 입력으로 해석한다.
use super::{McpHttp, WorkerConfig};
use crate::{app_commands, data_runtime, error, files, Inner};
use kaleidoscope_contract::{
    data::{self, BindingValue},
    local_agent::{
        agent_spec_hash, validate_agent_specs, AgentChoice, AgentFailure, ExecutionConsent,
        LocalAgentPhase, LocalAgentSnapshot,
    },
    Block, CoreError, ErrorCode,
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Fingerprint {
    pub spec_hash: String,
    pub cwd: PathBuf,
    pub block_scope: (String, String, String),
    pub mcp: Option<(String, bool, String)>,
}

pub(super) struct Context {
    pub snapshot: LocalAgentSnapshot,
    pub config: Option<WorkerConfig>,
    pub fingerprint: Option<Fingerprint>,
    pub app_id: String,
    pub permission: String,
    pub workspace: String,
    pub cwd: Option<PathBuf>,
    // 블록 위치, 실행 권한, 폴더 권한은 명세를 못 읽어도 비교할 수 있다.
    pub block_scope: (String, String, String),
}

pub(super) fn record_dir(inner: &Inner, window: &str) -> PathBuf {
    inner
        .data_dir
        .join("local-agent")
        .join(format!("{:x}", Sha256::digest(window.as_bytes())))
}

pub(super) fn resolve(
    inner: &Inner,
    id: &str,
    generation: &str,
) -> Result<Option<Context>, CoreError> {
    let state = inner.state.lock().unwrap();
    let window = state
        .shared
        .windows
        .iter()
        .find(|w| w.id == id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let desktop = state
        .shared
        .desktops
        .iter()
        .find(|d| d.id == window.desktop_id)
        .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let definition =
        app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
    let mut found = None;
    data::walk_blocks(&definition.ui, "/ui", &mut |pointer, block| {
        if let Block::AgentSession {
            permission,
            root,
            agents,
            selected,
            ..
        } = block
        {
            found = Some((
                pointer.to_string(),
                permission.clone(),
                root.permission.clone(),
                agents.clone(),
                match agents {
                    data::Binding::State(reference) => window
                        .state
                        .get(&reference.state)
                        .filter(|value| !value.is_null())
                        .cloned(),
                    _ => None,
                },
                selected.state.clone(),
            ));
        }
    });
    let Some((pointer, permission, root, agents, agent_state, selected_key)) = found else {
        return Ok(None);
    };
    let selected = window
        .state
        .get(&selected_key)
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let grant = state
        .device
        .grants
        .iter()
        .find(|g| g.window_id == id && g.permission == root);
    let folder_name = grant.map(|g| g.root_name.clone());
    let cwd = if grant.is_some() {
        Some(files::granted_root(&state, id, &root, true)?)
    } else {
        None
    };
    let app_id = window.app_id.clone();
    let workspace = desktop.workspace_id.clone();
    let current_cwd = cwd.clone();
    let block_scope = (pointer.clone(), permission.clone(), root);
    let access = state.device.local_agent_access.clone();
    drop(state);
    let mut snapshot = LocalAgentSnapshot {
        generation: generation.into(),
        phase: LocalAgentPhase::ChoosingAgent,
        agents: vec![],
        selected: selected.clone(),
        folder_name,
        execution: None,
        auth_methods: vec![],
        controls: vec![],
        history: super::read_history(&record_dir(inner, id)),
        stream_id: None,
        text: String::new(),
        activity: kaleidoscope_contract::local_agent::AgentActivity {
            busy: false,
            tool: None,
        },
        permissions: vec![],
        queued: vec![],
        failure: None,
    };
    let result = match agents {
        data::Binding::Literal(value) => Some(BindingValue::Ready { value }),
        data::Binding::State(_) => agent_state.map(|value| BindingValue::Ready { value }),
        data::Binding::Expr(_) => {
            data_runtime::binding_value(inner, id, &format!("{pointer}/agents"))
        }
    };
    let specs = match result {
        Some(BindingValue::Ready { value }) => match validate_agent_specs(&value) {
            Ok(specs) => specs,
            Err(message) => {
                snapshot.phase = LocalAgentPhase::Failed;
                snapshot.failure = Some(AgentFailure {
                    code: ErrorCode::InvalidRequest,
                    message,
                    command: None,
                });
                return Ok(Some(Context {
                    snapshot,
                    config: None,
                    fingerprint: None,
                    app_id,
                    permission,
                    workspace,
                    cwd: current_cwd,
                    block_scope,
                }));
            }
        },
        _ => {
            return Ok(Some(Context {
                snapshot,
                config: None,
                fingerprint: None,
                app_id,
                permission,
                workspace,
                cwd: current_cwd,
                block_scope,
            }))
        }
    };
    snapshot.agents = specs
        .iter()
        .map(|s| AgentChoice {
            id: s.id.clone(),
            name: s.name.clone(),
        })
        .collect();
    let Some(spec) = selected
        .as_ref()
        .and_then(|id| specs.into_iter().find(|s| &s.id == id))
    else {
        return Ok(Some(Context {
            snapshot,
            config: None,
            fingerprint: None,
            app_id,
            permission,
            workspace,
            cwd: current_cwd,
            block_scope,
        }));
    };
    let Some(cwd) = cwd else {
        snapshot.phase = LocalAgentPhase::ChoosingFolder;
        return Ok(Some(Context {
            snapshot,
            config: None,
            fingerprint: None,
            app_id,
            permission,
            workspace,
            cwd: current_cwd,
            block_scope,
        }));
    };
    let hash = agent_spec_hash(&spec);
    snapshot.execution = Some(ExecutionConsent {
        spec_hash: hash.clone(),
        name: spec.name.clone(),
        command: spec.command.clone(),
        args: spec.args.clone(),
        env: spec.env.clone(),
    });
    if !access
        .iter()
        .any(|a| a.app_id == app_id && a.permission == permission && a.spec_hash == hash)
    {
        snapshot.phase = LocalAgentPhase::AwaitingPermission;
        return Ok(Some(Context {
            snapshot,
            config: None,
            fingerprint: None,
            app_id,
            permission,
            workspace,
            cwd: current_cwd,
            block_scope,
        }));
    }
    let link = inner.link_file.lock().unwrap().clone();
    let mcp = link.as_ref().map(|file| McpHttp {
        url: format!("{}/mcp", file.server_url.trim_end_matches('/')),
        headers: vec![
            ("Authorization".into(), format!("Bearer {}", file.token)),
            (
                kaleidoscope_contract::registry::WORKSPACE_HEADER.into(),
                workspace.clone(),
            ),
        ],
    });
    let fingerprint = Fingerprint {
        spec_hash: hash.clone(),
        cwd: cwd.clone(),
        block_scope: block_scope.clone(),
        mcp: link.as_ref().map(|file| {
            (
                file.server_url.clone(),
                !file.token.is_empty(),
                workspace.clone(),
            )
        }),
    };
    let config = WorkerConfig {
        window_id: id.into(),
        generation: generation.into(),
        spec,
        spec_hash: hash,
        cwd,
        mcp,
        record_dir: record_dir(inner, id),
    };
    Ok(Some(Context {
        snapshot,
        config: Some(config),
        fingerprint: Some(fingerprint),
        app_id,
        permission,
        workspace,
        cwd: current_cwd,
        block_scope,
    }))
}
