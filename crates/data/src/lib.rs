//! 앱 정의의 원천 계획, 식 계산과 동작 단계. 입출력은 호출자가 맡는다.
use std::collections::{BTreeMap, BTreeSet};
pub mod asset_validation;
pub mod public_http;
pub mod rate_limit;
pub mod share;

use jsonata_core::{
    ast::AstNode,
    evaluator::{Context, Evaluator, EvaluatorOptions},
    parser,
    value::JValue,
};
use kaleidoscope_contract::{
    data::{
        self, Action, Actions, Binding, BindingValue, HttpMethod, SourceDecl, SourceFormat,
        SourceStatus,
    },
    validate::{valid_relative_path, valid_request_path},
    AppDefinition, StringOrStateRef,
};
use serde_json::Value;

/// 한 쪽 응답을 뿌리로 다음 쪽 식을 계산한다.
pub fn evaluate_page_next(expr: &str, response: &Value, loaded: usize, pages: usize) -> Result<Value, String> {
    let ast = parser::parse(expr).map_err(|error| error.to_string())?;
    let mut context = Context::new();
    context.bind("loaded".into(), JValue::from(serde_json::json!(loaded)));
    context.bind("pages".into(), JValue::from(serde_json::json!(pages)));
    let mut evaluator = Evaluator::with_options(context, EvaluatorOptions {
        timeout_ms: Some(data::EXPR_TIMEOUT_MS),
        max_stack_depth: Some(2000),
        ..Default::default()
    });
    kaleidoscope_contract::jsonata_functions::install_standard_functions(&mut evaluator);
    let result = evaluator.evaluate(&ast, &JValue::from(response.clone())).map_err(|error| error.to_string())?;
    Ok(Value::from(&result))
}

/// JSONata는 정수도 부동소수점 숫자로 내므로 값이 정수인지 확인한다.
pub fn badge_count(value: &Value) -> Option<u32> {
    let number = value.as_f64()?;
    (number.is_finite() && number >= 0.0 && number <= u32::MAX as f64 && number.fract() == 0.0)
        .then_some(number as u32)
}

pub struct CompiledApp {
    sources: BTreeMap<String, SourceDecl>,
    source_order: Vec<String>,
    source_deps: BTreeMap<String, Vec<String>>,
    expressions: BTreeMap<String, Result<AstNode, String>>,
    bindings: Vec<BindingDependencies>,
    actions: BTreeMap<String, Actions>,
}

/// 식 하나가 읽는 데이터 원천과 저장 항목. Core가 준비할 의존성을 드러낸다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingDependencies {
    pub pointer: String,
    pub expr: String,
    pub state: Option<Vec<String>>,
    pub data: Vec<String>,
    pub data_meta: Vec<String>,
    pub storage: Vec<String>,
    pub storage_meta: Vec<String>,
    pub apps: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SourcePlan {
    Idle,
    Request {
        permission: String,
        path: String,
        query: BTreeMap<String, String>,
    },
    File {
        permission: String,
        path: String,
        format: SourceFormat,
    },
    Folder {
        permission: String,
        dir: String,
        recursive: bool,
        extensions: Vec<String>,
    },
    StoreIndex { permission: String, server: String },
    StoreIndexes { permission: String, servers: Vec<String> },
    StoreApp { permission: String, server: String, id: String },
    Invalid(String),
    StoreInvalid(kaleidoscope_contract::CoreError),
}

pub struct Env<'a> {
    pub state: &'a BTreeMap<String, Value>,
    pub data: &'a BTreeMap<String, Value>,
    pub data_meta: &'a BTreeMap<String, Value>,
    pub storage: &'a BTreeMap<String, Value>,
    pub storage_meta: &'a BTreeMap<String, Value>,
    pub apps: Option<&'a [kaleidoscope_contract::store::InstalledAppValue]>,
    pub event: &'a Value,
    pub item: &'a Value,
    pub modifiers: Option<&'a kaleidoscope_contract::client::EventModifiers>,
}

#[derive(Debug, PartialEq)]
pub enum Step {
    StoreAllowServer { permission: String, server: Value },
    StoreInstall { permission: String, server: Value, id: Value, release: Value, replace: bool },
    StoreRemove { permission: String, id: Value },
    ShellOpen { app_id: String },
    ShellAddShortcut { app_id: String },
    Worker {
        action: String,
        args: Option<Value>,
    },
    SetState {
        key: String,
        value: Value,
    },
    SetStorage {
        entry: String,
        doc: Option<String>,
        value: Value,
    },
    Refresh {
        names: Vec<String>,
    },
    Call {
        permission: String,
        method: HttpMethod,
        path: String,
        query: BTreeMap<String, String>,
        body: Option<Value>,
    },
}

/// 단계를 계산하지 못한 까닭. 쉘 동작의 앱 ID 오류는 등록된 오류를 그대로 돌려주고,
/// 나머지는 동작 경로를 붙여 `DATA_ACT_STEP_INVALID`로 돌려준다.
enum StepError {
    Reason(String),
    Shell(kaleidoscope_contract::CoreError),
}

impl From<String> for StepError {
    fn from(reason: String) -> Self {
        Self::Reason(reason)
    }
}

impl From<&str> for StepError {
    fn from(reason: &str) -> Self {
        Self::Reason(reason.into())
    }
}

impl CompiledApp {
    pub fn compile(definition: &AppDefinition) -> Self {
        let expressions = data::all_exprs(definition)
            .into_iter()
            .map(|(pointer, expr)| (pointer, parser::parse(expr).map_err(|err| err.to_string())))
            .collect();
        let bindings = data::ui_bindings(definition)
            .into_iter()
            .filter_map(|(pointer, binding)| {
                if let Binding::Expr(expr) = binding {
                    Some(BindingDependencies {
                        pointer,
                        expr: expr.expr.clone(),
                        state: data::state_refs(&expr.expr),
                        data: data::data_refs(&expr.expr),
                        data_meta: data::data_meta_refs(&expr.expr),
                        storage: data::storage_refs(&expr.expr),
                        storage_meta: data::storage_meta_refs(&expr.expr),
                        apps: data::apps_ref(&expr.expr),
                    })
                } else {
                    None
                }
            })
            .collect();
        let actions = data::ui_actions(definition)
            .into_iter()
            .map(|(pointer, action)| (pointer, action.clone()))
            .collect();
        Self {
            sources: definition.sources.clone(),
            source_order: data::source_topological_order(&definition.sources)
                .unwrap_or_else(|_| definition.sources.keys().cloned().collect()),
            source_deps: definition
                .sources
                .iter()
                .map(|(name, source)| (name.clone(), data::source_data_refs(source)))
                .collect(),
            expressions,
            bindings,
            actions,
        }
    }

    pub fn plan_source(&self, name: &str, state: &BTreeMap<String, Value>) -> SourcePlan {
        self.plan_source_with_storage(name, state, &BTreeMap::new(), &BTreeMap::new())
    }

    pub fn plan_source_with_storage(
        &self,
        name: &str,
        state: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
    ) -> SourcePlan {
        self.plan_source_with_data_and_storage(name, state, &BTreeMap::new(), storage, storage_meta)
    }

    pub fn source_order(&self) -> &[String] {
        &self.source_order
    }

    pub fn source_dependencies(&self, name: &str) -> &[String] {
        self.source_deps.get(name).map(Vec::as_slice).unwrap_or(&[])
    }

    pub fn plan_source_with_data_and_storage(
        &self,
        name: &str,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
    ) -> SourcePlan {
        self.plan_source_with_apps(name, state, data, storage, storage_meta, None)
    }

    pub fn plan_source_with_apps(
        &self,
        name: &str,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        apps: Option<&[kaleidoscope_contract::store::InstalledAppValue]>,
    ) -> SourcePlan {
        let Some(source) = self.sources.get(name) else {
            return SourcePlan::Invalid("없는 원천입니다".into());
        };
        let base = format!("/sources/{}", data::escape_pointer(name));
        let vars = Variables::new(state, data, storage, storage_meta, None, None).with_apps(apps);
        let plan = || -> Result<SourcePlan, String> {
            match source {
                SourceDecl::Store(store) => {
                    use data::StoreSource;
                    if let StoreSource::Indexes { permission, servers } = store {
                        let value = self.binding(servers, &format!("{base}/servers"), state, &vars)?;
                        if value.is_null() { return Ok(SourcePlan::Idle); }
                        let Some(values) = value.as_array() else {
                            return Ok(SourcePlan::StoreInvalid(kaleidoscope_contract::errors::STORECLIENT_INDEXES_SERVERS_INVALID("servers")));
                        };
                        if values.is_empty() { return Ok(SourcePlan::Idle); }
                        let mut servers = Vec::with_capacity(values.len());
                        for (index, value) in values.iter().enumerate() {
                            let Some(server) = value.as_str() else {
                                return Ok(SourcePlan::StoreInvalid(kaleidoscope_contract::errors::STORECLIENT_INDEXES_SERVERS_INVALID(format!("servers[{index}]"))));
                            };
                            servers.push(server.to_owned());
                        }
                        return Ok(SourcePlan::StoreIndexes { permission: permission.clone(), servers });
                    }
                    let (permission, server, id) = match store {
                        StoreSource::Index { permission, server, .. } => (permission, server, None),
                        StoreSource::App { permission, server, id, .. } => (permission, server, Some(id)),
                        StoreSource::Indexes { .. } => unreachable!(),
                    };
                    let server = self.binding(server, &format!("{base}/server"), state, &vars)?;
                    if server.is_null() { return Ok(SourcePlan::Idle); }
                    let Some(server) = server.as_str().map(str::to_owned) else {
                        return Ok(SourcePlan::StoreInvalid(if id.is_some() { kaleidoscope_contract::errors::STORECLIENT_DETAIL_SERVER_INVALID() } else { kaleidoscope_contract::errors::STORECLIENT_INDEX_SERVER_INVALID() }));
                    };
                    match id {
                        None => Ok(SourcePlan::StoreIndex { permission: permission.clone(), server }),
                        Some(id) => {
                            let id = self.binding(id, &format!("{base}/id"), state, &vars)?;
                            if id.is_null() { return Ok(SourcePlan::Idle); }
                            let Some(id) = id.as_str().map(str::to_owned) else { return Ok(SourcePlan::StoreInvalid(kaleidoscope_contract::errors::STORECLIENT_DETAIL_ID_INVALID())); };
                            Ok(SourcePlan::StoreApp { permission: permission.clone(), server, id })
                        }
                    }
                },
                SourceDecl::Request {
                    permission,
                    path,
                    query,
                    ..
                } => {
                    let value = self.binding(path, &format!("{base}/path"), state, &vars)?;
                    if value.is_null() {
                        return Ok(SourcePlan::Idle);
                    }
                    let path = string_path(value)?;
                    if !valid_request_path(&path) {
                        return Err("올바르지 않은 연결 경로입니다".into());
                    }
                    let query = self.query(query, &format!("{base}/query"), state, &vars)?;
                    Ok(SourcePlan::Request {
                        permission: permission.clone(),
                        path,
                        query,
                    })
                }
                SourceDecl::File {
                    permission,
                    path,
                    format,
                    ..
                } => {
                    let value = self.binding(path, &format!("{base}/path"), state, &vars)?;
                    if value.is_null() {
                        return Ok(SourcePlan::Idle);
                    }
                    let path = string_path(value)?;
                    if !valid_relative_path(&path, false) {
                        return Err("올바르지 않은 파일 경로입니다".into());
                    }
                    Ok(SourcePlan::File {
                        permission: permission.clone(),
                        path,
                        format: *format,
                    })
                }
                SourceDecl::Folder {
                    permission,
                    dir,
                    recursive,
                    extensions,
                    ..
                } => {
                    let value = match dir {
                        Some(dir) => self.binding(dir, &format!("{base}/dir"), state, &vars)?,
                        None => Value::String(String::new()),
                    };
                    if value.is_null() {
                        return Ok(SourcePlan::Idle);
                    }
                    let dir = string_path(value)?;
                    if !valid_relative_path(&dir, true) {
                        return Err("올바르지 않은 폴더 경로입니다".into());
                    }
                    Ok(SourcePlan::Folder {
                        permission: permission.clone(),
                        dir,
                        recursive: *recursive,
                        extensions: extensions.clone(),
                    })
                }
            }
        };
        plan().unwrap_or_else(SourcePlan::Invalid)
    }

    pub fn binding_dependencies(&self) -> &[BindingDependencies] {
        &self.bindings
    }

    /// 창이나 원천 없이 앱 목록만으로 배지를 계산한다.
    pub fn evaluate_badge(&self, badge: &kaleidoscope_contract::AppBadge, apps: Option<&[kaleidoscope_contract::store::InstalledAppValue]>) -> Result<Value, String> {
        match badge {
            kaleidoscope_contract::AppBadge::Count(count) => Ok(Value::from(*count)),
            kaleidoscope_contract::AppBadge::Expr(_) => {
                let empty = BTreeMap::new();
                let vars = Variables::new(&empty, &empty, &empty, &empty, None, None).with_apps(apps);
                self.eval("/badge", &vars)
            }
        }
    }

    /// 앱 정의의 제공자 바인딩을 같은 식 엔진으로 계산한다.
    pub fn evaluate_binding(
        &self,
        binding: &Binding,
        pointer: &str,
        env: &Env<'_>,
    ) -> Result<Value, String> {
        let vars = Variables::new(
            env.state,
            env.data,
            env.storage,
            env.storage_meta,
            Some(env.event),
            Some(env.item),
        )
        .with_data_meta(env.data_meta)
        .with_apps(env.apps);
        self.binding(binding, pointer, env.state, &vars)
    }

    pub fn evaluate(
        &self,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        statuses: &BTreeMap<String, SourceStatus>,
    ) -> BTreeMap<String, BindingValue> {
        self.evaluate_with_storage(state, data, &BTreeMap::new(), &BTreeMap::new(), statuses)
    }

    pub fn evaluate_with_storage(
        &self,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        statuses: &BTreeMap<String, SourceStatus>,
    ) -> BTreeMap<String, BindingValue> {
        self.evaluate_selected_with_storage(state, data, storage, storage_meta, statuses, None)
    }

    /// 지정한 바인딩만 다시 계산한다. None이면 모두 계산한다.
    pub fn evaluate_selected_with_storage(
        &self,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        statuses: &BTreeMap<String, SourceStatus>,
        selected: Option<&BTreeSet<String>>,
    ) -> BTreeMap<String, BindingValue> {
        self.evaluate_with_data_meta(
            state,
            data,
            storage,
            storage_meta,
            &BTreeMap::new(),
            statuses,
            selected,
        )
    }

    /// 원천 메타데이터를 포함하여 지정한 바인딩을 계산한다.
    pub fn evaluate_with_data_meta(
        &self,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        data_meta: &BTreeMap<String, Value>,
        statuses: &BTreeMap<String, SourceStatus>,
        selected: Option<&BTreeSet<String>>,
    ) -> BTreeMap<String, BindingValue> {
        self.evaluate_profiled(
            state,
            data,
            storage,
            storage_meta,
            data_meta,
            None,
            statuses,
            selected,
            &mut |_, _| {},
        )
    }

    pub fn evaluate_profiled(
        &self,
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        data_meta: &BTreeMap<String, Value>,
        apps: Option<&[kaleidoscope_contract::store::InstalledAppValue]>,
        statuses: &BTreeMap<String, SourceStatus>,
        selected: Option<&BTreeSet<String>>,
        observe: &mut dyn FnMut(&BindingDependencies, f64),
    ) -> BTreeMap<String, BindingValue> {
        if selected.is_some_and(|selected| {
            !self
                .bindings
                .iter()
                .any(|binding| selected.contains(&binding.pointer))
        }) || self.bindings.is_empty()
        {
            return BTreeMap::new();
        }
        let vars = Variables::new(state, data, storage, storage_meta, None, None)
            .with_data_meta(data_meta)
            .with_apps(apps);
        self.bindings
            .iter()
            .filter(|binding| selected.is_none_or(|selected| selected.contains(&binding.pointer)))
            .map(|binding| {
                let missing: Vec<_> = binding
                    .data
                    .iter()
                    .filter(|name| !data.contains_key(*name))
                    .collect();
                let login = missing.iter().find_map(|name| match statuses.get(*name) {
                    Some(SourceStatus::LoginRequired { permission }) => Some(permission.clone()),
                    _ => None,
                });
                let failed: Vec<_> = missing
                    .iter()
                    .filter_map(|name| match statuses.get(*name) {
                        Some(SourceStatus::Failed { message, id, .. }) => {
                            Some(((*name).clone(), message.clone(), id.clone()))
                        }
                        _ => None,
                    })
                    .collect();
                let loading = missing
                    .iter()
                    .any(|name| matches!(statuses.get(*name), Some(SourceStatus::Loading { .. })));
                let result = if let Some(permission) = login {
                    BindingValue::LoginRequired { permission }
                } else if !failed.is_empty() {
                    BindingValue::Failed {
                        message: failed[0].1.clone(),
                        id: failed[0].2.clone(),
                        retry: failed.into_iter().map(|(name, _, _)| name).collect(),
                        details: None,
                    }
                } else if loading {
                    BindingValue::Loading {}
                } else {
                    let started = std::time::Instant::now();
                    let result = match self.eval(&binding.pointer, &vars) {
                        Ok(value) => BindingValue::Ready { value, more: None },
                        Err(message) => BindingValue::Failed {
                            message,
                            id: None,
                            retry: Vec::new(),
                            details: None,
                        },
                    };
                    observe(binding, started.elapsed().as_secs_f64() * 1000.0);
                    result
                };
                (binding.pointer.clone(), result)
            })
            .collect()
    }

    pub fn actions_len(&self, pointer: &str) -> Option<usize> {
        self.actions.get(pointer).map(|a| match a {
            Actions::One(_) => 1,
            Actions::Many(a) => a.len(),
            Actions::Client(_)
            | Actions::PickFiles(_)
            | Actions::SaveFile(_)
            | Actions::OpenUrl(_)
            | Actions::CopyText(_) => 0,
        })
    }

    pub fn action_step(
        &self,
        pointer: &str,
        index: usize,
        env: &Env<'_>,
    ) -> Result<Step, kaleidoscope_contract::CoreError> {
        match self.action_step_reason(pointer, index, env) {
            Ok(step) => Ok(step),
            Err(StepError::Reason(reason)) => Err(kaleidoscope_contract::errors::DATA_ACT_STEP_INVALID(
                pointer,
                &reason,
            )),
            Err(StepError::Shell(error)) => Err(error),
        }
    }

    fn action_step_reason(
        &self,
        pointer: &str,
        index: usize,
        env: &Env<'_>,
    ) -> Result<Step, StepError> {
        let actions = self.actions.get(pointer).ok_or("없는 동작입니다")?;
        let vars = Variables::new(
            env.state,
            env.data,
            env.storage,
            env.storage_meta,
            Some(env.event),
            Some(env.item),
        )
        .with_data_meta(env.data_meta)
        .with_apps(env.apps)
        .with_modifiers(env.modifiers);
        match actions {
            Actions::One(set) if index == 0 => Ok(Step::SetState {
                key: set.set_state.clone(),
                value: env.event.clone(),
            }),
            Actions::Many(actions) => {
                let action = actions.get(index).ok_or("없는 동작 단계입니다")?;
                let base = format!("{pointer}/{index}");
                match action {
                    Action::StoreAllowServer(action) => {
                        let spec = &action.store_allow_server;
                        Ok(Step::StoreAllowServer {
                            permission: spec.permission.clone(),
                            server: self.binding(&spec.server, &format!("{base}/store.allow_server/server"), env.state, &vars)?,
                        })
                    }
                    Action::StoreInstall(action) => {
                        let spec = &action.store_install;
                        Ok(Step::StoreInstall {
                            permission: spec.permission.clone(),
                            server: self.binding(&spec.server, &format!("{base}/store.install/server"), env.state, &vars)?,
                            id: self.binding(&spec.id, &format!("{base}/store.install/id"), env.state, &vars)?,
                            release: self.binding(&spec.release, &format!("{base}/store.install/release"), env.state, &vars)?,
                            replace: spec.replace,
                        })
                    }
                    Action::StoreRemove(action) => {
                        let spec = &action.store_remove;
                        Ok(Step::StoreRemove {
                            permission: spec.permission.clone(),
                            id: self.binding(&spec.id, &format!("{base}/store.remove/id"), env.state, &vars)?,
                        })
                    }
                    Action::ShellOpen(action) => Ok(Step::ShellOpen {
                        app_id: self.shell_app_id(
                            &action.shell_open.app_id,
                            &format!("{base}/shell.open/app_id"),
                            env.state,
                            &vars,
                            |value| kaleidoscope_contract::errors::DATA_SHELL_OPEN_APP_ID_INVALID(value),
                        )?,
                    }),
                    Action::ShellAddShortcut(action) => Ok(Step::ShellAddShortcut {
                        app_id: self.shell_app_id(
                            &action.shell_add_shortcut.app_id,
                            &format!("{base}/shell.add_shortcut/app_id"),
                            env.state,
                            &vars,
                            |value| {
                                kaleidoscope_contract::errors::DATA_SHELL_SHORTCUT_APP_ID_INVALID(value)
                            },
                        )?,
                    }),
                    Action::Client(_)
                    | Action::PickFiles(_)
                    | Action::SaveFile(_)
                    | Action::CopyText(_) => {
                        Err("클라이언트 동작은 코어에서 실행할 수 없습니다".into())
                    }
                    Action::Worker(worker) => Ok(Step::Worker {
                        action: worker.worker.action.clone(),
                        args: worker
                            .worker
                            .args
                            .as_ref()
                            .map(|binding| {
                                self.binding(
                                    binding,
                                    &format!("{base}/worker/args"),
                                    env.state,
                                    &vars,
                                )
                            })
                            .transpose()?,
                    }),
                    Action::SetState(set) => Ok(Step::SetState {
                        key: set.set_state.clone(),
                        value: match &set.value {
                            Some(binding) => {
                                self.binding(binding, &format!("{base}/value"), env.state, &vars)?
                            }
                            None => env.event.clone(),
                        },
                    }),
                    Action::SetStorage(set_storage) => Ok(Step::SetStorage {
                        entry: set_storage.set_storage.entry.clone(),
                        doc: match &set_storage.set_storage.doc {
                            Some(StringOrStateRef::String(doc)) => Some(doc.clone()),
                            Some(StringOrStateRef::State(state)) => Some(
                                env.state
                                    .get(&state.state)
                                    .and_then(Value::as_str)
                                    .ok_or("set_storage doc 상태는 문자열이어야 합니다")?
                                    .to_owned(),
                            ),
                            None => None,
                        },
                        value: match &set_storage.set_storage.value {
                            Some(binding) => self.binding(
                                binding,
                                &format!("{base}/set_storage/value"),
                                env.state,
                                &vars,
                            )?,
                            None => env.event.clone(),
                        },
                    }),
                    Action::Refresh(refresh) => Ok(Step::Refresh {
                        names: refresh.refresh.clone(),
                    }),
                    Action::Call(call) => {
                        let path = string_path(self.binding(
                            &call.call.path,
                            &format!("{base}/call/path"),
                            env.state,
                            &vars,
                        )?)?;
                        if !valid_request_path(&path) {
                            return Err("올바르지 않은 연결 경로입니다".into());
                        }
                        let query = self.query(
                            &call.call.query,
                            &format!("{base}/call/query"),
                            env.state,
                            &vars,
                        )?;
                        let body = call
                            .call
                            .body
                            .as_ref()
                            .map(|b| {
                                self.binding(b, &format!("{base}/call/body"), env.state, &vars)
                            })
                            .transpose()?;
                        Ok(Step::Call {
                            permission: call.call.permission.clone(),
                            method: call.call.method,
                            path,
                            query,
                            body,
                        })
                    }
                }
            }
            _ => Err("없는 동작 단계입니다".into()),
        }
    }

    /// 쉘 동작의 `app_id` 바인딩이 비어 있지 않은 문자열인지 확인한다.
    fn shell_app_id(
        &self,
        binding: &Binding,
        pointer: &str,
        state: &BTreeMap<String, Value>,
        vars: &Variables,
        invalid: impl Fn(&Value) -> kaleidoscope_contract::CoreError,
    ) -> Result<String, StepError> {
        let value = self.binding(binding, pointer, state, vars)?;
        value
            .as_str()
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| StepError::Shell(invalid(&value)))
    }

    fn binding(
        &self,
        binding: &Binding,
        pointer: &str,
        state: &BTreeMap<String, Value>,
        vars: &Variables,
    ) -> Result<Value, String> {
        match binding {
            Binding::Literal(value) => Ok(value.clone()),
            Binding::State(reference) => {
                Ok(state.get(&reference.state).cloned().unwrap_or(Value::Null))
            }
            Binding::Expr(_) => self.eval(pointer, vars),
            Binding::Client(_) => Err("클라이언트 값은 코어에서 읽을 수 없습니다".into()),
            Binding::Item(_) => Err("반복 항목 값은 코어에서 읽을 수 없습니다".into()),
            Binding::ParentItem(_) => Err("부모 반복 항목 값은 코어에서 읽을 수 없습니다".into()),
            Binding::Message(_) => Err("메시지는 코어에서 읽을 수 없습니다".into()),
        }
    }

    fn query(
        &self,
        bindings: &BTreeMap<String, Binding>,
        pointer: &str,
        state: &BTreeMap<String, Value>,
        vars: &Variables,
    ) -> Result<BTreeMap<String, String>, String> {
        let mut query = BTreeMap::new();
        for (key, binding) in bindings {
            let value = self.binding(
                binding,
                &format!("{pointer}/{}", data::escape_pointer(key)),
                state,
                vars,
            )?;
            if !value.is_null() {
                query.insert(
                    key.clone(),
                    match value {
                        Value::String(s) => s,
                        other => other.to_string(),
                    },
                );
            }
        }
        Ok(query)
    }

    fn eval(&self, pointer: &str, vars: &Variables) -> Result<Value, String> {
        let ast = self
            .expressions
            .get(pointer)
            .ok_or("없는 식입니다")?
            .as_ref()
            .map_err(Clone::clone)?;
        let mut context = Context::new();
        context.bind("state".into(), vars.state.clone());
        context.bind("data".into(), vars.data.clone());
        context.bind("data_meta".into(), vars.data_meta.clone());
        context.bind("storage".into(), vars.storage.clone());
        context.bind("storage_meta".into(), vars.storage_meta.clone());
        if let Some(apps) = &vars.apps { context.bind("apps".into(), apps.clone()); }
        if let Some(event) = &vars.event {
            context.bind("event".into(), event.clone());
        }
        if let Some(item) = &vars.item {
            context.bind("item".into(), item.clone());
        }
        if let Some(modifiers) = &vars.modifiers {
            context.bind("modifiers".into(), modifiers.clone());
        }
        let mut evaluator = Evaluator::with_options(
            context,
            EvaluatorOptions {
                timeout_ms: Some(data::EXPR_TIMEOUT_MS),
                max_stack_depth: Some(2000),
                ..Default::default()
            },
        );
        kaleidoscope_contract::jsonata_functions::install_standard_functions(&mut evaluator);
        let result = evaluator
            .evaluate(ast, &JValue::Null)
            .map_err(|err| err.to_string())?;
        let value = Value::from(&result);
        if serde_json::to_vec(&value)
            .map_err(|err| err.to_string())?
            .len()
            > data::DATA_VALUE_MAX_BYTES
        {
            return Err("식 결과가 너무 큽니다".into());
        }
        Ok(value)
    }
}

struct Variables {
    state: JValue,
    data: JValue,
    data_meta: JValue,
    storage: JValue,
    storage_meta: JValue,
    apps: Option<JValue>,
    event: Option<JValue>,
    item: Option<JValue>,
    modifiers: Option<JValue>,
}
impl Variables {
    fn new(
        state: &BTreeMap<String, Value>,
        data: &BTreeMap<String, Value>,
        storage: &BTreeMap<String, Value>,
        storage_meta: &BTreeMap<String, Value>,
        event: Option<&Value>,
        item: Option<&Value>,
    ) -> Self {
        Self {
            state: JValue::from(serde_json::to_value(state).expect("JSON 상태")),
            data: JValue::from(serde_json::to_value(data).expect("JSON 원천")),
            data_meta: JValue::from(serde_json::json!({})),
            storage: JValue::from(serde_json::to_value(storage).expect("JSON 저장소")),
            storage_meta: JValue::from(
                serde_json::to_value(storage_meta).expect("JSON 저장소 메타데이터"),
            ),
            apps: None,
            event: event.cloned().map(JValue::from),
            item: item.cloned().map(JValue::from),
            modifiers: None,
        }
    }

    fn with_modifiers(
        mut self,
        modifiers: Option<&kaleidoscope_contract::client::EventModifiers>,
    ) -> Self {
        let value = modifiers
            .map(|value| serde_json::to_value(value).expect("JSON 수정 키"))
            .unwrap_or_else(
                || serde_json::json!({"shift": false, "alt": false, "ctrl": false, "meta": false}),
            );
        self.modifiers = Some(JValue::from(value));
        self
    }

    fn with_data_meta(mut self, meta: &BTreeMap<String, Value>) -> Self {
        self.data_meta = JValue::from(serde_json::to_value(meta).expect("JSON 원천 메타데이터"));
        self
    }
    fn with_apps(mut self, apps: Option<&[kaleidoscope_contract::store::InstalledAppValue]>) -> Self {
        self.apps = apps.map(|apps| JValue::from(serde_json::to_value(apps).expect("JSON 앱 목록")));
        self
    }
}
fn string_path(value: Value) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "경로는 문자열이어야 합니다".into())
}
