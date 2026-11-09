//! 이 작업에 제공자의 기존 대화를 연결하고 연결을 푼다.
use super::{entry_attached, required_string_allow_empty, Context};
use crate::{app_storage, Inner};
use kaleidoscope_contract::{
    app_storage::{ExpectedRevision, StorageWriteRequest},
    conversation::{
        AdoptableConversation, AdoptableReply, AdoptThreadRequest, ConversationThread,
        EnsureThreadReply, ThreadByKeyReply, ThreadInfoReply,
    },
    CoreError, ErrorCode,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;

impl Context {
    /// 저장된 대화 연결이 다른 제공자 대화를 가리키는지.
    pub fn attached(&self, inner: &Arc<Inner>) -> Result<bool, CoreError> {
        let stored = self.read(inner, &self.provider.thread_entry)?;
        Ok(entry_attached(&stored.content))
    }

    /// 이 작업 키에 이미 있는 대화. 연결하지 않고 읽기만 한다.
    pub fn own(&self, namespace: &str) -> Result<Option<ConversationThread>, CoreError> {
        let reply: Option<ThreadByKeyReply> = self.client.json(
            reqwest::Method::GET,
            &self.client.path(&["threads", "by-key"])?,
            &self.query(namespace),
            None::<&Value>,
        )?;
        Ok(reply.map(|reply| reply.thread))
    }

    /// 이 작업에 연결할 수 있는 다른 대화. 이 작업의 대화는 뺀다.
    pub fn adoptable(
        &self,
        own: Option<&ConversationThread>,
    ) -> Result<Vec<AdoptableConversation>, CoreError> {
        let reply: Option<AdoptableReply> = self.client.json(
            reqwest::Method::GET,
            &self.client.path(&["threads", "adoptable"])?,
            &BTreeMap::new(),
            None::<&Value>,
        )?;
        let mut candidates = reply.map(|reply| reply.candidates).unwrap_or_default();
        if let Some(own) = own {
            candidates.retain(|candidate| candidate.id != own.id);
        }
        Ok(candidates)
    }

    pub fn attach(
        &self,
        inner: &Arc<Inner>,
        namespace: &str,
        thread_id: &str,
    ) -> Result<ConversationThread, CoreError> {
        let stored = self.read(inner, &self.provider.thread_entry)?;
        if !stored.content.is_null() {
            return Err(
                kaleidoscope_contract::errors::CONV_ATTACH_ALREADY_BOUND(&self.workspace.name),
            );
        }
        let own: Option<ThreadByKeyReply> = self.client.json(
            reqwest::Method::GET,
            &self.client.path(&["threads", "by-key"])?,
            &self.query(namespace),
            None::<&Value>,
        )?;
        if let Some(reply) = own {
            if reply.thread.id == thread_id {
                let thread = reply.thread;
                let content = json!({"connection":self.client.info.name,"namespace":namespace,"external_key":self.workspace.id,"thread_id":thread.id,"created_at":thread.created_at});
                self.write_entry(inner, content, &thread)?;
                return Ok(thread);
            }
        }
        let info: Option<ThreadInfoReply> = self.client.json(
            reqwest::Method::GET,
            &self.client.path(&["threads", thread_id])?,
            &BTreeMap::new(),
            None::<&Value>,
        )?;
        let thread = match info {
            Some(reply) => reply.thread,
            None => self.adopt(namespace, thread_id)?,
        };
        let content = json!({"connection":self.client.info.name,"namespace":format!("{namespace}/attached"),"external_key":thread_id,"thread_id":thread.id,"created_at":thread.created_at,"attached":true});
        self.write_entry(inner, content, &thread)?;
        Ok(thread)
    }

    fn adopt(
        &self,
        namespace: &str,
        thread_id: &str,
    ) -> Result<ConversationThread, CoreError> {
        let request = AdoptThreadRequest {
            session_id: thread_id.into(),
            first_input_is_initial_instruction: false,
        };
        let query = BTreeMap::from([
            ("namespace".into(), format!("{namespace}/attached")),
            ("key".into(), thread_id.into()),
        ]);
        let reply: EnsureThreadReply = self
            .client
            .json_until_settled(
                reqwest::Method::PUT,
                &self.client.path(&["threads", "by-key", "adoption"])?,
                &query,
                Some(&request),
            )
            .map_err(|error| {
                if error.code == ErrorCode::Conflict {
                    kaleidoscope_contract::errors::CONV_ATTACH_CONFLICT()
                } else {
                    error
                }
            })?
            .ok_or_else(kaleidoscope_contract::errors::CONV_ATTACH_NOT_FOUND)?;
        Ok(reply.thread)
    }

    fn write_entry(
        &self,
        inner: &Arc<Inner>,
        content: Value,
        thread: &ConversationThread,
    ) -> Result<(), CoreError> {
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
            Ok(_) => Ok(()),
            Err(crate::registry_client::RegistryError::Validation(e))
                if e.code == ErrorCode::Conflict =>
            {
                let existing = self.read(inner, &self.provider.thread_entry)?;
                if existing.content.get("thread_id").and_then(Value::as_str) == Some(&thread.id) {
                    Ok(())
                } else {
                    Err(
                        kaleidoscope_contract::errors::CONV_SELECTION_BINDING_CONFLICT(
                            &self.workspace.name,
                        ),
                    )
                }
            }
            Err(e) => Err(app_storage::map_error(inner, &self.storage.link, e)),
        }
    }

    /// 연결을 풀고 이 작업이 가진 대화로 돌아간다. 제공자는 건드리지 않는다.
    pub fn detach(&self, inner: &Arc<Inner>) -> Result<(), CoreError> {
        let stored = self.read(inner, &self.provider.thread_entry)?;
        if stored.content.is_null() {
            return Ok(());
        }
        let write = StorageWriteRequest {
            content: Value::Null,
            expected_revision: ExpectedRevision(stored.revision.clone()),
        };
        inner
            .registry
            .storage_write(
                &self.storage.link.server_url,
                &self.storage.link.token,
                &self.storage.app,
                &self.provider.thread_entry,
                &self.storage.workspace,
                &write,
            )
            .map_err(|e| app_storage::map_error(inner, &self.storage.link, e))?;
        Ok(())
    }

    /// 연결한 대화에 말마다 덧붙이는 글. 없거나 비면 None.
    pub fn attached_instructions(&self, inner: &Arc<Inner>) -> Result<Option<String>, CoreError> {
        if !self.attached(inner)? {
            return Ok(None);
        }
        let Some(binding) = self.provider.attached_instructions_template.as_ref() else {
            return Ok(None);
        };
        let values = self.values(inner, &[("attached_instructions_template", binding)])?;
        let template = required_string_allow_empty(&values, "attached_instructions_template")?;
        if template.trim().is_empty() {
            return Ok(None);
        }
        kaleidoscope_contract::validate::validate_workspace_template(&template).map_err(
            |reason| {
                kaleidoscope_contract::errors::CONV_SELECTION_TEMPLATE_INVALID(
                    "attached_instructions_template",
                    reason,
                )
            },
        )?;
        Ok(Some(
            template
                .replace("{workspace.id}", &self.workspace.id)
                .replace("{workspace.name}", &self.workspace.name),
        ))
    }
}
