//! 저장 설정과 동기화된 작업을 대화 제공자의 현재 대화에 맞춘다.
use std::collections::{BTreeMap, HashMap};
use std::sync::{atomic::Ordering, Arc, Mutex};
use std::thread;

use kaleidoscope_contract::{
    conversation::{PatchThreadRequest, ThreadInfoReply, ThreadListReply},
    ConversationApplyStatus as Status, CoreError, CoreEvent, CoreReply, CoreRequest, LinkStatus,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{app_commands, conversation_context::Context, storage, Inner};

#[derive(Default)]
pub(crate) struct Runtime {
    state: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    running: bool,
    dirty: bool,
    statuses: HashMap<String, Status>,
    /// 저장값이 없을 때 설정 화면에 보일 지금 값. (앱 id, 저장 항목 id) → 모음.
    choices: HashMap<(String, String), String>,
}

impl Runtime {
    /// 저장값이 없을 때 설정 화면에 보일 지금 값. 모르면 `None`.
    pub(crate) fn choice(&self, app: &str, entry: &str) -> Option<String> {
        self.state
            .lock()
            .unwrap()
            .choices
            .get(&(app.to_string(), entry.to_string()))
            .cloned()
    }
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Applied {
    threads: BTreeMap<String, AppliedThread>,
}

#[derive(Serialize, Deserialize)]
struct AppliedThread {
    fingerprint: String,
    revisions: BTreeMap<String, Option<String>>,
    /// 이 대화를 마지막으로 맞췄을 때의 모음 설정. 옛 기록에는 없다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    collection: Option<AppliedCollection>,
}

#[derive(Clone, Serialize, Deserialize)]
struct AppliedCollection {
    revisions: BTreeMap<String, Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

/// 대화 모음 설정이 가리키는 저장 항목. 저장소 식 하나를 읽는 바인딩만 옮길 수 있다.
fn collection_entry(binding: &kaleidoscope_contract::data::Binding) -> Option<String> {
    match binding {
        kaleidoscope_contract::data::Binding::Expr(expr) => {
            let refs = kaleidoscope_contract::data::storage_refs(&expr.expr);
            (refs.len() == 1).then(|| refs[0].clone())
        }
        _ => None,
    }
}

/// 이 앱의 대화가 모두 같은 모음에 있으면 그 모음을 기억하고, 아니면 지운다.
fn remember_choice(inner: &Arc<Inner>, app: &kaleidoscope_contract::AppDefinition, collections: &[Option<String>]) {
    let Some(entry) = app.agent.as_ref().and_then(|agent| collection_entry(&agent.collection)) else {
        return;
    };
    let common = match collections.split_first() {
        Some((Some(first), rest)) if rest.iter().all(|value| value.as_deref() == Some(first.as_str())) => {
            Some(first.clone())
        }
        _ => None,
    };
    let mut state = inner.conversation_reconcile.state.lock().unwrap();
    match common {
        Some(value) => {
            state.choices.insert((app.id.clone(), entry), value);
        }
        None => {
            state.choices.remove(&(app.id.clone(), entry));
        }
    }
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
                    &agent.collection,
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
        _ => Err(kaleidoscope_contract::errors::CONV_RECONCILE_REQUEST_INVALID()),
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
        && inner.connections_snapshot_epoch.load(Ordering::SeqCst) == epoch
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

pub(crate) fn reconcile_app(
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
    let mut collections = Vec::new();
    for (namespace, contexts) in groups {
        let client = &contexts[0].client;
        let mut expected = std::collections::BTreeSet::new();
        for ctx in &contexts {
            let stored = ctx.read(inner, &ctx.provider.thread_entry)?;
            let binding = &stored.content;
            if stored.exists
                && !binding.is_null()
                && !crate::conversation_context::entry_attached(binding)
            {
                let id = binding
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        kaleidoscope_contract::errors::CONV_RECONCILE_BINDING_INVALID(
                            &ctx.workspace.name,
                        )
                    })?;
                if binding.get("namespace").and_then(Value::as_str) != Some(&namespace)
                    || binding.get("external_key").and_then(Value::as_str)
                        != Some(&ctx.workspace.id)
                    || binding.get("connection").and_then(Value::as_str)
                        != Some(&ctx.client.info.name)
                {
                    return Err(
                        kaleidoscope_contract::errors::CONV_RECONCILE_BINDING_CONFLICT(
                            &ctx.workspace.name,
                        ),
                    );
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
                .ok_or_else(kaleidoscope_contract::errors::CONV_RECONCILE_THREAD_LIST_MISSING)?;
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
                    .ok_or_else(|| {
                        kaleidoscope_contract::errors::CONV_RECONCILE_THREAD_MISSING()
                            .and_details(vec![format!("thread: {}", &reference.id)])
                    })?;
                if info.thread.external.namespace != namespace {
                    return Err(kaleidoscope_contract::errors::CONV_RECONCILE_NAMESPACE_CONFLICT());
                }
                let workspace = &info.thread.external.key;
                if let Some(ctx) = contexts.iter().find(|ctx| &ctx.workspace.id == workspace) {
                    apply_thread(inner, ctx, &namespace, &info, applied, &mut collections)?;
                    expected.remove(&reference.id);
                } else if safe_to_archive(inner, epoch, workspace) {
                    let patch = PatchThreadRequest {
                        title: None,
                        archived: Some(true),
                        model: None,
                        model_order: None,
                        instructions: None,
                        collection: None,
                    };
                    let reply: Option<Value> = client.json(
                        reqwest::Method::PATCH,
                        &client.path(&["threads", &reference.id])?,
                        &BTreeMap::new(),
                        Some(&patch),
                    )?;
                    if reply.is_none() {
                        return Err(
                            kaleidoscope_contract::errors::CONV_RECONCILE_ARCHIVE_NOT_FOUND()
                                .and_details(vec![format!("thread: {}", &reference.id)]),
                        );
                    }
                }
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        if let Some(thread) = expected.iter().next() {
            return Err(
                kaleidoscope_contract::errors::CONV_RECONCILE_BOUND_THREAD_MISSING()
                    .and_details(vec![format!("thread: {}", thread)]),
            );
        }
    }
    remember_choice(inner, app, &collections);
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
    collections: &mut Vec<Option<String>>,
) -> Result<(), CoreError> {
    let stored = ctx.read(inner, &ctx.provider.thread_entry)?;
    let binding = &stored.content;
    if !stored.exists || binding.is_null() || crate::conversation_context::entry_attached(binding) {
        return Ok(());
    }
    if binding.get("thread_id").and_then(Value::as_str) != Some(&info.thread.id)
        || binding.get("namespace").and_then(Value::as_str) != Some(namespace)
        || binding.get("external_key").and_then(Value::as_str) != Some(&ctx.workspace.id)
        || binding.get("connection").and_then(Value::as_str) != Some(&ctx.client.info.name)
    {
        return Err(
            kaleidoscope_contract::errors::CONV_RECONCILE_BINDING_CONFLICT(&ctx.workspace.name),
        );
    }
    let p = &ctx.provider;
    let (values, revisions) = ctx.values_with_revisions(
        inner,
        &[
            ("title_template", &p.title_template),
            ("instructions_template", &p.instructions_template),
            ("model_order", &p.model_order),
        ],
    )?;
    let template = |name: &str| -> Result<String, CoreError> {
        let text = values.get(name).and_then(Value::as_str).ok_or_else(|| {
            kaleidoscope_contract::errors::CONV_RECONCILE_TEMPLATE_INVALID(
                name,
                "글자 값이 없습니다",
            )
        })?;
        kaleidoscope_contract::validate::validate_workspace_template(text).map_err(|reason| {
            kaleidoscope_contract::errors::CONV_RECONCILE_TEMPLATE_INVALID(name, reason)
        })?;
        Ok(text
            .replace("{workspace.id}", &ctx.workspace.id)
            .replace("{workspace.name}", &ctx.workspace.name))
    };
    let title = template("title_template")?;
    let instructions = template("instructions_template")?;
    let model_order: Vec<String> =
        serde_json::from_value(values.get("model_order").cloned().unwrap_or(Value::Null))
            .map_err(|_| kaleidoscope_contract::errors::CONV_RECONCILE_MODEL_ORDER_INVALID())?;
    if model_order.is_empty()
        || model_order.iter().any(String::is_empty)
        || model_order
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != model_order.len()
    {
        return Err(kaleidoscope_contract::errors::CONV_RECONCILE_MODEL_ORDER_INVALID());
    }
    let (collection_values, collection_revisions) =
        ctx.values_with_revisions(inner, &[("collection", &p.collection)])?;
    let collection_value =
        crate::conversation_context::optional_string(&collection_values, "collection")?;
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(
                &json!({"values": values, "revisions": revisions, "workspace": ctx.workspace.name})
            )
            .map_err(|_| kaleidoscope_contract::errors::CONV_RECONCILE_FINGERPRINT_INVALID())?
        )
    );
    let key = format!("{}\n{}", namespace, info.thread.id);
    let record = applied.threads.get(&key);
    let changed = record.is_none_or(|record| record.fingerprint != fingerprint);
    let previous_collection = record.and_then(|record| record.collection.as_ref());
    let collection_record = (!collection_revisions.is_empty()).then(|| AppliedCollection {
        revisions: collection_revisions,
        value: collection_value.clone(),
    });
    let collection_state_changed = match (previous_collection, collection_record.as_ref()) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(previous), Some(current)) => {
            previous.revisions != current.revisions || previous.value != current.value
        }
    };
    let collection_changed = match (previous_collection, collection_record.as_ref()) {
        (Some(previous), Some(current)) => {
            previous.revisions.keys().eq(current.revisions.keys())
                && previous.revisions != current.revisions
        }
        _ => false,
    };
    let title_changed = info.thread.title != title;
    if changed || title_changed {
        let patch = PatchThreadRequest {
            title: Some(title),
            archived: None,
            model: None,
            model_order: Some(model_order),
            instructions: Some(instructions),
            collection: None,
        };
        let reply: Option<Value> = ctx.client.json(
            reqwest::Method::PATCH,
            &ctx.client.path(&["threads", &info.thread.id])?,
            &BTreeMap::new(),
            Some(&patch),
        )?;
        if reply.is_none() {
            return Err(
                kaleidoscope_contract::errors::CONV_RECONCILE_PATCH_NOT_FOUND()
                    .and_details(vec![format!("thread: {}", &info.thread.id)]),
            );
        }
    }
    let mut moved_to = None;
    let mut move_failed = false;
    let target = collection_changed.then(|| {
        collection_record.as_ref().and_then(|record| {
            record
                .revisions
                .values()
                .all(Option::is_some)
                .then(|| record.value.clone())
                .flatten()
        })
    }).flatten();
    if let Some(target) = target {
        if info.thread.collection.as_deref() == Some(target.as_str()) {
            moved_to = Some(target);
        } else {
            let patch = PatchThreadRequest {
                title: None,
                archived: None,
                model: None,
                model_order: None,
                instructions: None,
                collection: Some(target.clone()),
            };
            let result: Result<Option<Value>, CoreError> = ctx.client.json(
                reqwest::Method::PATCH,
                &ctx.client.path(&["threads", &info.thread.id])?,
                &BTreeMap::new(),
                Some(&patch),
            );
            match result {
                Ok(Some(_)) => moved_to = Some(target),
                Ok(None) => {
                    log_collection_move_failure(&info.thread.id, &target, "대화를 찾지 못했습니다");
                    move_failed = true;
                }
                Err(error) => {
                    log_collection_move_failure(&info.thread.id, &target, &error.message);
                    move_failed = true;
                }
            }
        }
    }
    collections.push(moved_to.or_else(|| info.thread.collection.clone()));
    if changed || title_changed || collection_state_changed {
        // 옮기지 못했으면 새 값을 기록하지 않는다. 다음 reconcile에서 같은 변경을 다시 보고 옮긴다.
        let collection = if move_failed {
            previous_collection.cloned()
        } else {
            collection_record
        };
        applied.threads.insert(
            key,
            AppliedThread {
                fingerprint,
                revisions,
                collection,
            },
        );
    }
    Ok(())
}

fn log_collection_move_failure(thread: &str, collection: &str, reason: &str) {
    let error = kaleidoscope_contract::errors::CONV_RECONCILE_COLLECTION_MOVE_FAILED(
        thread, collection, reason,
    );
    eprintln!(
        "대화 모음을 옮기지 못했습니다 ({}): {}",
        error.id.as_deref().unwrap_or("CONV_RECONCILE_COLLECTION_MOVE_FAILED"),
        error.message
    );
}
