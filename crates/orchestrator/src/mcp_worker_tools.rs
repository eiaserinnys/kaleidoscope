use super::*;
use kaleidoscope_contract::worker::WorkerInvokeRequest;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct AppArgs {
    app_id: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SecretArgs {
    app_id: String,
    secret_id: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SetSecretArgs {
    app_id: String,
    secret_id: String,
    value: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct InvokeArgs {
    app_id: String,
    action: String,
    workspace_id: Option<String>,
    args: Option<Value>,
}

#[tool_router(router = worker_tool_router, vis = "pub(super)")]
impl super::McpServer {
    #[tool(description = "앱 워커에 선언된 시크릿을 저장합니다. 값은 다시 표시하지 않습니다.")]
    async fn set_app_secret(
        &self,
        Parameters(args): Parameters<SetSecretArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(
            match self.state.mcp_account_id().and_then(|account| {
                self.state
                    .set_app_secret(&account, &args.app_id, &args.secret_id, &args.value)
            }) {
                Ok(value) => json_result(value),
                Err(error) => json_error(error),
            },
        )
    }
    #[tool(description = "앱 워커의 시크릿 설정 여부를 조회합니다.")]
    async fn list_app_secrets(
        &self,
        Parameters(args): Parameters<AppArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(
            match self
                .state
                .mcp_account_id()
                .and_then(|account| self.state.list_app_secrets(&account, &args.app_id))
            {
                Ok(value) => json_result(value),
                Err(error) => json_error(error),
            },
        )
    }
    #[tool(description = "앱 워커의 시크릿을 지웁니다.")]
    async fn delete_app_secret(
        &self,
        Parameters(args): Parameters<SecretArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(
            match self.state.mcp_account_id().and_then(|account| {
                self.state
                    .delete_app_secret(&account, &args.app_id, &args.secret_id)
            }) {
                Ok(deleted) => json_result(json!({"deleted":deleted})),
                Err(error) => json_error(error),
            },
        )
    }
    #[tool(description = "앱 워커에 선언된 서버 동작을 실행합니다.")]
    async fn invoke_app_worker(
        &self,
        Parameters(args): Parameters<InvokeArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let principal = request_principal(&context);
        let workspace_id = effective_workspace_id(args.workspace_id, &principal);
        let account = match self.state.mcp_account_id() {
            Ok(account) => account,
            Err(error) => return Ok(json_error(error)),
        };
        Ok(
            match self
                .state
                .invoke_worker(
                    &account,
                    &args.app_id,
                    WorkerInvokeRequest {
                        action: args.action,
                        workspace_id,
                        args: args.args,
                    },
                )
                .await
            {
                Ok(reply) => json_result(serde_json::to_value(reply).unwrap()),
                Err(error) => json_error(error),
            },
        )
    }
    #[tool(description = "앱 워커의 최근 실행 상태를 조회합니다.")]
    async fn get_app_worker_status(
        &self,
        Parameters(args): Parameters<AppArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(
            match self
                .state
                .mcp_account_id()
                .and_then(|account| self.state.app_worker_status(&account, &args.app_id))
            {
                Ok(status) => json_result(serde_json::to_value(status).unwrap()),
                Err(error) => json_error(error),
            },
        )
    }
}
