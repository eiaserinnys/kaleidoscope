use super::*;
use rmcp::{
    handler::server::wrapper::Parameters, model::CallToolResult, tool, tool_router, ErrorData,
};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageArgs {
    /// 조회하거나 수정할 앱 id.
    pub(crate) app_id: String,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageEntryArgs {
    /// 조회하거나 수정할 앱 id.
    pub(crate) app_id: String,
    /// 앱 정의 storage.entries에 선언된 항목 id.
    pub(crate) entry_id: String,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(crate) struct AppStorageWriteArgs {
    /// 수정할 앱 id.
    pub(crate) app_id: String,
    /// 앱 정의 storage.entries에 선언된 항목 id.
    pub(crate) entry_id: String,
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
    pub(crate) entry_id: String,
    /// 작업 전용 항목일 때 작업 id. 일반 설정 항목에는 생략합니다.
    pub(crate) workspace_id: Option<String>,
    /// 읽기에서 받은 revision. 생략하면 저장값이 없을 때만 reset합니다.
    pub(crate) expected_revision: Option<String>,
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
        description = "앱이 선언한 계정별 저장 항목과 현재 revision을 나열합니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다."
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
        description = "앱이 선언한 저장 항목의 값과 revision을 읽습니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다. 저장값이 없으면 선언 기본값을 돌려줍니다."
    )]
    async fn tool_read_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageEntryArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.read_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    async fn read_app_storage_for_principal(
        &self,
        mut args: AppStorageEntryArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        Ok(
            match self.state.read_app_storage(
                &account_id,
                &args.app_id,
                &args.entry_id,
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
        description = "선언된 앱 저장 항목을 expected_revision compare-and-set으로 기록합니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다."
    )]
    async fn tool_write_app_storage(
        &self,
        Parameters(args): Parameters<AppStorageWriteArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.write_app_storage_for_principal(args, request_principal(&context))
            .await
    }

    async fn write_app_storage_for_principal(
        &self,
        mut args: AppStorageWriteArgs,
        principal: McpPrincipal,
    ) -> Result<CallToolResult, ErrorData> {
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        match self.state.write_app_storage(
            &account_id,
            &args.app_id,
            &args.entry_id,
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
                Ok(json_result(serde_json::to_value(reply).unwrap()))
            }
            Err(error) => Ok(json_error(error)),
        }
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
        description = "저장 항목의 override를 expected_revision으로 비교한 뒤 지우고 앱 선언 기본값으로 되돌립니다. workspace_id를 빼면 이 MCP 연결의 작업을 사용합니다."
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
        args.workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account_id = match self.state.mcp_account_id() {
            Ok(value) => value,
            Err(error) => return Ok(json_error(error)),
        };
        match self.state.reset_app_storage(
            &account_id,
            &args.app_id,
            &args.entry_id,
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
                Ok(json_result(serde_json::to_value(reply).unwrap()))
            }
            Err(error) => Ok(json_error(error)),
        }
    }
}
