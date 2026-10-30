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
    /// 띄울 작업 id. 생략하면 이 MCP 연결의 작업을 사용합니다.
    workspace_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AppIdArgs {
    /// 조회할 앱 id. `list_apps`에서 확인합니다.
    app_id: String,
    /// 띄울 작업 id. 생략하면 이 MCP 연결의 작업을 사용합니다.
    workspace_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct DeleteAppArgs {
    /// 지울 앱 id.
    app_id: String,
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
pub(super) struct WorkspaceArgs {
    /// 조회할 작업 id. 생략하면 이 MCP 연결의 작업을 사용합니다.
    pub(super) workspace_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct DeleteWorkspaceArgs {
    /// 지울 작업 id. 생략할 수 없습니다.
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
    /// relay 요청에 붙일 헤더 이름과 값. 환경변수 참조는 허용하지 않습니다.
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
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock},
    service::{RequestContext, RoleServer},
    tool, tool_router, ErrorData,
};

fn request_principal(context: &RequestContext<RoleServer>) -> McpPrincipal {
    context
        .extensions
        .get::<axum::http::request::Parts>()
        .and_then(|parts| parts.extensions.get::<McpPrincipal>())
        .cloned()
        .unwrap_or_default()
}

fn effective_workspace_id(explicit: Option<String>, principal: &McpPrincipal) -> Option<String> {
    explicit.or_else(|| principal.workspace_id.clone())
}

#[path = "mcp_app_storage_tools.rs"]
pub(super) mod app_storage_tools;
#[path = "mcp_server_handler.rs"]
mod server_handler;

#[tool_router(router = base_tool_router, vis = "pub(super)")]
impl McpServer {
    #[cfg(test)]
    async fn upload_app(
        &self,
        Parameters(args): Parameters<UploadArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.upload_app_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "upload_app",
        description = "앱 정의를 검사해 레지스트리에 새 버전으로 올립니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다. 에이전트가 앱을 만들거나 고친 뒤 list_apps와 get_app으로 확인하고 사용합니다."
    )]
    async fn tool_upload_app(
        &self,
        Parameters(args): Parameters<UploadArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.upload_app_for_principal(args, request_principal(&context))
            .await
    }

    async fn upload_app_for_principal(
        &self,
        mut args: UploadArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let definition = serde_json::to_string(&args.definition)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
        let missing_connections = match self.state.missing_app_connections_from_json(&definition) {
            Ok(missing) => missing,
            Err(error) => return Ok(json_error(error)),
        };
        match self.state.publish_app_for_device(
            &definition,
            "agent",
            args.open,
            args.workspace_id.clone(),
            principal.device_id.as_deref(),
        ) {
            Ok((row, unchanged, target)) => {
                let sent = if args.open && (principal.device_id.is_none() || target.is_some()) {
                    self.state.open_sent_to(
                        target.as_ref(),
                        args.workspace_id.as_deref(),
                        &row.version.definition.requires,
                    )
                } else {
                    0
                };
                let mut value = json!({"app_id":row.app.id,"name":row.app.name,"version":row.version.version,"unchanged":unchanged,"open_sent_to":sent,"open_target":target.as_ref().map(|target| target.name.clone())});
                if args.open && principal.device_id.is_some() && target.is_none() {
                    value["open_reason"] = json!("origin_device_unavailable");
                    value["note"] = json!("이 MCP 연결의 기기에서 창을 열 수 없습니다");
                }
                if args.open
                    && sent == 0
                    && principal.device_id.is_none()
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
        description = "레지스트리 앱을 지웁니다. 그 앱의 창은 닫힙니다. 기본 앱은 지울 수 없습니다. 같은 id로 다시 올리면 되살아납니다."
    )]
    async fn delete_app(
        &self,
        Parameters(args): Parameters<DeleteAppArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = (|| -> Result<usize, CoreError> {
            if kaleidoscope_contract::builtin::is_builtin(&args.app_id) {
                return Err(CoreError::with_details(
                    ErrorCode::InvalidAppDefinition,
                    vec![
                        "기본 앱은 kaleidoscope 리포의 apps/에서 고치고 쉘 새 판으로 냅니다".into(),
                    ],
                ));
            }
            let account_id = self.state.mcp_account_id()?;
            let windows = {
                let db = self.state.lock_db()?;
                let updated = db
                    .execute(
                        "UPDATE apps SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL",
                        params![args.app_id, timestamp()],
                    )
                    .map_err(db_error)?;
                if updated == 0 {
                    return Err(server_error("앱을 찾을 수 없습니다."));
                }
                let mut statement = db.prepare("SELECT v.id FROM windows v JOIN desktops d ON d.id=v.desktop_id JOIN workspaces w ON w.id=d.workspace_id WHERE v.app_id=?1 AND w.account_id=?2").map_err(db_error)?;
                let ids = statement
                    .query_map(params![args.app_id, account_id], |row| {
                        row.get::<_, String>(0)
                    })
                    .map_err(db_error)?;
                ids.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(db_error)?
            };
            let (_, changed) = self.state.apply_layout_changes(
                None,
                &registry::LayoutChanges {
                    deleted_windows: windows,
                    ..Default::default()
                },
            )?;
            let count = changed.deleted_windows.len();
            if !changed.is_empty() {
                self.state.send_event_for_account(
                    DeviceEvent::LayoutChanged { changes: changed },
                    &account_id,
                );
            }
            self.state.send_event(DeviceEvent::AppDeleted {
                app_id: args.app_id.clone(),
            });
            Ok(count)
        })();
        Ok(match result {
            Ok(closed_windows) => json_result(
                json!({"app_id":args.app_id,"deleted":true,"closed_windows":closed_windows}),
            ),
            Err(error) => json_error(error),
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
        name = "preview_app",
        description = "앱 정의의 식이 무엇을 내는지 디렉터 화면 없이 봅니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다. relay 원천은 서버가 받고, 기기 원천(폴더, 파일, oauth)은 data로 표본을 줍니다. window_id를 주면 그 창의 지금 상태로 계산합니다."
    )]
    async fn tool_preview_app(
        &self,
        Parameters(args): Parameters<super::preview::PreviewArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.preview_app_for_principal(args, request_principal(&context))
            .await
    }

    async fn preview_app_for_principal(
        &self,
        mut args: super::preview::PreviewArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        self.preview_app_result(args).await
    }

    #[cfg(test)]
    async fn open_app(
        &self,
        Parameters(args): Parameters<AppIdArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.open_app_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "open_app",
        description = "현재 버전의 앱을 엽니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다. 이 MCP 연결이 기기에서 왔다면 그 기기에 창을 엽니다."
    )]
    async fn tool_open_app(
        &self,
        Parameters(args): Parameters<AppIdArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.open_app_for_principal(args, request_principal(&context))
            .await
    }

    async fn open_app_for_principal(
        &self,
        mut args: AppIdArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        match self.state.app(&args.app_id, None) {
            Ok(Some(app)) => {
                let workspace_accessible = match args.workspace_id.as_deref() {
                    Some(id) => match self.state.mcp_owns_workspace(id) {
                        Ok(owned) => owned,
                        Err(error) => return Ok(json_error(error)),
                    },
                    None => true,
                };
                let target = match self.state.choose_open_target(
                    args.workspace_id.as_deref(),
                    principal.device_id.as_deref(),
                    &app.version.definition.requires,
                ) {
                    Ok(target) => target,
                    Err(error) => return Ok(json_error(error)),
                };
                if workspace_accessible && (principal.device_id.is_none() || target.is_some()) {
                    let account_id = match self.state.mcp_account_id() {
                        Ok(account_id) => account_id,
                        Err(error) => return Ok(json_error(error)),
                    };
                    self.state.send_event_with_target_for_account(
                        DeviceEvent::AppOpen {
                            app_id: args.app_id.clone(),
                            workspace_id: args.workspace_id.clone(),
                        },
                        target.as_ref().map(|target| target.id.clone()),
                        &account_id,
                    );
                }
                let sent = if principal.device_id.is_some() && target.is_none() {
                    0
                } else {
                    self.state.open_sent_to(
                        target.as_ref(),
                        args.workspace_id.as_deref(),
                        &app.version.definition.requires,
                    )
                };
                let mut value = json!({"open_sent_to":sent,"open_target":target.as_ref().map(|target| target.name.clone())});
                if principal.device_id.is_some() && target.is_none() {
                    value["open_reason"] = json!("origin_device_unavailable");
                    value["note"] = json!("이 MCP 연결의 기기에서 창을 열 수 없습니다");
                }
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
    #[cfg(test)]
    pub(super) async fn get_workspace(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.get_workspace_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "get_workspace",
        description = "작업의 데스크톱과 창, 현재 상태를 읽습니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다."
    )]
    async fn tool_get_workspace(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.get_workspace_for_principal(args, request_principal(&context))
            .await
    }

    async fn get_workspace_for_principal(
        &self,
        args: WorkspaceArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        let Some(workspace_id) = effective_workspace_id(args.workspace_id, &principal) else {
            return Ok(json_error(server_error(
                "작업 id가 필요합니다. list_workspaces에서 현재 작업을 확인하세요.",
            )));
        };
        Ok(match self.state.get_workspace(&workspace_id) {
            Ok(Some(mut value)) => {
                match self.state.storage_app_data(&workspace_id) {
                    Ok(app_data) => value["app_data"] = json!(app_data),
                    Err(error) => return Ok(json_error(error)),
                }
                json_result(value)
            }
            Ok(None) => json_error(server_error(
                "작업을 찾을 수 없습니다. list_workspaces에서 현재 작업을 확인하세요.",
            )),
            Err(error) => json_error(error),
        })
    }
    #[cfg(test)]
    async fn get_shared_view(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        self.get_shared_view_for_principal(args, McpPrincipal::default())
            .await
    }

    #[tool(
        name = "get_shared_view",
        description = "같이 보기로 켠 창에 지금 보이는 글 전체를 읽습니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다."
    )]
    async fn tool_get_shared_view(
        &self,
        Parameters(args): Parameters<WorkspaceArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.get_shared_view_for_principal(args, request_principal(&context))
            .await
    }

    async fn get_shared_view_for_principal(
        &self,
        args: WorkspaceArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        let Some(workspace_id) = effective_workspace_id(args.workspace_id, &principal) else {
            return Ok(json_error(server_error("작업 id가 필요합니다.")));
        };
        Ok(match self.state.shared_views(&workspace_id) {
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
    #[tool(
        description = "작업을 지웁니다. 제공자에 로그인한 기기가 정합화할 때 대화를 보관합니다. 마지막 작업은 지울 수 없습니다. workspace_id가 필요하며 MCP 연결의 작업을 자동 사용하지 않습니다."
    )]
    async fn delete_workspace(
        &self,
        Parameters(args): Parameters<DeleteWorkspaceArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.state.apply_layout_changes(
            None,
            &registry::LayoutChanges {
                deleted_workspaces: vec![args.workspace_id.clone()],
                ..Default::default()
            },
        ) {
            Ok((reply, changed)) if reply.deleted_workspaces.contains(&args.workspace_id) => {
                if !changed.is_empty() {
                    match self.state.mcp_account_id() {
                        Ok(account_id) => self.state.send_event_for_account(
                            DeviceEvent::LayoutChanged { changes: changed },
                            &account_id,
                        ),
                        Err(error) => return Ok(json_error(error)),
                    }
                }
                Ok(json_result(
                    json!({"workspace_id":args.workspace_id,"deleted":true}),
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

impl McpServer {
    fn tool_router() -> ToolRouter<Self> {
        let mut router = Self::base_tool_router();
        router.merge(Self::app_storage_tool_router());
        router
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
