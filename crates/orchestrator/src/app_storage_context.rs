use super::*;
use kaleidoscope_contract::app_storage as contract;

impl AppState {
    pub(super) fn storage_app_data(&self, workspace_id: &str) -> Result<Vec<Value>, CoreError> {
        let account_id = self.mcp_account_id()?;
        let apps = self.current_apps()?;
        let mut result = Vec::new();
        for app in apps {
            let Some(storage) = app.version.definition.storage.as_ref() else {
                continue;
            };
            let listed = self.list_app_storage(&account_id, &app.app.id, Some(workspace_id))?;
            for entry in &storage.entries {
                let contextual_workspace =
                    entry.key.contains("{workspace_id}").then_some(workspace_id);
                let key = super::app_storage::resolve_key(entry, contextual_workspace)?;
                if entry.kind == contract::StorageKind::Json && entry.agent_context == Some(true) {
                    let value = self.read_app_storage(
                        &account_id,
                        &app.app.id,
                        &entry.id,
                        contextual_workspace,
                    )?;
                    result.push(json!({"app_id":app.app.id,"entry_id":entry.id,"key":key,"value":value.content,"revision":value.revision}));
                } else if entry.kind == contract::StorageKind::Md {
                    let metadata = listed
                        .items
                        .iter()
                        .find(|item| item.entry_id == entry.id && item.key == key)
                        .ok_or_else(|| server_error("저장소 선언 metadata가 없습니다."))?;
                    result.push(json!({"app_id":app.app.id,"entry_id":entry.id,"key":key,"kind":entry.kind,"revision":metadata.revision}));
                }
            }
        }
        Ok(result)
    }
}
