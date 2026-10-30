use super::*;

fn app_schema(generator: &mut SchemaGenerator) -> Schema {
    generator.subschema_for::<AppDefinition>()
}
fn default_open() -> bool {
    true
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct UploadArgs {
    /// 쉘에서 사용할 앱 정의. 지원하는 블록과 모듈만 사용할 수 있습니다.
    #[schemars(schema_with = "app_schema")]
    definition: Value,
    /// 올린 직후 연결된 쉘에 창을 띄워 달라고 요청합니다.
    #[serde(default = "default_open")]
    #[schemars(default = "default_open")]
    open: bool,
    /// 띄울 작업(워크스페이스) id. 작업 PAS라면 지시에 적힌 값을 넣는다. 없으면 디렉터가 지금 보는 데스크톱에 띄운다.
    workspace_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AppIdArgs {
    /// 조회할 앱 id. `list_apps`에서 확인합니다.
    app_id: String,
    /// 띄울 작업(워크스페이스) id. 작업 PAS라면 지시에 적힌 값을 넣는다. 없으면 디렉터가 지금 보는 데스크톱에 띄운다.
    workspace_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct VersionArgs {
    /// 조회할 앱 id.
    app_id: String,
    /// 생략하면 현재 버전을 조회합니다.
    version: Option<u32>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ApproveArgs {
    /// 쉘에 보이는 XXXX-XXXX 연결 코드.
    code: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct WorkspaceArgs {
    /// 조회할 작업의 워크스페이스 id.
    workspace_id: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct RevokeArgs {
    /// `list_devices`에서 확인한 기기 id.
    device_id: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ConnectionKindArg {
    Relay,
    Oauth,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SetConnectionArgs {
    /// 연결 이름. 소문자, 숫자, 하이픈 1~64자.
    name: String,
    /// relay는 서버 중계, oauth는 기기 직접 로그인입니다.
    kind: ConnectionKindArg,
    /// https 주소. 로컬 시험은 http://127.0.0.1 또는 http://localhost만 허용합니다.
    base_url: String,
    /// 연결을 구분할 설명.
    description: Option<String>,
    /// GET 이외의 요청을 허용합니다. 기본값은 false.
    writable: Option<bool>,
    /// 요청을 보낼 수 있는 경로 접두어 목록.
    paths: Option<Vec<String>>,
    /// relay 요청에 붙일 헤더 이름과 값. 값의 ${env:NAME}은 서버 환경변수로 치환합니다.
    headers: Option<std::collections::BTreeMap<String, String>>,
    /// oauth 발급자 주소.
    issuer: Option<String>,
    /// oauth scope 문자열.
    scopes: Option<String>,
    /// oauth RFC 8707 resource.
    resource: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct DeleteConnectionArgs {
    /// 지울 연결 이름.
    name: String,
}

#[derive(Clone)]
pub(super) struct McpServer {
    pub(super) state: AppState,
}
impl McpServer {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }
}

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};

#[tool_router]
impl McpServer {
    #[tool(
        description = "앱 정의를 검사해 레지스트리에 새 버전으로 올립니다. 에이전트가 앱을 만들거나 고친 뒤 사용합니다."
    )]
    async fn upload_app(
        &self,
        Parameters(args): Parameters<UploadArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let definition = serde_json::to_string(&args.definition)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let missing_connections = match self.state.missing_app_connections_from_json(&definition) {
            Ok(missing) => missing,
            Err(error) => return Ok(json_error(error)),
        };
        match self.state.publish_app_with_target(
            &definition,
            "agent",
            args.open,
            args.workspace_id.clone(),
        ) {
            Ok((row, unchanged, target)) => {
                let sent = if args.open {
                    self.state.open_sent_to(
                        target.as_ref(),
                        args.workspace_id.as_deref(),
                        &row.version.definition.requires,
                    )
                } else {
                    0
                };
                let mut value = json!({"app_id":row.app.id,"name":row.app.name,"version":row.version.version,"unchanged":unchanged,"open_sent_to":sent,"open_target":target.as_ref().map(|target| target.name.clone())});
                if args.open
                    && sent == 0
                    && self.state.connected_count_for(args.workspace_id.as_deref()) == 0
                {
                    value["note"] = if args.workspace_id.is_some() {
                        json!("그 작업을 가진 쉘이 연결돼 있지 않아 창은 열리지 않았습니다")
                    } else {
                        json!("연결된 쉘이 없어 창은 열리지 않았습니다")
                    };
                }
                add_unsupported_device_note(
                    &mut value,
                    self.state
                        .unsupported_connected_devices(&row.version.definition.requires),
                );
                if !missing_connections.is_empty() {
                    value["warnings"] = json!([format!(
                        "서버에 없는 연결: {}. set_connection으로 등록하세요",
                        missing_connections.join(", ")
                    )]);
                }
                Ok(json_result(value))
            }
            Err(error) => Ok(json_error(error)),
        }
    }
    #[tool(
        description = "레지스트리에 있는 앱의 현재 버전과 이름을 나열합니다. 수정할 앱을 찾을 때 사용합니다."
    )]
    async fn list_apps(&self) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.list_apps() {
            Ok(v) => json_result(serde_json::to_value(v).unwrap()),
            Err(e) => json_error(e),
        })
    }
    #[tool(
        description = "앱 정의를 읽습니다. 수정 전에 현재 버전을 확인하거나 특정 버전을 살필 때 사용합니다."
    )]
    async fn get_app(
        &self,
        Parameters(args): Parameters<VersionArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.app(&args.app_id, args.version) {
            Ok(Some(row)) => json_result(
                json!({"app_id":row.app.id,"version":row.version.version,"definition":row.version.definition}),
            ),
            Ok(None) => json_error(server_error("앱 또는 버전을 찾을 수 없습니다.")),
            Err(e) => json_error(e),
        })
    }
    #[tool(
        description = "앱 정의의 식이 무엇을 내는지 디렉터 화면 없이 봅니다. relay 원천은 서버가 받고, 기기 원천(폴더, 파일, oauth)은 data로 표본을 줍니다. window_id를 주면 그 창의 지금 상태로 계산합니다."
    )]
    async fn preview_app(
        &self,
        Parameters(args): Parameters<super::preview::PreviewArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.preview_app_result(args).await
    }
    #[tool(
        description = "현재 버전의 앱을 연결된 쉘에서 엽니다. 앱을 이미 올렸고 창만 다시 띄울 때 사용합니다."
    )]
    async fn open_app(
        &self,
        Parameters(args): Parameters<AppIdArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.state.app(&args.app_id, None) {
            Ok(Some(app)) => {
                let target = match self.state.choose_open_target(args.workspace_id.as_deref()) {
                    Ok(target) => target,
                    Err(error) => return Ok(json_error(error)),
                };
                self.state.send_event_with_target(
                    DeviceEvent::AppOpen {
                        app_id: args.app_id.clone(),
                        workspace_id: args.workspace_id.clone(),
                    },
                    target.as_ref().map(|target| target.id.clone()),
                );
                let sent = self.state.open_sent_to(
                    target.as_ref(),
                    args.workspace_id.as_deref(),
                    &app.version.definition.requires,
                );
                let mut value = json!({"open_sent_to":sent,"open_target":target.as_ref().map(|target| target.name.clone())});
                if sent == 0
                    && args.workspace_id.is_some()
                    && self.state.connected_count_for(args.workspace_id.as_deref()) == 0
                {
                    value["note"] =
                        json!("그 작업을 가진 쉘이 연결돼 있지 않아 창은 열리지 않았습니다");
                }
                add_unsupported_device_note(
                    &mut value,
                    self.state
                        .unsupported_connected_devices(&app.version.definition.requires),
                );
                Ok(json_result(value))
            }
            Ok(None) => Ok(json_error(server_error("앱을 찾을 수 없습니다."))),
            Err(e) => Ok(json_error(e)),
        }
    }
    #[tool(description = "작업의 데스크톱과 창, 현재 상태를 읽습니다.")]
    async fn get_workspace(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.get_workspace(&args.workspace_id) {
            Ok(Some(value)) => json_result(value),
            Ok(None) => json_error(server_error(
                "작업을 찾을 수 없습니다. list_workspaces에서 현재 작업을 확인하세요.",
            )),
            Err(error) => json_error(error),
        })
    }
    #[tool(
        description = "디렉터가 kaleidoscope 쉘에서 같이 보기로 켠 창에 지금 보이는 글 전체를 읽는다. 디렉터의 말 뒤에 붙어 오는 같이 보기 블록은 달라진 부분뿐이라, 지금 모습 전체가 필요할 때 쓴다."
    )]
    async fn get_shared_view(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.shared_views(&args.workspace_id) {
            Ok(views) => {
                let mut result = json!({"views": views});
                if result["views"].as_array().is_some_and(Vec::is_empty) {
                    result["note"] = json!("같이 보기로 켠 창이 없습니다");
                }
                json_result(result)
            }
            Err(error) => json_error(error),
        })
    }
    #[tool(description = "현재 작업과 창 개수를 나열합니다.")]
    async fn list_workspaces(&self) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.list_workspaces() {
            Ok(value) => json_result(value),
            Err(error) => json_error(error),
        })
    }
    #[tool(description = "작업을 지우고 그 작업의 PAS를 내립니다. 마지막 작업은 지울 수 없습니다.")]
    async fn delete_workspace(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let agent_retiring = self.state.0.soulstream.is_some()
            && self
                .state
                .agent_row(&args.workspace_id)
                .ok()
                .flatten()
                .is_some();
        match self.state.apply_layout_changes(
            None,
            &registry::LayoutChanges {
                deleted_workspaces: vec![args.workspace_id.clone()],
                ..Default::default()
            },
        ) {
            Ok((reply, changed)) if reply.deleted_workspaces.contains(&args.workspace_id) => {
                if !changed.is_empty() {
                    self.state
                        .send_event(DeviceEvent::LayoutChanged { changes: changed });
                }
                Ok(json_result(
                    json!({"workspace_id":args.workspace_id,"deleted":true,"agent_retiring":agent_retiring}),
                ))
            }
            Ok((reply, _))
                if reply
                    .workspaces
                    .iter()
                    .any(|workspace| workspace.id == args.workspace_id) =>
            {
                Ok(json_error(server_error("마지막 작업은 지울 수 없습니다.")))
            }
            Ok(_) => Ok(json_error(server_error("작업을 찾을 수 없습니다."))),
            Err(error) => Ok(json_error(error)),
        }
    }
    #[tool(
        description = "쉘에 표시된 연결 코드를 승인해 해당 기기에 토큰을 발급합니다. 디렉터가 코드를 전달한 뒤 사용합니다."
    )]
    async fn approve_device(
        &self,
        Parameters(args): Parameters<ApproveArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.approve_pairing(&args.code).await {
            Ok((device_id, device_name)) => {
                json_result(json!({"device_id":device_id,"device_name":device_name}))
            }
            Err(e) => json_error(e),
        })
    }
    #[tool(
        description = "연결된 쉘 기기와 연결 상태를 나열합니다. 기기 id는 연결을 끊을 때 씁니다."
    )]
    async fn list_devices(&self) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.device_summaries() {
            Ok(v) => json_result(serde_json::to_value(v).unwrap()),
            Err(e) => json_error(e),
        })
    }
    #[tool(
        description = "기기의 연결 토큰을 폐기해 해당 쉘의 이벤트 스트림을 끊습니다. 분실하거나 더 이상 쓰지 않을 때 사용합니다."
    )]
    async fn revoke_device(
        &self,
        Parameters(args): Parameters<RevokeArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.revoke_device(&args.device_id) {
            Ok(true) => json_result(json!({"revoked":true})),
            Ok(false) => json_error(server_error("기기를 찾을 수 없습니다.")),
            Err(e) => json_error(e),
        })
    }

    #[tool(
        description = "이름 붙인 연결을 등록하거나 기존 설정을 바꿉니다. 헤더 값은 조회할 수 없습니다."
    )]
    async fn set_connection(
        &self,
        Parameters(args): Parameters<SetConnectionArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let kind = match args.kind {
            ConnectionKindArg::Relay => kaleidoscope_contract::registry::ConnectionKind::Relay,
            ConnectionKindArg::Oauth => kaleidoscope_contract::registry::ConnectionKind::Oauth,
        };
        match self
            .state
            .set_connection(super::connections::ConnectionRegistration {
                name: args.name,
                kind,
                base_url: args.base_url,
                description: args.description,
                writable: args.writable,
                paths: args.paths,
                headers: args.headers,
                issuer: args.issuer,
                scopes: args.scopes,
                resource: args.resource,
            }) {
            Ok((info, headers)) => {
                let mut value = serde_json::to_value(info).unwrap_or_else(|_| json!({}));
                value["header_names"] = json!(headers);
                Ok(json_result(value))
            }
            Err(error) => Ok(json_error(error)),
        }
    }

    #[tool(
        description = "등록된 연결 목록을 읽습니다. relay 헤더는 이름만 보이고 값은 반환하지 않습니다."
    )]
    async fn list_connections(&self) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.list_connections() {
            Ok(items) => {
                let values: Vec<_> = items
                    .into_iter()
                    .map(|(info, names, description)| {
                        let mut value = serde_json::to_value(info).unwrap_or_else(|_| json!({}));
                        value["header_names"] = json!(names);
                        value["description"] = json!(description);
                        value
                    })
                    .collect();
                json_result(json!(values))
            }
            Err(error) => json_error(error),
        })
    }

    #[tool(description = "이름 붙인 연결을 삭제합니다.")]
    async fn delete_connection(
        &self,
        Parameters(args): Parameters<DeleteConnectionArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.delete_connection(&args.name) {
            Ok(true) => json_result(json!({"deleted":true})),
            Ok(false) => json_error(server_error("연결을 찾을 수 없습니다.")),
            Err(error) => json_error(error),
        })
    }
}

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let instructions = format!(
            "kaleidoscope는 디렉터의 데스크톱 쉘입니다. 앱 정의 JSON을 올리면 연결된 디렉터 PC의 쉘에 창으로 뜹니다.\n앱 정의는 쉘의 블록과 모듈만 씁니다. 형식은 upload_app 입력 스키마가 정본입니다.\n파일 경로는 기기마다 디렉터가 고른 폴더 기준 상대 경로이며 폴더 밖은 거부됩니다.\n파일을 여는 앱은 opens(확장자, 폴더를 이어 받을 권한, 경로를 쓸 상태 키)를 선언합니다. 탐색기에서 그 확장자 파일을 열면 그 앱 창이 뜹니다.\n고칠 때는 list_apps → get_app → 수정 후 upload_app 순서로 합니다. 같은 id면 새 버전이 되고 열린 창은 새 버전으로 바뀝니다.\n디렉터가 쉘의 연결 코드를 주면 approve_device로 승인합니다.\n작업 PAS는 지시에 적힌 workspace_id를 upload_app과 open_app에 넣어 그 작업에 띄운다.\nget_workspace로 작업의 데스크톱과 창(앱, 버전, 연 파일)을 읽는다.\nmd-editor 예제: {}\nmd-viewer 예제: {}\nweb-browser 예제: {}\nexplorer 예제: {}",
            include_str!("../../../examples/md-editor.json"),
            include_str!("../../../examples/md-viewer.json"),
            include_str!("../../../examples/web-browser.json"),
            include_str!("../../../examples/explorer.json")
        );
        let instructions = format!(
            "{}\ndelete_workspace로 작업을 지우면 그 작업의 PAS도 내려간다. 시험으로 만든 작업은 시험 끝에 지운다.",
            instructions
        );
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("kaleidoscope", "0.1.0"))
            .with_instructions(instructions)
    }
}

pub(super) fn json_result(value: Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(value.to_string())])
}
pub(super) fn json_error(error: CoreError) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(
        serde_json::to_string(&error).unwrap(),
    )])
}

fn add_unsupported_device_note(value: &mut Value, mut devices: Vec<String>) {
    if devices.is_empty() {
        return;
    }
    devices.sort();
    let line = format!(
        "이 앱을 그릴 수 없는 옛 쉘이라 받지 못한 기기: {} (쉘을 새로 깔아야 합니다)",
        devices.join(", ")
    );
    let note = value["note"].as_str().unwrap_or_default();
    value["note"] = json!(if note.is_empty() {
        line
    } else {
        format!("{note}\n{line}")
    });
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "mcp_workspace_tests.rs"]
mod workspace_tests;
