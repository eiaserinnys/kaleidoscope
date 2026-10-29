use super::mcp::{json_error, json_result, McpServer};
use super::*;
use futures::future::join_all;
use kaleidoscope_contract::{
    data::{Binding, BindingValue, HttpMethod, SourceDecl, SourceFormat, SourceStatus},
    registry::{ConnectionAccept, ConnectionKind, ConnectionRequest},
    validate::parse_app_definition,
    CoreError, ErrorCode, FileAccess, PermissionDecl,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use rmcp::{model::CallToolResult, ErrorData};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

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
            data: samples,
            max_chars,
        } = args;
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
        let state = match explicit_state {
            Some(state) => state,
            None => match window_id {
                Some(window_id) => match self.state.reported_window_state(&window_id) {
                    Ok(Some(state)) => state,
                    Ok(None) => return Ok(preview_error("보고된 창이 없습니다.")),
                    Err(error) => return Ok(json_error(error)),
                },
                None => definition.state.clone(),
            },
        };

        let samples = samples.unwrap_or_default();
        let compiled = CompiledApp::compile(&definition);
        let mut data = BTreeMap::new();
        let mut statuses = BTreeMap::new();
        let mut source_results = BTreeMap::new();
        let mut notes = Vec::new();
        let mut missing_connections = BTreeSet::new();
        let mut requests: Vec<(String, String, FileAccess, SourceFormat, ConnectionRequest)> =
            Vec::new();

        for name in definition.sources.keys() {
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

            match compiled.plan_source(name, &state) {
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
                            missing_connections.insert(connection.clone());
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
                    requests.push((name.clone(), connection.clone(), *access, format, request));
                }
            }
        }

        let app_state = self.state.clone();
        let responses = join_all(requests.into_iter().map(
            |(name, connection, access, format, request)| {
                let app_state = app_state.clone();
                async move {
                    let response = app_state
                        .relay_preview_request(&connection, request, access)
                        .await;
                    (name, format, response)
                }
            },
        ))
        .await;
        for (name, format, response) in responses {
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
                        SourceFormat::Text => Some(Value::String(reply.text.unwrap_or_default())),
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
                    source_results.insert(name, json!({"state":"failed","message":message}));
                }
            }
        }
        for connection in missing_connections {
            notes.push(format!("서버에 없는 연결: {connection}"));
        }

        let evaluated = compiled.evaluate(&state, &data, &statuses);
        let mut blocks = Vec::new();
        kaleidoscope_contract::data::walk_blocks(&definition.ui, "/ui", &mut |pointer, block| {
            let block_type = serde_json::to_value(block)
                .ok()
                .and_then(|value| value.get("type").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| "unknown".into());
            blocks.push((pointer.to_owned(), block_type));
        });
        let values = kaleidoscope_contract::data::ui_bindings(&definition)
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
            "values": values,
            "notes": notes,
        })))
    }
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
