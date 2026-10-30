//! 앱 정의의 원천 계획, 식 계산과 동작 단계. 입출력은 호출자가 맡는다.
use std::collections::BTreeMap;

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
    AppDefinition,
};
use serde_json::Value;

pub struct CompiledApp {
    sources: BTreeMap<String, SourceDecl>,
    expressions: BTreeMap<String, Result<AstNode, String>>,
    bindings: Vec<BindingDependencies>,
    actions: BTreeMap<String, Actions>,
}

/// 식 하나가 읽는 데이터 원천과 저장 항목. Core가 준비할 의존성을 드러낸다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingDependencies {
    pub pointer: String,
    pub data: Vec<String>,
    pub storage: Vec<String>,
    pub storage_meta: Vec<String>,
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
    Invalid(String),
}

pub struct Env<'a> {
    pub state: &'a BTreeMap<String, Value>,
    pub data: &'a BTreeMap<String, Value>,
    pub storage: &'a BTreeMap<String, Value>,
    pub storage_meta: &'a BTreeMap<String, Value>,
    pub event: &'a Value,
    pub item: &'a Value,
}

#[derive(Debug, PartialEq)]
pub enum Step {
    SetState {
        key: String,
        value: Value,
    },
    SetStorage {
        entry: String,
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
                        data: data::data_refs(&expr.expr),
                        storage: data::storage_refs(&expr.expr),
                        storage_meta: data::storage_meta_refs(&expr.expr),
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
        let Some(source) = self.sources.get(name) else {
            return SourcePlan::Invalid("없는 원천입니다".into());
        };
        let base = format!("/sources/{}", data::escape_pointer(name));
        let vars = Variables::new(state, &BTreeMap::new(), storage, storage_meta, None, None);
        let plan = || -> Result<SourcePlan, String> {
            match source {
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
        let vars = Variables::new(state, data, storage, storage_meta, None, None);
        self.bindings
            .iter()
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
                        Some(SourceStatus::Failed { message, .. }) => {
                            Some(((*name).clone(), message.clone()))
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
                        retry: failed.into_iter().map(|(name, _)| name).collect(),
                    }
                } else if loading {
                    BindingValue::Loading {}
                } else {
                    match self.eval(&binding.pointer, &vars) {
                        Ok(value) => BindingValue::Ready { value },
                        Err(message) => BindingValue::Failed {
                            message,
                            retry: Vec::new(),
                        },
                    }
                };
                (binding.pointer.clone(), result)
            })
            .collect()
    }

    pub fn actions_len(&self, pointer: &str) -> Option<usize> {
        self.actions.get(pointer).map(|a| match a {
            Actions::One(_) => 1,
            Actions::Many(a) => a.len(),
        })
    }

    pub fn action_step(&self, pointer: &str, index: usize, env: &Env<'_>) -> Result<Step, String> {
        let actions = self.actions.get(pointer).ok_or("없는 동작입니다")?;
        let vars = Variables::new(
            env.state,
            env.data,
            env.storage,
            env.storage_meta,
            Some(env.event),
            Some(env.item),
        );
        match actions {
            Actions::One(set) if index == 0 => Ok(Step::SetState {
                key: set.set_state.clone(),
                value: env.event.clone(),
            }),
            Actions::Many(actions) => {
                let action = actions.get(index).ok_or("없는 동작 단계입니다")?;
                let base = format!("{pointer}/{index}");
                match action {
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
        context.bind("storage".into(), vars.storage.clone());
        context.bind("storage_meta".into(), vars.storage_meta.clone());
        if let Some(event) = &vars.event {
            context.bind("event".into(), event.clone());
        }
        if let Some(item) = &vars.item {
            context.bind("item".into(), item.clone());
        }
        let mut evaluator = Evaluator::with_options(
            context,
            EvaluatorOptions {
                timeout_ms: Some(data::EXPR_TIMEOUT_MS),
                max_stack_depth: Some(2000),
                ..Default::default()
            },
        );
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
    storage: JValue,
    storage_meta: JValue,
    event: Option<JValue>,
    item: Option<JValue>,
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
            storage: JValue::from(serde_json::to_value(storage).expect("JSON 저장소")),
            storage_meta: JValue::from(
                serde_json::to_value(storage_meta).expect("JSON 저장소 메타데이터"),
            ),
            event: event.cloned().map(JValue::from),
            item: item.cloned().map(JValue::from),
        }
    }
}
fn string_path(value: Value) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "경로는 문자열이어야 합니다".into())
}
