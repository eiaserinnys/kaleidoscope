// 미리 보기의 저장소 문맥은 이번 위임 범위인 이 파일에 둔다.
use super::mcp::{json_error, json_result, McpServer};
use super::*;
use kaleidoscope_contract::{
    data::{Binding, BindingValue, HttpMethod, SourceDecl, SourceFormat, SourceStatus},
    registry::{ConnectionAccept, ConnectionKind, ConnectionRequest},
    validate::parse_app_definition,
    CoreError, ErrorCode, PermissionDecl,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use rmcp::{model::CallToolResult, ErrorData};
use rusqlite::OptionalExtension;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Deserialize, JsonSchema)]
pub(super) struct PreviewArgs {
    /// 미리 볼 레지스트리 앱. definition과 둘 중 하나만 줍니다.
    app_id: Option<String>,
    /// 올리기 전 앱 정의 JSON. app_id와 둘 중 하나만 줍니다.
    definition: Option<Value>,
    /// 계산에 쓸 창 상태. window_id보다 우선합니다.
    state: Option<BTreeMap<String, Value>>,
    /// 최근 배치 보고에서 창 상태를 가져옵니다.
    window_id: Option<String>,
    /// 작업 전용 저장 항목에 사용할 작업. window_id가 있으면 그 창의 작업과 같아야 합니다.
    pub(super) workspace_id: Option<String>,
    /// 기기 원천이나 relay 원천에 대신 넣을 표본 값.
    data: Option<BTreeMap<String, Value>>,
    /// 결과 값 하나를 표시할 최대 글자 수(기본 4000, 최대 20000).
    #[schemars(range(min = 1, max = 20000))]
    max_chars: Option<usize>,
}

impl McpServer {
    pub(super) async fn preview_app_result(
        &self,
        args: PreviewArgs,
    ) -> Result<CallToolResult, ErrorData> {
        let PreviewArgs {
            app_id,
            definition: definition_input,
            state: explicit_state,
            window_id,
            workspace_id,
            data: samples,
            max_chars,
        } = args;
        if app_id
            .as_deref()
            .is_some_and(kaleidoscope_contract::builtin::is_builtin)
            || definition_input
                .as_ref()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .is_some_and(kaleidoscope_contract::builtin::is_builtin)
        {
            return Ok(json_error(CoreError {
                code: ErrorCode::UnsupportedApp,
                message: "기본 앱은 로컬 시험 쉘에서 미리 봅니다".into(),
                details: vec![],
            }));
        }
        let definition = match (app_id, definition_input) {
            (Some(app_id), None) => match self.state.app(&app_id, None) {
                Ok(Some(app)) => app.version.definition,
                Ok(None) => return Ok(json_error(CoreError::new(ErrorCode::NotFound))),
                Err(error) => return Ok(json_error(error)),
            },
            (None, Some(input)) => {
                let definition_json = match serde_json::to_string(&input) {
                    Ok(json) => json,
                    Err(error) => return Ok(json_error(server_error(&error.to_string()))),
                };
                match parse_app_definition(&definition_json) {
                    Ok(definition) => definition,
                    Err(error) => return Ok(json_error(error)),
                }
            }
            _ => {
                return Ok(preview_error(
                    "app_id 또는 definition 가운데 하나만 지정해야 합니다.",
                ))
            }
        };
        let max_chars = max_chars.unwrap_or(4000);
        if !(1..=20_000).contains(&max_chars) {
            return Ok(preview_error("max_chars는 1~20000 사이여야 합니다."));
        }
        let (storage, storage_meta) = match preview_storage(
            &self.state,
            &definition,
            workspace_id.as_deref(),
            window_id.as_deref(),
        ) {
            Ok(result) => result,
            Err(error) => return Ok(json_error(error)),
        };
        let state = match explicit_state {
            Some(state) => state,
            None => match window_id.as_deref() {
                Some(window_id) => match preview_window_state(&self.state, window_id) {
                    Ok(Some(state)) => state,
                    Ok(None) => return Ok(preview_error("보고된 창이 없습니다.")),
                    Err(error) => return Ok(json_error(error)),
                },
                None => definition.state.clone(),
            },
        };

        let samples = samples.unwrap_or_default();
        let compiled = CompiledApp::compile(&definition);
        let missing_connections = match self.state.missing_app_connections(&definition) {
            Ok(connections) => connections,
            Err(error) => return Ok(json_error(error)),
        };
        let mut data = BTreeMap::new();
        let mut statuses = BTreeMap::new();
        let mut source_results = BTreeMap::new();
        let mut notes = Vec::new();

        for name in compiled.source_order() {
            if let Some(sample) = samples.get(name) {
                let bytes = sample.to_string().len();
                data.insert(name.clone(), sample.clone());
                statuses.insert(
                    name.clone(),
                    SourceStatus::Ready {
                        updated_at: timestamp(),
                    },
                );
                source_results.insert(name.clone(), json!({"state":"ready","bytes":bytes}));
                continue;
            }

            let problem = compiled
                .source_dependencies(name)
                .iter()
                .filter(|dep| !data.contains_key(*dep))
                .filter_map(|dep| statuses.get(dep))
                .max_by_key(|status| match status {
                    SourceStatus::LoginRequired { .. } => 3,
                    SourceStatus::Failed { .. } => 2,
                    SourceStatus::Loading { .. } => 1,
                    _ => 0,
                })
                .cloned();
            if let Some(status) = problem {
                source_results.insert(name.clone(), serde_json::to_value(&status).unwrap());
                statuses.insert(name.clone(), status);
                continue;
            }
            match compiled.plan_source_with_data_and_storage(
                name,
                &state,
                &data,
                &storage,
                &storage_meta,
            ) {
                SourcePlan::Idle => {
                    statuses.insert(name.clone(), SourceStatus::Idle {});
                    source_results.insert(name.clone(), json!({"state":"idle"}));
                }
                SourcePlan::Invalid(message) => {
                    statuses.insert(
                        name.clone(),
                        SourceStatus::Failed {
                            message: message.clone(),
                            has_value: false,
                        },
                    );
                    source_results
                        .insert(name.clone(), json!({"state":"failed","message":message}));
                }
                SourcePlan::File { .. } | SourcePlan::Folder { .. } => {
                    statuses.insert(name.clone(), SourceStatus::Idle {});
                    source_results.insert(name.clone(), json!({"state":"idle"}));
                    notes.push(format!(
                        "기기에서만 받는 원천: {name}. data로 표본을 주면 계산합니다"
                    ));
                }
                SourcePlan::Request {
                    permission,
                    path,
                    query,
                } => {
                    if definition.permissions.iter().any(|decl| matches!(decl, PermissionDecl::Profiler { id, .. } if id == &permission)) {
                        statuses.insert(name.clone(), SourceStatus::Idle {});
                        source_results.insert(name.clone(), json!({"state":"idle"}));
                        notes.push(format!("기기에서만 받는 원천: {name}. data로 표본을 주면 계산합니다"));
                        continue;
                    }
                    if let Some(PermissionDecl::Http {
                        base_url, paths, ..
                    }) = definition
                        .permissions
                        .iter()
                        .find(|decl| decl.id() == permission)
                    {
                        let base_url = base_url.clone();
                        let paths = paths.clone();
                        let source_format = match definition.sources.get(name) {
                            Some(SourceDecl::Request { format, .. }) => *format,
                            _ => SourceFormat::Json,
                        };
                        let result = tokio::task::spawn_blocking(move || {
                            kaleidoscope_data::public_http::get(
                                &base_url,
                                &paths,
                                &path,
                                &query,
                                kaleidoscope_contract::data::SOURCE_MAX_BYTES,
                            )
                        })
                        .await;
                        let result = result
                            .map_err(|error| error.to_string())
                            .and_then(|value| value);
                        let value = result.and_then(|response| {
                            if !(200..300).contains(&response.status) {
                                return Err(format!("HTTP {}", response.status));
                            }
                            match source_format {
                                SourceFormat::Json => serde_json::from_slice(&response.bytes)
                                    .map_err(|error| error.to_string()),
                                SourceFormat::Text => String::from_utf8(response.bytes)
                                    .map(Value::String)
                                    .map_err(|error| error.to_string()),
                            }
                        });
                        match value {
                            Ok(value) => {
                                let bytes = value.to_string().len();
                                data.insert(name.clone(), value);
                                statuses.insert(
                                    name.clone(),
                                    SourceStatus::Ready {
                                        updated_at: timestamp(),
                                    },
                                );
                                source_results
                                    .insert(name.clone(), json!({"state":"ready","bytes":bytes}));
                            }
                            Err(message) => {
                                statuses.insert(
                                    name.clone(),
                                    SourceStatus::Failed {
                                        message: message.clone(),
                                        has_value: false,
                                    },
                                );
                                source_results.insert(
                                    name.clone(),
                                    json!({"state":"failed","message":message}),
                                );
                            }
                        }
                        continue;
                    }
                    let Some(PermissionDecl::Connection {
                        connection, access, ..
                    }) = definition
                        .permissions
                        .iter()
                        .find(|decl| decl.id() == permission)
                    else {
                        let message = format!("원천 권한을 찾을 수 없습니다: {permission}");
                        statuses.insert(
                            name.clone(),
                            SourceStatus::Failed {
                                message: message.clone(),
                                has_value: false,
                            },
                        );
                        source_results
                            .insert(name.clone(), json!({"state":"failed","message":message}));
                        continue;
                    };
                    let connection_record = match self.state.connection(connection) {
                        Ok(Some(record)) => record,
                        Ok(None) => {
                            let message = format!("서버에 등록되지 않은 연결: {connection}");
                            statuses.insert(
                                name.clone(),
                                SourceStatus::Failed {
                                    message: message.clone(),
                                    has_value: false,
                                },
                            );
                            source_results
                                .insert(name.clone(), json!({"state":"failed","message":message}));
                            continue;
                        }
                        Err(error) => {
                            statuses.insert(
                                name.clone(),
                                SourceStatus::Failed {
                                    message: error.message.clone(),
                                    has_value: false,
                                },
                            );
                            source_results.insert(
                                name.clone(),
                                json!({"state":"failed","message":error.message}),
                            );
                            continue;
                        }
                    };
                    if connection_record.info.kind == ConnectionKind::Oauth {
                        statuses.insert(name.clone(), SourceStatus::Idle {});
                        source_results.insert(name.clone(), json!({"state":"idle"}));
                        notes.push(format!(
                            "기기에서만 받는 원천: {name}. data로 표본을 주면 계산합니다"
                        ));
                        continue;
                    }
                    let format = match definition.sources.get(name) {
                        Some(SourceDecl::Request { format, .. }) => *format,
                        _ => SourceFormat::Json,
                    };
                    let request = ConnectionRequest {
                        app_id: definition.id.clone(),
                        method: HttpMethod::Get,
                        path,
                        query,
                        body: None,
                        accept: match format {
                            SourceFormat::Json => ConnectionAccept::Json,
                            SourceFormat::Text => ConnectionAccept::Text,
                        },
                    };
                    let response = self
                        .state
                        .relay_preview_request(connection, request, *access)
                        .await;
                    let name = name.clone();
                    match response {
                        Ok((reply, bytes)) if !(200..300).contains(&reply.status) => {
                            let body = reply
                                .text
                                .or_else(|| reply.json.map(|value| value.to_string()))
                                .unwrap_or_default();
                            let excerpt: String = body.chars().take(200).collect();
                            let message = format!("HTTP {}: {excerpt}", reply.status);
                            statuses.insert(
                                name.clone(),
                                SourceStatus::Failed {
                                    message: message.clone(),
                                    has_value: false,
                                },
                            );
                            source_results.insert(
                                name,
                                json!({"state":"failed","message":message,"bytes":bytes}),
                            );
                        }
                        Ok((reply, bytes)) => {
                            let source_value = match format {
                                SourceFormat::Json => match (reply.json, reply.text) {
                                    (Some(value), _) => Some(value),
                                    (None, Some(_)) => None,
                                    (None, None) => Some(Value::Null),
                                },
                                SourceFormat::Text => {
                                    Some(Value::String(reply.text.unwrap_or_default()))
                                }
                            };
                            if let Some(value) = source_value {
                                data.insert(name.clone(), value);
                                statuses.insert(
                                    name.clone(),
                                    SourceStatus::Ready {
                                        updated_at: timestamp(),
                                    },
                                );
                                source_results.insert(name, json!({"state":"ready","bytes":bytes}));
                            } else {
                                let message = "JSON을 읽을 수 없습니다";
                                statuses.insert(
                                    name.clone(),
                                    SourceStatus::Failed {
                                        message: message.into(),
                                        has_value: false,
                                    },
                                );
                                source_results.insert(
                                    name,
                                    json!({"state":"failed","message":message,"bytes":bytes}),
                                );
                            }
                        }
                        Err((status, error)) => {
                            let message = format!("HTTP {}: {}", status.as_u16(), error.message);
                            statuses.insert(
                                name.clone(),
                                SourceStatus::Failed {
                                    message: message.clone(),
                                    has_value: false,
                                },
                            );
                            source_results
                                .insert(name, json!({"state":"failed","message":message}));
                        }
                    }
                }
            }
        }

        for connection in missing_connections {
            notes.push(format!("서버에 없는 연결: {connection}"));
        }

        let data_meta: BTreeMap<_, _> = statuses.iter().map(|(name, status)| {
            let value = match status {
                SourceStatus::Ready { updated_at } => json!({"state":"ready", "updated_at":updated_at,
                    "updated_time":chrono::DateTime::parse_from_rfc3339(updated_at).ok().map(|at| at.with_timezone(&chrono::Local).format("%H:%M").to_string()), "stale":false,"message":null}),
                SourceStatus::Failed { message, .. } => json!({"state":"failed","updated_at":null,"updated_time":null,"stale":false,"message":message}),
                SourceStatus::Loading { .. } => json!({"state":"loading","updated_at":null,"updated_time":null,"stale":false,"message":null}),
                SourceStatus::LoginRequired { .. } => json!({"state":"login_required","updated_at":null,"updated_time":null,"stale":false,"message":null}),
                SourceStatus::Idle {} => json!({"state":"idle","updated_at":null,"updated_time":null,"stale":false,"message":null}),
            };
            (name.clone(), value)
        }).collect();
        let evaluated = compiled.evaluate_with_data_meta(
            &state,
            &data,
            &storage,
            &storage_meta,
            &data_meta,
            &statuses,
            None,
        );
        let mut blocks = Vec::new();
        kaleidoscope_contract::data::walk_blocks(&definition.ui, "/ui", &mut |pointer, block| {
            let block_type = serde_json::to_value(block)
                .ok()
                .and_then(|value| value.get("type").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| "unknown".into());
            blocks.push((pointer.to_owned(), block_type));
        });
        if definition.client.is_some() {
            notes.push(
                "클라이언트 출력은 기본값으로 표시하며 실제 값은 창의 런타임에서 계산합니다".into(),
            );
        }
        let values = kaleidoscope_contract::data::all_ui_bindings(&definition)
            .into_iter()
            .map(|(pointer, binding)| {
                let result =
                    match binding {
                        Binding::Expr(_) => evaluated.get(&pointer).cloned().unwrap_or_else(|| {
                            BindingValue::Failed {
                                message: "계산 결과가 없습니다".into(),
                                retry: Vec::new(),
                            }
                        }),
                        Binding::State(reference) => BindingValue::Ready {
                            value: state.get(&reference.state).cloned().unwrap_or(Value::Null),
                        },
                        Binding::Client(reference) => BindingValue::Ready {
                            value: definition
                                .client
                                .as_ref()
                                .and_then(|client| client.outputs.get(&reference.client))
                                .map(|output| output.default.clone())
                                .unwrap_or(Value::Null),
                        },
                        Binding::Literal(value) => BindingValue::Ready {
                            value: value.clone(),
                        },
                    };
                let block = blocks
                    .iter()
                    .filter(|(block_pointer, _)| {
                        pointer == *block_pointer
                            || pointer.starts_with(&format!("{block_pointer}/"))
                    })
                    .max_by_key(|(block_pointer, _)| block_pointer.len())
                    .map(|(_, block_type)| block_type.as_str())
                    .unwrap_or("unknown");
                let field = pointer
                    .rsplit('/')
                    .next()
                    .unwrap_or_default()
                    .replace("~1", "/")
                    .replace("~0", "~");
                binding_result(pointer, block, &field, result, max_chars)
            })
            .collect::<Vec<_>>();

        Ok(json_result(json!({
            "sources": source_results,
            "source_meta": data_meta,
            "values": values,
            "notes": notes,
        })))
    }
}

fn preview_window_state(
    state: &AppState,
    window_id: &str,
) -> Result<Option<BTreeMap<String, Value>>, CoreError> {
    if let Some(reported) = state.reported_window_state(window_id)? {
        return Ok(Some(reported));
    }
    let account = state.mcp_account_id()?;
    let db = state.lock_db()?;
    let raw: Option<String> = db.query_row(
        "SELECT v.data FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1 AND w.account_id=?2",
        params![window_id, account], |row| row.get(0)
    ).optional().map_err(db_error)?;
    raw.map(|raw| {
        serde_json::from_str::<kaleidoscope_contract::AppWindow>(&raw)
            .map(|window| window.state)
            .map_err(|e| server_error(&e.to_string()))
    })
    .transpose()
}

fn preview_storage(
    state: &AppState,
    definition: &kaleidoscope_contract::AppDefinition,
    workspace: Option<&str>,
    window: Option<&str>,
) -> Result<(BTreeMap<String, Value>, BTreeMap<String, Value>), CoreError> {
    let Some(storage) = &definition.storage else {
        return Ok((BTreeMap::new(), BTreeMap::new()));
    };
    let account = state.mcp_account_id()?;
    let window_workspace = if let Some(window) = window {
        let db = state.lock_db()?;
        let canonical: Option<(String, String)> = db.query_row(
            "SELECT d.workspace_id,v.app_id FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.id=?1 AND w.account_id=?2",
            params![window, account], |row| Ok((row.get(0)?,row.get(1)?))
        ).optional().map_err(db_error)?;
        drop(db);
        let found = if canonical.is_some() {
            canonical
        } else {
            let mut found = None;
            for (_, _, _, layout) in state.layouts(&account)? {
                if let Some(item) = layout.windows.iter().find(|item| item.id == window) {
                    if let Some(desktop) = layout
                        .desktops
                        .iter()
                        .find(|desktop| desktop.id == item.desktop_id)
                    {
                        found = Some((desktop.workspace_id.clone(), item.app_id.clone()));
                        break;
                    }
                }
            }
            found
        };
        let (id, app) = found.ok_or_else(|| CoreError::new(ErrorCode::NotFound))?;
        if app != definition.id {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        Some(id)
    } else {
        None
    };
    if workspace
        .zip(window_workspace.as_deref())
        .is_some_and(|(a, b)| a != b)
    {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    let workspace = workspace.or(window_workspace.as_deref());
    let db = state.lock_db()?;
    if let Some(workspace) = workspace {
        let owns: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1 AND account_id=?2) OR EXISTS(SELECT 1 FROM legacy_workspace_owners o WHERE o.workspace_id=?1 AND o.account_id=?2 AND NOT EXISTS(SELECT 1 FROM workspaces w WHERE w.id=o.workspace_id))", params![workspace, account], |row| row.get(0)).map_err(db_error)?;
        if !owns {
            return Err(CoreError::new(ErrorCode::NotFound));
        }
    }
    let bucket = sha256_hex(format!("{account}\0{}", definition.id).as_bytes());
    let mut values = BTreeMap::new();
    for entry in &storage.entries {
        if entry.key.contains("{workspace_id}") && workspace.is_none() {
            let used = kaleidoscope_contract::data::all_exprs(definition)
                .iter()
                .any(|(_, expr)| {
                    kaleidoscope_contract::data::storage_refs(expr).contains(&entry.id)
                });
            if used {
                return Err(CoreError { code: ErrorCode::InvalidRequest, message: "작업 전용 저장 항목을 미리 보려면 workspace_id 또는 window_id가 필요합니다.".into(), details: vec![entry.id.clone()] });
            }
            continue;
        }
        let key = super::app_storage::resolve_key(entry, workspace)?;
        let item: Option<(String, String)> = db
            .query_row(
                "SELECT kind,content FROM app_storage_items WHERE bucket_id=?1 AND key=?2",
                params![bucket, key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        let value = if let Some((kind, raw)) = item {
            let expected_kind =
                serde_json::to_value(entry.kind).map_err(|e| server_error(&e.to_string()))?;
            if expected_kind.as_str() != Some(&kind) {
                return Err(server_error("저장 항목 kind가 선언과 다릅니다."));
            }
            let value: Value =
                serde_json::from_str(&raw).map_err(|e| server_error(&e.to_string()))?;
            kaleidoscope_contract::app_storage::validate_storage_content(entry, &value)
                .map_err(|e| server_error(&e))?;
            value
        } else {
            entry.default.clone()
        };
        values.insert(entry.id.clone(), value);
    }
    Ok((values, [("bucket_id".into(), Value::String(bucket))].into()))
}

fn preview_error(message: &str) -> CallToolResult {
    json_error(CoreError {
        code: ErrorCode::InvalidRequest,
        message: message.into(),
        details: Vec::new(),
    })
}

fn binding_result(
    pointer: String,
    block: &str,
    field: &str,
    result: BindingValue,
    max_chars: usize,
) -> Value {
    let mut output = json!({"pointer":pointer,"block":block,"field":field,"truncated":false});
    match result {
        BindingValue::Ready { value } => {
            let raw = value.to_string();
            let truncated = raw.chars().count() > max_chars;
            let text = raw.chars().take(max_chars).collect::<String>();
            output["status"] = json!("ready");
            output["value"] = json!(text);
            output["truncated"] = json!(truncated);
        }
        BindingValue::Loading {} => output["status"] = json!("loading"),
        BindingValue::Failed { message, retry } => {
            output["status"] = json!("failed");
            output["message"] = json!(message);
            output["retry"] = json!(retry);
        }
        BindingValue::LoginRequired { permission } => {
            output["status"] = json!("login_required");
            output["message"] = json!(format!("로그인이 필요한 권한: {permission}"));
        }
    }
    output
}

#[cfg(test)]
#[path = "preview_tests.rs"]
mod tests;
