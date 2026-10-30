use super::{required_string, required_string_allow_empty, same_model_group, Context};
use crate::{app_storage, error, Inner};
use kaleidoscope_contract::{
    app_storage::{ExpectedRevision, StorageWriteRequest},
    conversation::{
        ConversationThread, EnsureThreadReply, EnsureThreadRequest, ExecutionThreadRequest,
        ThreadByKeyReply,
    },
    CoreError, ErrorCode,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

impl Context {
    pub fn create(
        &self,
        inner: &Arc<Inner>,
        namespace: &str,
        model: &str,
        profile: Option<&str>,
    ) -> Result<ConversationThread, CoreError> {
        if let Some(thread) = self.thread(inner, namespace)? {
            return Ok(thread);
        }
        let request = self.ensure_request(inner, model, profile)?;
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

    pub fn ensure_request(
        &self,
        inner: &Arc<Inner>,
        model: &str,
        profile: Option<&str>,
    ) -> Result<EnsureThreadRequest, CoreError> {
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
        Ok(EnsureThreadRequest {
            title: template("title_template")?,
            selected_model: model.into(),
            model_order: models,
            profile: match profile {
                Some(profile) if !profile.trim().is_empty() => profile.into(),
                Some(_) => return Err(error::make(ErrorCode::InvalidRequest)),
                None => required_string(&v, "profile")?,
            },
            collection: required_string(&v, "collection")?,
            initial_instruction: template("initial_instruction_template")?,
            instructions: template("instructions_template")?,
        })
    }

    pub fn switch(
        &self,
        inner: &Arc<Inner>,
        namespace: &str,
        requested_profile: Option<&str>,
        requested_model: Option<&str>,
    ) -> Result<(ConversationThread, Vec<String>), CoreError> {
        let thread = self
            .thread(inner, namespace)?
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        let configured_profile = if requested_profile.is_none() && thread.profile.is_none() {
            let values = self.values(inner, &[("profile", &self.provider.profile)])?;
            Some(required_string(&values, "profile")?)
        } else {
            None
        };
        let target_profile = requested_profile
            .or_else(|| thread.profile.as_ref().map(|profile| profile.id.as_str()))
            .or(configured_profile.as_deref());
        let profile_changed = requested_profile.is_some_and(|profile| {
            thread.profile.as_ref().map(|current| current.id.as_str()) != Some(profile)
        });
        let model = requested_model.unwrap_or(&thread.model.id);
        let model_changed = model != thread.model.id;
        if !profile_changed && !model_changed {
            return Ok((thread, Vec::new()));
        }

        let same_group = if !profile_changed && model_changed {
            let models = self.models(target_profile)?.models;
            let target_group = models
                .iter()
                .find(|candidate| candidate.id == model)
                .and_then(|candidate| candidate.group.as_ref())
                .map(|group| group.id.as_str());
            let current_group = thread.model.group.as_ref().map(|group| group.id.as_str());
            same_model_group(target_group, current_group)
        } else {
            false
        };
        if same_group {
            let patch = kaleidoscope_contract::conversation::PatchThreadRequest {
                title: None,
                archived: None,
                model: Some(model.into()),
                model_order: None,
                instructions: None,
            };
            let updated: Option<ThreadByKeyReply> = self.client.json(
                reqwest::Method::PATCH,
                &self.client.path(&["threads", &thread.id])?,
                &BTreeMap::new(),
                Some(&patch),
            )?;
            let updated = updated
                .ok_or_else(|| error::make(ErrorCode::NotFound))?
                .thread;
            if updated.id != thread.id {
                return Err(error::make(ErrorCode::BindingConflict));
            }
            return Ok((updated, Vec::new()));
        }

        let target_profile =
            target_profile.ok_or_else(|| error::make(ErrorCode::InvalidRequest))?;
        let ensure = self.ensure_request(inner, model, Some(target_profile))?;
        let execution = ExecutionThreadRequest {
            expected_execution_id: thread
                .execution_id
                .clone()
                .unwrap_or_else(|| thread.id.clone()),
            title: ensure.title,
            selected_model: ensure.selected_model,
            model_order: ensure.model_order,
            profile: ensure.profile,
            collection: ensure.collection,
            initial_instruction: ensure.initial_instruction,
            instructions: ensure.instructions,
        };
        let reply: EnsureThreadReply = self
            .client
            .json(
                reqwest::Method::PUT,
                &self.client.path(&["threads", &thread.id, "execution"])?,
                &BTreeMap::new(),
                Some(&execution),
            )?
            .ok_or_else(|| error::make(ErrorCode::NotFound))?;
        if reply.thread.id != thread.id {
            return Err(error::make(ErrorCode::BindingConflict));
        }
        Ok((reply.thread, reply.notices))
    }
}
