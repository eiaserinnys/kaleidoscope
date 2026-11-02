use super::*;
use rmcp::{
    handler::server::wrapper::Parameters, model::CallToolResult, tool, tool_router, ErrorData,
};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageArgs {
    /// 조회하거나 수정할 앱 id.
    pub(crate) app_id: String,
    /// 지정하면 이 저장소 모음의 문서 메타데이터를 나열합니다.
    pub(crate) entry_id: Option<String>,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageEntryArgs {
    /// 조회하거나 수정할 앱 id.
    pub(crate) app_id: String,
    /// 앱 정의 storage.entries에 선언된 항목 id.
    pub(crate) entry_id: Option<String>,
    /// 기본 앱은 실제 저장 키를 지정할 수도 있습니다.
    pub(crate) key: Option<String>,
    /// 문서 모음 안의 상대 문서 경로.
    pub(crate) doc: Option<String>,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageWriteArgs {
    /// 수정할 앱 id.
    pub(crate) app_id: String,
    /// 앱 정의 storage.entries에 선언된 항목 id.
    pub(crate) entry_id: Option<String>,
    pub(crate) key: Option<String>,
    pub(crate) doc: Option<String>,
    pub(crate) kind: Option<kaleidoscope_contract::app_storage::StorageKind>,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
    /// json 값 또는 md 원문 문자열.
    pub(crate) content: Value,
    /// 읽기에서 받은 revision. 생략하면 저장값이 없을 때만 새로 만듭니다.
    pub(crate) expected_revision: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageResetArgs {
    /// 기본값으로 되돌릴 앱 id.
    pub(crate) app_id: String,
    /// 앱 정의 storage.entries에 선언된 항목 id.
    pub(crate) entry_id: Option<String>,
    pub(crate) key: Option<String>,
    /// 문서 모음 안의 상대 문서 경로.
    pub(crate) doc: Option<String>,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
    /// 읽기에서 받은 revision. 생략하면 저장값이 없을 때만 reset합니다.
    pub(crate) expected_revision: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageMoveArgs {
    pub(crate) app_id: String,
    pub(crate) entry_id: String,
    pub(crate) from_doc: String,
    pub(crate) to_doc: String,
    pub(crate) expected_revision: String,
    pub(crate) workspace_id: Option<String>,
}

fn builtin_key(
    state: &AppState,
    app_id: &str,
    entry: Option<&str>,
    key: Option<&str>,
    workspace: Option<String>,
    principal: &McpPrincipal,
) -> Option<(String, Option<String>)> {
    let candidate = entry.or(key)?;
    let effective = effective_workspace_id(workspace, principal);
    let (declared, resolved) = state
        .builtin_entry(app_id, candidate, effective.as_deref())
        .ok()?;
    if let Some(key) = key {
        if key != declared.key && key != resolved {
            return None;
        }
    }
    let workspace = if declared.key.contains("{workspace_id}") {
        effective
    } else {
        None
    };
    Some((resolved, workspace))
}

#[tool_router(router = app_storage_tool_router, vis = "pub(super)")]
impl super::McpServer {
    #[cfg(test)]
    pub(crate) async fn list_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.list_app_storage_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "list_app_storage",
        description = "앱의 저장소 선언과 고정 항목을 나열합니다. entry_id를 주면 해당 문서 모음의 본문 없는 문서 목록을 반환합니다."
    )]
    async fn tool_list_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.list_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    async fn list_app_storage_for_principal(
        &self,
        mut args: AppStorageArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        if let Some(entry_id) = args.entry_id.as_deref() {
            let list = match self.state.list_app_storage_collection(
                &account_id,
                &args.app_id,
                entry_id,
                args.workspace_id.as_deref(),
            ) {
                Ok(list) => list,
                Err(error) => return Ok(json_error(error)),
            };
            let definition = if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
                let db = match self.state.lock_db() {
                    Ok(db) => db,
                    Err(error) => return Ok(json_error(error)),
                };
                match super::super::app_storage::current_definition(&db, &args.app_id) {
                    Ok(Some(definition)) => definition,
                    Ok(None) => return Ok(json_error(CoreError::new(ErrorCode::NotFound))),
                    Err(error) => return Ok(json_error(error)),
                }
            } else {
                match self.state.app(&args.app_id, None) {
                    Ok(Some(app)) => app.version.definition,
                    Ok(None) => return Ok(json_error(CoreError::new(ErrorCode::NotFound))),
                    Err(error) => return Ok(json_error(error)),
                }
            };
            return Ok(json_result(json!({
                "storage": definition.storage,
                "entry_id": entry_id,
                "bucket_id": list.bucket_id,
                "items": list.items,
            })));
        }
        if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            return Ok(
                match self.state.list_app_storage(
                    &account_id,
                    &args.app_id,
                    args.workspace_id.as_deref(),
                ) {
                    Ok(items) => {
                        let db = match self.state.lock_db() {
                            Ok(db) => db,
                            Err(error) => return Ok(json_error(error)),
                        };
                        let definition =
                            match super::super::builtin_specs::load_definition(&db, &args.app_id) {
                                Ok(Some(definition)) => definition,
                                Ok(None) => {
                                    return Ok(json_error(CoreError::new(ErrorCode::NotFound)))
                                }
                                Err(error) => return Ok(json_error(error)),
                            };
                        json_result(
                            json!({"storage":definition.storage,"bucket_id":items.bucket_id,"items":items.items}),
                        )
                    }
                    Err(error) => json_error(error),
                },
            );
        }
        match self
            .state
            .list_app_storage(&account_id, &args.app_id, args.workspace_id.as_deref())
        {
            Ok(reply) => match self.state.app(&args.app_id, None) {
                Ok(Some(app)) => Ok(json_result(
                    json!({"storage":app.version.definition.storage,"bucket_id":reply.bucket_id,"items":reply.items}),
                )),
                Ok(None) => Ok(json_error(CoreError::new(ErrorCode::NotFound))),
                Err(error) => Ok(json_error(error)),
            },
            Err(error) => Ok(json_error(error)),
        }
    }

    #[cfg(test)]
    pub(crate) async fn read_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageEntryArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.read_app_storage_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "read_app_storage",
        description = "entry_id로 고정 저장 항목을 읽습니다. 문서 모음은 doc을 함께 지정합니다. 기본 앱은 key로도 지정할 수 있습니다."
    )]
    async fn tool_read_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageEntryArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.read_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    pub(crate) async fn read_app_storage_for_principal(
        &self,
        mut args: AppStorageEntryArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            let Some((key, workspace)) = builtin_key(
                &self.state,
                &args.app_id,
                args.entry_id.as_deref(),
                args.key.as_deref(),
                args.workspace_id,
                &principal,
            ) else {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            };
            let (entry, _) =
                match self
                    .state
                    .builtin_entry(&args.app_id, &key, workspace.as_deref())
                {
                    Ok(value) => value,
                    Err(error) => return Ok(json_error(error)),
                };
            if let Some(doc) = args.doc.as_deref() {
                if !entry.collection
                    || !kaleidoscope_contract::app_storage::valid_collection_doc(doc)
                {
                    return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
                }
                let concrete = format!("{key}/{doc}");
                return Ok(
                    match self.state.read_app_value_with_workspace(
                        &account_id,
                        &args.app_id,
                        &concrete,
                        workspace.as_deref(),
                    ) {
                        Ok(value) if value.exists => json_result(json!({
                            "kind": value.kind,
                            "content": value.content,
                            "revision": value.revision,
                            "exists": true,
                        })),
                        Ok(_) => json_error(CoreError::new(ErrorCode::NotFound)),
                        Err(error) => json_error(error),
                    },
                );
            }
            if entry.collection {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            return Ok(
                match self.state.read_app_storage(
                    &account_id,
                    &args.app_id,
                    &entry.id,
                    workspace.as_deref(),
                ) {
                    Ok(value) => json_result(json!(value)),
                    Err(error) => json_error(error),
                },
            );
        }
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let Some(entry_id) = args.entry_id.as_deref().filter(|_| args.key.is_none()) else {
            return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
        };
        if let Some(doc) = args.doc.as_deref() {
            if !kaleidoscope_contract::app_storage::valid_collection_doc(doc) {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            return Ok(
                match self.state.read_app_storage_document(
                    &account_id,
                    &args.app_id,
                    entry_id,
                    doc,
                    args.workspace_id.as_deref(),
                ) {
                    Ok(value) => json_result(serde_json::to_value(value).unwrap()),
                    Err(error) => json_error(error),
                },
            );
        }
        Ok(
            match self.state.read_app_storage(
                &account_id,
                &args.app_id,
                entry_id,
                args.workspace_id.as_deref(),
            ) {
                Ok(value) => json_result(serde_json::to_value(value).unwrap()),
                Err(error) => json_error(error),
            },
        )
    }

    #[cfg(test)]
    pub(crate) async fn write_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageWriteArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.write_app_storage_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "write_app_storage",
        description = "expected_revision으로 비교해 기록합니다. 문서 모음은 doc으로 문서를 지정하며, 기본 앱은 entry_id 또는 key를 씁니다."
    )]
    async fn tool_write_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageWriteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.write_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    pub(crate) async fn write_app_storage_for_principal(
        &self,
        mut args: AppStorageWriteArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        if !kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        }
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            let Some((key, workspace)) = builtin_key(
                &self.state,
                &args.app_id,
                args.entry_id.as_deref(),
                args.key.as_deref(),
                args.workspace_id,
                &principal,
            ) else {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            };
            let (entry, key) =
                match self
                    .state
                    .builtin_entry(&args.app_id, &key, workspace.as_deref())
                {
                    Ok(value) => value,
                    Err(error) => return Ok(json_error(error)),
                };
            if let Some(doc) = args.doc.as_deref() {
                if !entry.collection
                    || !kaleidoscope_contract::app_storage::valid_collection_doc(doc)
                {
                    return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
                }
                let concrete = format!("{key}/{doc}");
                let kind = args.kind.unwrap_or(entry.kind);
                return Ok(
                    match self.state.write_app_value(
                        &account_id,
                        &args.app_id,
                        &concrete,
                        kind,
                        args.content,
                        args.expected_revision,
                        workspace.as_deref(),
                    ) {
                        Ok(revision) => json_result(json!({"revision":revision})),
                        Err(error) => json_error(error),
                    },
                );
            }
            if entry.collection {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            let kind = match args.kind {
                Some(kind) => kind,
                None => entry.kind,
            };
            return Ok(
                match self.state.write_app_value(
                    &account_id,
                    &args.app_id,
                    &key,
                    kind,
                    args.content,
                    args.expected_revision,
                    workspace.as_deref(),
                ) {
                    Ok(revision) => json_result(json!({"revision":revision})),
                    Err(error) => json_error(error),
                },
            );
        }
        let Some(entry_id) = args
            .entry_id
            .as_deref()
            .filter(|_| args.key.is_none() && args.kind.is_none())
        else {
            return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
        };
        if let Some(doc) = args.doc.as_deref() {
            if !kaleidoscope_contract::app_storage::valid_collection_doc(doc) {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            return Ok(
                match self.state.write_app_storage_document(
                    &account_id,
                    &args.app_id,
                    entry_id,
                    doc,
                    args.workspace_id.as_deref(),
                    args.content,
                    args.expected_revision,
                ) {
                    Ok((reply, account, update)) => {
                        super::super::app_storage_http::send_storage_update(
                            &self.state,
                            &args.app_id,
                            &account,
                            update,
                        );
                        json_result(serde_json::to_value(reply).unwrap())
                    }
                    Err(error) => json_error(error),
                },
            );
        }
        match self.state.write_app_storage(
            &account_id,
            &args.app_id,
            entry_id,
            args.workspace_id.as_deref(),
            args.content,
            args.expected_revision,
        ) {
            Ok((reply, account, update)) => {
                super::super::app_storage_http::send_storage_update(
                    &self.state,
                    &args.app_id,
                    &account,
                    update,
                );
                super::super::worker::spawn_watch(
                    &self.state,
                    &account,
                    &args.app_id,
                    entry_id,
                    args.workspace_id.as_deref(),
                );
                Ok(json_result(serde_json::to_value(reply).unwrap()))
            }
            Err(error) => Ok(json_error(error)),
        }
    }

    #[tool(
        name = "move_app_storage",
        description = "expected_revision으로 비교해 문서 모음 안의 문서 이름을 바꿉니다."
    )]
    async fn tool_move_app_storage(
        &self,
        Parameters(mut args): Parameters<AppStorageMoveArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let principal = request_principal(&context);
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        if !kaleidoscope_contract::app_storage::valid_collection_doc(&args.from_doc)
            || !kaleidoscope_contract::app_storage::valid_collection_doc(&args.to_doc)
        {
            return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
        }
        if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            let (_entry, prefix) = match self.state.builtin_entry(
                &args.app_id,
                &args.entry_id,
                args.workspace_id.as_deref(),
            ) {
                Ok(value) if value.0.collection => value,
                Ok(_) => return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest))),
                Err(error) => return Ok(json_error(error)),
            };
            let request = kaleidoscope_contract::app_storage::AppValueMoveRequest {
                operation: "move".into(),
                from_key: format!("{prefix}/{}", args.from_doc),
                to_key: format!("{prefix}/{}", args.to_doc),
                expected_revision: args.expected_revision,
            };
            return Ok(
                match super::super::app_values::move_collection(
                    &self.state,
                    &account_id,
                    &args.app_id,
                    request,
                    args.workspace_id.as_deref(),
                ) {
                    Ok(reply) => json_result(serde_json::to_value(reply).unwrap()),
                    Err(error) => json_error(error),
                },
            );
        }
        let request = kaleidoscope_contract::app_storage::CollectionMove {
            from: args.from_doc,
            to: args.to_doc,
            expected_revision: args.expected_revision,
        };
        Ok(
            match self.state.move_app_storage_document(
                &account_id,
                &args.app_id,
                &args.entry_id,
                &request,
                args.workspace_id.as_deref(),
            ) {
                Ok((reply, account, update)) => {
                    super::super::app_storage_http::send_storage_update(
                        &self.state,
                        &args.app_id,
                        &account,
                        update,
                    );
                    json_result(serde_json::to_value(reply).unwrap())
                }
                Err(error) => json_error(error),
            },
        )
    }

    #[cfg(test)]
    pub(crate) async fn reset_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageResetArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.reset_app_storage_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "reset_app_storage",
        description = "expected_revision으로 비교해 고정 항목을 기본값으로 되돌리거나, 문서 모음에서 doc 문서를 지웁니다. 기본 앱은 entry_id 또는 key를 씁니다."
    )]
    async fn tool_reset_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageResetArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.reset_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    async fn reset_app_storage_for_principal(
        &self,
        mut args: AppStorageResetArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        if !kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        }
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
            let Some((key, workspace)) = builtin_key(
                &self.state,
                &args.app_id,
                args.entry_id.as_deref(),
                args.key.as_deref(),
                args.workspace_id,
                &principal,
            ) else {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            };
            let (entry, key) =
                match self
                    .state
                    .builtin_entry(&args.app_id, &key, workspace.as_deref())
                {
                    Ok(value) => value,
                    Err(error) => return Ok(json_error(error)),
                };
            if let Some(doc) = args.doc.as_deref() {
                if !entry.collection
                    || !kaleidoscope_contract::app_storage::valid_collection_doc(doc)
                    || args.expected_revision.is_none()
                {
                    return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
                }
                let concrete = format!("{key}/{doc}");
                return Ok(
                    match self.state.reset_app_value_with_workspace(
                        &account_id,
                        &args.app_id,
                        &concrete,
                        args.expected_revision,
                        workspace.as_deref(),
                    ) {
                        Ok(()) => json_result(json!({"revision":null})),
                        Err(error) => json_error(error),
                    },
                );
            }
            if entry.collection {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            return Ok(
                match self.state.reset_app_value_with_workspace(
                    &account_id,
                    &args.app_id,
                    &key,
                    args.expected_revision,
                    workspace.as_deref(),
                ) {
                    Ok(()) => json_result(json!({"revision":null})),
                    Err(error) => json_error(error),
                },
            );
        }
        let Some(entry_id) = args.entry_id.as_deref().filter(|_| args.key.is_none()) else {
            return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
        };
        if let Some(doc) = args.doc.as_deref() {
            if !kaleidoscope_contract::app_storage::valid_collection_doc(doc)
                || args.expected_revision.is_none()
            {
                return Ok(json_error(CoreError::new(ErrorCode::InvalidRequest)));
            }
            return Ok(
                match self.state.reset_app_storage_document(
                    &account_id,
                    &args.app_id,
                    entry_id,
                    doc,
                    args.workspace_id.as_deref(),
                    args.expected_revision,
                ) {
                    Ok((reply, account, update)) => {
                        super::super::app_storage_http::send_storage_update(
                            &self.state,
                            &args.app_id,
                            &account,
                            update,
                        );
                        json_result(serde_json::to_value(reply).unwrap())
                    }
                    Err(error) => json_error(error),
                },
            );
        }
        match self.state.reset_app_storage(
            &account_id,
            &args.app_id,
            entry_id,
            args.workspace_id.as_deref(),
            args.expected_revision,
        ) {
            Ok((reply, account, update)) => {
                super::super::app_storage_http::send_storage_update(
                    &self.state,
                    &args.app_id,
                    &account,
                    update,
                );
                super::super::worker::spawn_watch(
                    &self.state,
                    &account,
                    &args.app_id,
                    entry_id,
                    args.workspace_id.as_deref(),
                );
                Ok(json_result(serde_json::to_value(reply).unwrap()))
            }
            Err(error) => Ok(json_error(error)),
        }
    }
}

#[cfg(test)]
mod builtin_key_tests {
    use super::*;

    #[test]
    fn resolves_workspace_templates_without_scoping_global_keys() {
        let state = AppState::in_memory("test");
        let principal = McpPrincipal {
            workspace_id: Some("work".into()),
            ..Default::default()
        };
        assert_eq!(
            builtin_key(
                &state,
                "html-report",
                Some("reports"),
                None,
                None,
                &principal
            ),
            Some(("reports".into(), None))
        );
        assert_eq!(
            builtin_key(&state, "agent", Some("agents"), None, None, &principal),
            Some(("settings/agents".into(), None))
        );
        assert_eq!(
            builtin_key(
                &state,
                "agent",
                Some("agents"),
                Some("other"),
                None,
                &principal
            ),
            None
        );
    }
}
