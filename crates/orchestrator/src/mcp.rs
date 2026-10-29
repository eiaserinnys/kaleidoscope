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

#[derive(Clone)]
pub(super) struct McpServer {
    state: AppState,
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
        match self
            .state
            .publish_app(&definition, "agent", args.open, args.workspace_id)
        {
            Ok((row, unchanged)) => {
                let sent = if args.open {
                    self.state.connected_count()
                } else {
                    0
                };
                let mut value = json!({"app_id":row.app.id,"name":row.app.name,"version":row.version.version,"unchanged":unchanged,"open_sent_to":sent});
                if args.open && sent == 0 {
                    value["note"] = json!("연결된 쉘이 없어 창은 열리지 않았습니다");
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
        description = "현재 버전의 앱을 연결된 쉘에서 엽니다. 앱을 이미 올렸고 창만 다시 띄울 때 사용합니다."
    )]
    async fn open_app(
        &self,
        Parameters(args): Parameters<AppIdArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.state.app(&args.app_id, None) {
            Ok(Some(_)) => {
                let _ = self.state.0.events.send(DeviceEvent::AppOpen {
                    app_id: args.app_id,
                    workspace_id: args.workspace_id,
                });
                Ok(json_result(
                    json!({"open_sent_to":self.state.connected_count()}),
                ))
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
                "그 작업의 배치 보고가 없습니다. 쉘이 서버에 연결돼 있는지 확인하세요.",
            )),
            Err(error) => json_error(error),
        })
    }
    #[tool(description = "기기가 보고한 작업과 창 개수를 나열합니다.")]
    async fn list_workspaces(&self) -> Result<CallToolResult, ErrorData> {
        Ok(match self.state.list_workspaces() {
            Ok(value) => json_result(value),
            Err(error) => json_error(error),
        })
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
}

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let instructions=format!("kaleidoscope는 디렉터의 데스크톱 쉘입니다. 앱 정의 JSON을 올리면 연결된 디렉터 PC의 쉘에 창으로 뜹니다.\n앱 정의는 쉘의 블록과 모듈만 씁니다. 형식은 upload_app 입력 스키마가 정본입니다.\n파일 경로는 기기마다 디렉터가 고른 폴더 기준 상대 경로이며 폴더 밖은 거부됩니다.\n고칠 때는 list_apps → get_app → 수정 후 upload_app 순서로 합니다. 같은 id면 새 버전이 되고 열린 창은 새 버전으로 바뀝니다.\n디렉터가 쉘의 연결 코드를 주면 approve_device로 승인합니다.\n작업 PAS는 지시에 적힌 workspace_id를 upload_app과 open_app에 넣어 그 작업에 띄운다.\nget_workspace로 작업의 데스크톱과 창(앱, 버전, 연 파일)을 읽는다.\nmd-editor 예제: {}\nmd-viewer 예제: {}", include_str!("../../../examples/md-editor.json"),include_str!("../../../examples/md-viewer.json"));
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("kaleidoscope", "0.1.0"))
            .with_instructions(instructions)
    }
}

fn json_result(value: Value) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(value.to_string())])
}
fn json_error(error: CoreError) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(
        serde_json::to_string(&error).unwrap(),
    )])
}
