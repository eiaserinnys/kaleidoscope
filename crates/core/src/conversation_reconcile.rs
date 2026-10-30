//! 저장 설정과 동기화된 작업을 대화 제공자의 현재 대화에 맞춘다.
use std::collections::{BTreeMap, HashMap};
use std::sync::{atomic::Ordering, Arc, Mutex};
use std::thread;

use kaleidoscope_contract::{
    conversation::{PatchThreadRequest, ThreadInfoReply, ThreadListReply},
    ConversationApplyStatus as Status, CoreError, CoreEvent, CoreReply, CoreRequest, ErrorCode,
    LinkStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{app_commands, conversation_context::Context, error, storage, Inner};

#[derive(Default)]
pub(crate) struct Runtime {
    state: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    running: bool,
    dirty: bool,
    statuses: HashMap<String, Status>,
}

#[derive(Default, Serialize, Deserialize)]
struct Applied {
    threads: BTreeMap<String, AppliedThread>,
}

#[derive(Serialize, Deserialize)]
struct AppliedThread {
    fingerprint: String,
    revisions: BTreeMap<String, Option<String>>,
}

fn set_status(inner: &Arc<Inner>, app: &str, status: Status) {
    let changed = inner
        .conversation_reconcile
        .state
        .lock()
        .unwrap()
        .statuses
        .insert(app.into(), status)
        != Some(status);
    if changed {
        inner.emit(&CoreEvent::ConversationApplyStatus {
            app_id: app.into(),
            status,
        });
    }
}

pub(crate) fn schedule(inner: &Arc<Inner>) {
    let mut state = inner.conversation_reconcile.state.lock().unwrap();
    state.dirty = true;
    if state.running {
        return;
    }
    state.running = true;
    drop(state);
    let inner = Arc::clone(inner);
    thread::spawn(move || loop {
        {
            let mut state = inner.conversation_reconcile.state.lock().unwrap();
            if !state.dirty {
                state.running = false;
                return;
            }
            state.dirty = false;
        }
        run(&inner);
    });
}

/// 작업 변경이 전송 대기 중이면 배치가 모두 풀린 뒤에도 다시 확인한다.
pub(crate) fn workspace_changed(inner: &Arc<Inner>) {
    let state = inner.state.lock().unwrap();
    inner
        .conversation_workspace_sync_waiting
        .store(!state.sync.pending.is_empty(), Ordering::SeqCst);
    drop(state);
    schedule(inner);
}

/// 시간만 바뀐 작업은 대화의 생성, 이름 변경이나 삭제가 아니다.
pub(crate) fn workspace_names(state: &crate::CoreState) -> BTreeMap<String, String> {
    state
        .shared
        .workspaces
        .iter()
        .map(|workspace| (workspace.id.clone(), workspace.name.clone()))
        .collect()
}

/// 대화와 무관한 앱 문서 저장은 제공자 조회를 일으키지 않는다.
pub(crate) fn storage_changed(inner: &Arc<Inner>, app_id: &str, entry: Option<&str>) {
    let relevant = {
        let state = inner.state.lock().unwrap();
        state
            .shared
            .apps
            .iter()
            .find(|app| app.id == app_id)
            .and_then(|app| {
                app_commands::definition_for(&state.shared, &app.id, app.current_version)
            })
            .and_then(|definition| definition.agent)
            .is_some_and(|agent| {
                let Some(entry) = entry else {
                    return true;
                };
                if agent.thread_entry == entry {
                    return true;
                }
                [
                    &agent.namespace,
                    &agent.model_order,
                    &agent.selected_model,
                    &agent.title_template,
                    &agent.instructions_template,
                ]
                .iter()
                .any(|binding| match binding {
                    kaleidoscope_contract::data::Binding::Expr(expr) => {
                        kaleidoscope_contract::data::storage_refs(&expr.expr)
                            .iter()
                            .any(|id| id == entry)
                    }
                    _ => false,
                })
            })
    };
    if relevant {
        schedule(inner);
    }
}

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    match request {
        CoreRequest::ConversationApplyStatus { window_id } => {
            let app = Context::open(inner, &window_id)?.storage.app;
            let status = inner
                .conversation_reconcile
                .state
                .lock()
                .unwrap()
                .statuses
                .get(&app)
                .copied()
                .unwrap_or(Status::Unapplied);
            Ok(CoreReply::ConversationApplyStatus { status })
        }
        CoreRequest::ConversationApplyRetry { window_id } => {
            Context::open(inner, &window_id)?;
            schedule(inner);
            Ok(CoreReply::ConversationApplyRetry {})
        }
        _ => Err(error::make(ErrorCode::InvalidRequest)),
    }
}

fn run(inner: &Arc<Inner>) {
    let (apps, workspaces, connected) = {
        let state = inner.state.lock().unwrap();
        let apps = state
            .shared
            .apps
            .iter()
            .filter_map(|app| {
                app_commands::definition_for(&state.shared, &app.id, app.current_version)
                    .filter(|definition| definition.agent.is_some())
            })
            .collect::<Vec<_>>();
        (
            apps,
            state.shared.workspaces.clone(),
            matches!(state.link, LinkStatus::Connected { .. }),
        )
    };
    let epoch = inner.layout_connection_epoch.load(Ordering::SeqCst);
    let ready = connected
        && epoch != 0
        && inner.conversation_snapshot_epoch.load(Ordering::SeqCst) == epoch
        && !workspaces.is_empty();
    let path = inner.data_dir.join("conversation-applied.json");
    let mut applied: Applied = match storage::load_file(&path, "conversation-applied.json") {
        Ok(value) => value,
        Err(_) => {
            for app in apps {
                set_status(inner, &app.id, Status::Unapplied);
            }
            return;
        }
    };
    for app in apps {
        if !ready {
            set_status(inner, &app.id, Status::Unapplied);
            continue;
        }
        set_status(inner, &app.id, Status::Applying);
        let result = reconcile_app(inner, &app, &workspaces, epoch, &mut applied)
            .and_then(|()| storage::save_atomic(&path, &applied));
        if let Err(ref err) = result {
            eprintln!(
                "대화 설정을 적용하지 못했습니다 ({}): {}",
                app.id, err.message
            );
        }
        set_status(
            inner,
            &app.id,
            if result.is_ok() {
                Status::Applied
            } else {
                Status::Unapplied
            },
        );
    }
}

fn reconcile_app(
    inner: &Arc<Inner>,
    app: &kaleidoscope_contract::AppDefinition,
    workspaces: &[kaleidoscope_contract::Workspace],
    epoch: u64,
    applied: &mut Applied,
) -> Result<(), CoreError> {
    let mut groups: BTreeMap<String, Vec<Context>> = BTreeMap::new();
    for workspace in workspaces {
        let ctx = Context::for_workspace(inner, app.clone(), workspace.clone())?;
        ctx.client.require_login()?;
        groups.entry(ctx.namespace(inner)?).or_default().push(ctx);
    }
    for (namespace, contexts) in groups {
        let client = &contexts[0].client;
        let mut expected = std::collections::BTreeSet::new();
        for ctx in &contexts {
            let binding = ctx.read(inner, &ctx.provider.thread_entry)?.content;
            if !binding.is_null() {
                let id = binding
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| error::make(ErrorCode::BindingConflict))?;
                if binding.get("namespace").and_then(Value::as_str) != Some(&namespace)
                    || binding.get("external_key").and_then(Value::as_str)
                        != Some(&ctx.workspace.id)
                    || binding.get("connection").and_then(Value::as_str)
                        != Some(&ctx.client.info.name)
                {
                    return Err(error::make(ErrorCode::BindingConflict));
                }
                expected.insert(id.to_string());
            }
        }
        let mut cursor = None;
        loop {
            let mut query = BTreeMap::from([("namespace".into(), namespace.clone())]);
            if let Some(value) = cursor {
                query.insert("cursor".into(), value);
            }
            let page: ThreadListReply = client
                .json(
                    reqwest::Method::GET,
                    &client.path(&["threads"])?,
                    &query,
                    None::<&Value>,
                )?
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            for reference in page.refs {
                if reference.archived {
                    continue;
                }
                let info: ThreadInfoReply = client
                    .json(
                        reqwest::Method::GET,
                        &client.path(&["threads", &reference.id])?,
                        &BTreeMap::new(),
                        None::<&Value>,
                    )?
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
                if info.thread.external.namespace != namespace {
                    return Err(error::make(ErrorCode::BindingConflict));
                }
                let workspace = &info.thread.external.key;
                if let Some(ctx) = contexts.iter().find(|ctx| &ctx.workspace.id == workspace) {
                    apply_thread(inner, ctx, &namespace, &info, applied)?;
                    expected.remove(&reference.id);
                } else if safe_to_archive(inner, epoch, workspace) {
                    let patch = PatchThreadRequest {
                        title: None,
                        archived: Some(true),
                        model: None,
                        model_order: None,
                        instructions: None,
                    };
                    let reply: Option<Value> = client.json(
                        reqwest::Method::PATCH,
                        &client.path(&["threads", &reference.id])?,
                        &BTreeMap::new(),
                        Some(&patch),
                    )?;
                    if reply.is_none() {
                        return Err(error::make(ErrorCode::NotFound));
                    }
                }
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        if !expected.is_empty() {
            return Err(error::make(ErrorCode::NotFound));
        }
    }
    Ok(())
}

pub(crate) fn safe_to_archive(inner: &Inner, epoch: u64, workspace: &str) -> bool {
    let state = inner.state.lock().unwrap();
    matches!(state.link, LinkStatus::Connected { .. })
        && epoch == inner.layout_connection_epoch.load(Ordering::SeqCst)
        && epoch == inner.conversation_snapshot_epoch.load(Ordering::SeqCst)
        && !state.shared.workspaces.is_empty()
        && state.sync.pending.is_empty()
        && !state
            .shared
            .workspaces
            .iter()
            .any(|item| item.id == workspace)
}

fn apply_thread(
    inner: &Arc<Inner>,
    ctx: &Context,
    namespace: &str,
    info: &ThreadInfoReply,
    applied: &mut Applied,
) -> Result<(), CoreError> {
    let binding = ctx.read(inner, &ctx.provider.thread_entry)?.content;
    if binding.is_null() {
        return Ok(());
    }
    if binding.get("thread_id").and_then(Value::as_str) != Some(&info.thread.id)
        || binding.get("namespace").and_then(Value::as_str) != Some(namespace)
        || binding.get("external_key").and_then(Value::as_str) != Some(&ctx.workspace.id)
        || binding.get("connection").and_then(Value::as_str) != Some(&ctx.client.info.name)
    {
        return Err(error::make(ErrorCode::BindingConflict));
    }
    let p = &ctx.provider;
    let (values, revisions) = ctx.values_with_revisions(
        inner,
        &[
            ("title_template", &p.title_template),
            ("instructions_template", &p.instructions_template),
            ("model_order", &p.model_order),
            ("selected_model", &p.selected_model),
        ],
    )?;
    let template = |name: &str| -> Result<String, CoreError> {
        let text = values
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        kaleidoscope_contract::validate::validate_workspace_template(text)
            .map_err(|message| error::with_message(ErrorCode::InvalidRequest, message))?;
        Ok(text
            .replace("{workspace.id}", &ctx.workspace.id)
            .replace("{workspace.name}", &ctx.workspace.name))
    };
    let title = template("title_template")?;
    let instructions = template("instructions_template")?;
    let model_order: Vec<String> =
        serde_json::from_value(values.get("model_order").cloned().unwrap_or(Value::Null))
            .map_err(|_| error::make(ErrorCode::InvalidRequest))?;
    if model_order.is_empty()
        || model_order.iter().any(String::is_empty)
        || model_order
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != model_order.len()
    {
        return Err(error::make(ErrorCode::InvalidRequest));
    }
    let model = match values.get("selected_model") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) if !value.is_empty() => Some(value.clone()),
        _ => return Err(error::make(ErrorCode::InvalidRequest)),
    };
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(
                &json!({"values": values, "revisions": revisions, "workspace": ctx.workspace.name})
            )
            .map_err(|_| error::make(ErrorCode::InvalidRequest))?
        )
    );
    let key = format!("{}\n{}", namespace, info.thread.id);
    let changed = applied
        .threads
        .get(&key)
        .is_none_or(|record| record.fingerprint != fingerprint);
    if changed || info.thread.title != title {
        let patch = PatchThreadRequest {
            title: Some(title),
            archived: None,
            model,
            model_order: Some(model_order),
            instructions: Some(instructions),
        };
        let reply: Option<Value> = ctx.client.json(
            reqwest::Method::PATCH,
            &ctx.client.path(&["threads", &info.thread.id])?,
            &BTreeMap::new(),
            Some(&patch),
        )?;
        if reply.is_none() {
            return Err(error::make(ErrorCode::NotFound));
        }
        applied.threads.insert(
            key,
            AppliedThread {
                fingerprint,
                revisions,
            },
        );
    }
    Ok(())
}
