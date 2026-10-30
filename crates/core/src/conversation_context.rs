//! 창의 앱, 작업, 저장소와 제공자 연결을 하나의 대화 문맥으로 묶는다.
use crate::{app_commands, app_storage, conversation_http::Client, error, Inner};
use kaleidoscope_contract::{
    app_storage::{ExpectedRevision, StorageReadReply, StorageWriteRequest},
    conversation::{
        AdoptThreadRequest, ConversationThread, EnsureThreadReply, EnsureThreadRequest,
        ModelsReply, ThreadByKeyReply,
    },
    data::{self, Binding},
    AgentProvider, AppDefinition, CoreError, ErrorCode, Workspace,
};
use kaleidoscope_data::{CompiledApp, Env};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub(crate) struct Context {
    pub client: Client,
    pub storage: app_storage::Context,
    pub provider: AgentProvider,
    pub workspace: Workspace,
    pub definition: AppDefinition,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ContextSnapshot {
    pub app: String,
    pub workspace: Workspace,
    pub definition: AppDefinition,
    pub connection: String,
}

impl Context {
    /// 開いた窓がなくても、登録済みアプリと作業から設定を解決する。
    pub fn for_workspace(
        inner: &Arc<Inner>,
        definition: AppDefinition,
        workspace: Workspace,
    ) -> Result<Self, CoreError> {
        let provider = definition
            .agent
            .clone()
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        let connection = definition
            .permissions
            .iter()
            .find_map(|permission| match permission {
                kaleidoscope_contract::PermissionDecl::Connection {
                    id,
                    connection,
                    access: kaleidoscope_contract::FileAccess::Readwrite,
                    ..
                } if id == &provider.permission => Some(connection.clone()),
                _ => None,
            })
            .ok_or_else(|| error::make(ErrorCode::PermissionDenied))?;
        let link = inner
            .link_file
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
        let client = Client::restore(inner, &connection, &provider.base_path)?;
        Ok(Self {
            client,
            storage: app_storage::Context {
                app: definition.id.clone(),
                workspace: workspace.id.clone(),
                link,
            },
            provider,
            workspace,
            definition,
        })
    }
    pub fn snapshot(&self) -> ContextSnapshot {
        ContextSnapshot {
            app: self.storage.app.clone(),
            workspace: self.workspace.clone(),
            definition: self.definition.clone(),
            connection: self.client.info.name.clone(),
        }
    }

    pub fn restore(inner: &Arc<Inner>, saved: &ContextSnapshot) -> Result<Self, CoreError> {
        let provider = saved
            .definition
            .agent
            .clone()
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        let client = Client::restore(inner, &saved.connection, &provider.base_path)?;
        let link = inner
            .link_file
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| error::make(ErrorCode::Unavailable))?;
        Ok(Self {
            client,
            storage: app_storage::Context {
                app: saved.app.clone(),
                workspace: saved.workspace.id.clone(),
                link,
            },
            provider,
            workspace: saved.workspace.clone(),
            definition: saved.definition.clone(),
        })
    }
    pub fn open(inner: &Arc<Inner>, window_id: &str) -> Result<Self, CoreError> {
        let (definition, workspace) = {
            let state = inner.state.lock().unwrap();
            let window = state
                .shared
                .windows
                .iter()
                .find(|w| w.id == window_id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let desktop = state
                .shared
                .desktops
                .iter()
                .find(|d| d.id == window.desktop_id)
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let workspace = state
                .shared
                .workspaces
                .iter()
                .find(|w| w.id == desktop.workspace_id)
                .cloned()
                .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            let definition =
                app_commands::definition_for(&state.shared, &window.app_id, window.app_version)
                    .ok_or_else(|| error::make(ErrorCode::NotFound))?;
            (definition, workspace)
        };
        let provider = definition
            .agent
            .clone()
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        let client = Client::new(inner, window_id, &provider.permission, &provider.base_path)?;
        let storage = app_storage::context(inner, window_id, Some(&provider.thread_entry))?;
        Ok(Self {
            client,
            storage,
            provider,
            workspace,
            definition,
        })
    }

    pub fn read(&self, inner: &Arc<Inner>, entry: &str) -> Result<StorageReadReply, CoreError> {
        inner
            .registry
            .storage_get(
                &self.storage.link.server_url,
                &self.storage.link.token,
                &self.storage.app,
                entry,
                &self.storage.workspace,
            )
            .map_err(|e| app_storage::map_error(inner, &self.storage.link, e))
    }

    pub fn values(
        &self,
        inner: &Arc<Inner>,
        bindings: &[(&str, &Binding)],
    ) -> Result<BTreeMap<String, Value>, CoreError> {
        self.values_with_revisions(inner, bindings)
            .map(|(values, _)| values)
    }

    pub fn values_with_revisions(
        &self,
        inner: &Arc<Inner>,
        bindings: &[(&str, &Binding)],
    ) -> Result<(BTreeMap<String, Value>, BTreeMap<String, Option<String>>), CoreError> {
        let mut refs = BTreeSet::new();
        for (_, binding) in bindings {
            if let Binding::Expr(expr) = binding {
                refs.extend(data::storage_refs(&expr.expr));
            }
        }
        let mut storage = BTreeMap::new();
        let mut revisions = BTreeMap::new();
        for entry in refs {
            let item = self.read(inner, &entry)?;
            revisions.insert(entry.clone(), item.revision);
            storage.insert(entry, item.content);
        }
        let list = inner
            .registry
            .storage_list(
                &self.storage.link.server_url,
                &self.storage.link.token,
                &self.storage.app,
                &self.storage.workspace,
            )
            .map_err(|e| app_storage::map_error(inner, &self.storage.link, e))?;
        let meta = BTreeMap::from([("bucket_id".into(), json!(list.bucket_id))]);
        let data = BTreeMap::new();
        let state = BTreeMap::new();
        let null = Value::Null;
        let env = Env {
            state: &state,
            data: &data,
            storage: &storage,
            storage_meta: &meta,
            event: &null,
            item: &null,
        };
        let compiled = CompiledApp::compile(&self.definition);
        let mut values = BTreeMap::new();
        for (field, binding) in bindings {
            let value = compiled
                .evaluate_binding(binding, &format!("/agent/{field}"), &env)
                .map_err(|message| error::with_message(ErrorCode::InvalidRequest, &message))?;
            values.insert((*field).into(), value);
        }
        Ok((values, revisions))
    }

    pub fn namespace(&self, inner: &Arc<Inner>) -> Result<String, CoreError> {
        let values = self.values(inner, &[("namespace", &self.provider.namespace)])?;
        required_string(&values, "namespace")
    }

    fn query(&self, namespace: &str) -> BTreeMap<String, String> {
        BTreeMap::from([
            ("namespace".into(), namespace.into()),
            ("key".into(), self.workspace.id.clone()),
        ])
    }

    pub fn models(&self) -> Result<ModelsReply, CoreError> {
        self.client
            .json(
                reqwest::Method::GET,
                &self.client.path(&["models"])?,
                &BTreeMap::new(),
                None::<&Value>,
            )?
            .ok_or_else(|| error::make(ErrorCode::NotFound))
    }

    pub fn thread(
        &self,
        inner: &Arc<Inner>,
        namespace: &str,
    ) -> Result<Option<ConversationThread>, CoreError> {
        let stored = self.read(inner, &self.provider.thread_entry)?;
        if stored.content.is_null() {
            return Ok(None);
        }
        let value = &stored.content;
        let id = value
            .get("thread_id")
            .and_then(Value::as_str)
            .ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        if value.get("namespace").and_then(Value::as_str) != Some(namespace)
            || value.get("external_key").and_then(Value::as_str) != Some(&self.workspace.id)
            || value.get("connection").and_then(Value::as_str) != Some(&self.client.info.name)
        {
            return Err(error::make(ErrorCode::BindingConflict));
        }
        let path = self.client.path(&["threads", "by-key"])?;
        let query = self.query(namespace);
        let reply: Option<ThreadByKeyReply> =
            self.client
                .json(reqwest::Method::GET, &path, &query, None::<&Value>)?;
        let thread = if let Some(reply) = reply {
            reply.thread
        } else {
            let adoption = AdoptThreadRequest {
                session_id: id.into(),
                first_input_is_initial_instruction: true,
            };
            let path = self.client.path(&["threads", "by-key", "adoption"])?;
            let reply: EnsureThreadReply = self
                .client
                .json(reqwest::Method::PUT, &path, &query, Some(&adoption))?
                .ok_or_else(|| error::make(ErrorCode::NotFound))
                .map_err(|e| {
                    if e.code == ErrorCode::Conflict {
                        error::make(ErrorCode::BindingConflict)
                    } else {
                        e
                    }
                })?;
            reply.thread
        };
        if thread.id != id {
            return Err(error::make(ErrorCode::BindingConflict));
        }
        Ok(Some(thread))
    }

    pub fn create(
        &self,
        inner: &Arc<Inner>,
        namespace: &str,
        model: &str,
    ) -> Result<ConversationThread, CoreError> {
        if let Some(thread) = self.thread(inner, namespace)? {
            return Ok(thread);
        }
        let p = &self.provider;
        let bindings = [
            ("profile", &p.profile),
            ("collection", &p.collection),
            ("model_order", &p.model_order),
            ("title_template", &p.title_template),
            (
                "initial_instruction_template",
                &p.initial_instruction_template,
            ),
            ("instructions_template", &p.instructions_template),
        ];
        let v = self.values(inner, &bindings)?;
        let models: Vec<String> =
            serde_json::from_value(v.get("model_order").cloned().unwrap_or_default())
                .map_err(|_| error::make(ErrorCode::InvalidRequest))?;
        if model.is_empty()
            || models.is_empty()
            || models.iter().any(String::is_empty)
            || models.iter().collect::<BTreeSet<_>>().len() != models.len()
        {
            return Err(error::make(ErrorCode::InvalidRequest));
        }
        let template = |name| -> Result<String, CoreError> {
            let template = required_string_allow_empty(&v, name)?;
            kaleidoscope_contract::validate::validate_workspace_template(&template)
                .map_err(|message| error::with_message(ErrorCode::InvalidRequest, message))?;
            Ok(template
                .replace("{workspace.id}", &self.workspace.id)
                .replace("{workspace.name}", &self.workspace.name))
        };
        let request = EnsureThreadRequest {
            title: template("title_template")?,
            selected_model: model.into(),
            model_order: models,
            profile: required_string(&v, "profile")?,
            collection: required_string(&v, "collection")?,
            initial_instruction: template("initial_instruction_template")?,
            instructions: template("instructions_template")?,
        };
        let reply: EnsureThreadReply = self
            .client
            .json(
                reqwest::Method::PUT,
                &self.client.path(&["threads", "by-key"])?,
                &self.query(namespace),
                Some(&request),
            )?
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let thread = reply.thread;
        let content = json!({"connection":self.client.info.name,"namespace":namespace,"external_key":self.workspace.id,"thread_id":thread.id,"created_at":thread.created_at});
        let write = StorageWriteRequest {
            content,
            expected_revision: ExpectedRevision(None),
        };
        let result = inner.registry.storage_write(
            &self.storage.link.server_url,
            &self.storage.link.token,
            &self.storage.app,
            &self.provider.thread_entry,
            &self.storage.workspace,
            &write,
        );
        match result {
            Ok(_) => Ok(thread),
            Err(crate::registry_client::RegistryError::Validation(e))
                if e.code == ErrorCode::Conflict =>
            {
                let existing = self.read(inner, &self.provider.thread_entry)?;
                if existing.content.get("thread_id").and_then(Value::as_str) == Some(&thread.id) {
                    Ok(thread)
                } else {
                    Err(error::make(ErrorCode::BindingConflict))
                }
            }
            Err(e) => Err(app_storage::map_error(inner, &self.storage.link, e)),
        }
    }
}

fn required_string_allow_empty(
    v: &BTreeMap<String, Value>,
    key: &str,
) -> Result<String, CoreError> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| error::make(ErrorCode::InvalidRequest))
}
fn required_string(v: &BTreeMap<String, Value>, key: &str) -> Result<String, CoreError> {
    let value = required_string_allow_empty(v, key)?;
    if value.trim().is_empty() {
        Err(error::make(ErrorCode::InvalidRequest))
    } else {
        Ok(value)
    }
}
