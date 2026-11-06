use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::app_comments::{
    AppCommentAuthor, AppCommentReplyRequest, AppCommentResolveRequest,
};

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ListCommentsArgs {
    /// 생략하면 계정의 앱별 커멘트 메타를 조회합니다.
    app_id: Option<String>,
    resolved: Option<bool>,
    cursor: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct GetCommentArgs {
    comment_id: String,
    image: Option<bool>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReplyCommentArgs {
    comment_id: String,
    text: String,
    reply_id: Option<String>,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ResolveCommentArgs {
    comment_id: String,
    resolved: bool,
    fixed_app_version: Option<u32>,
}

fn account(state: &AppState, principal: McpPrincipal) -> Result<String, CoreError> {
    match principal.device_id {
        Some(id) => state.device_account_id(&id),
        None => state.mcp_account_id(),
    }
}
#[tool_router(router = app_comments_tool_router, vis = "pub(super)")]
impl McpServer {
    #[tool(
        name = "list_app_comments",
        description = "사용자가 제출한 저장 커멘트의 앱별 메타 또는 앱별 목록을 읽습니다. 기본 앱은 리포 apps/ 또는 쉘을 고쳐 릴리스하며 get_app과 upload_app으로 정의를 고칠 수 없습니다. 개인 앱은 get_app으로 확인해 upload_app으로 올립니다. 스토어 앱은 스토어 원본을 고쳐 새 판을 설치하세요. 고친 뒤 reply_app_comment로 무엇을 고쳤는지 답하고 resolve_app_comment로 닫으세요. 고치지 못하면 답글로 까닭을 알리세요."
    )]
    async fn list_app_comments(
        &self,
        Parameters(args): Parameters<ListCommentsArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result =
            account(&self.state, request_principal(&context)).and_then(|account| {
                match args.app_id {
                    Some(app) => self
                        .state
                        .list_comments(&account, &app, args.resolved, args.cursor.as_deref())
                        .map(|value| json!(value)),
                    None => self
                        .state
                        .comment_metas(&account)
                        .map(|apps| json!({"apps":apps})),
                }
            });
        Ok(match result {
            Ok(value) => json_result(value),
            Err(error) => json_error(error),
        })
    }
    #[tool(
        name = "get_app_comment",
        description = "사용자가 제출한 커멘트와 답글을 읽습니다. image=true는 현재 화면이 아닌 저장된 PNG를 함께 돌려줍니다. 저장 위치의 재부착은 보장되지 않습니다. 기본 앱은 리포 apps/ 또는 쉘에서 고쳐 릴리스하고, 개인 앱은 get_app과 upload_app으로, 스토어 앱은 스토어 원본에서 고칩니다. 현재 화면 읽기는 read_window의 동의가 필요합니다. 고친 뒤 reply_app_comment로 무엇을 고쳤는지 답하고 resolve_app_comment로 닫으세요. 고치지 못하면 답글로 까닭을 알리세요."
    )]
    async fn get_app_comment(
        &self,
        Parameters(args): Parameters<GetCommentArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = account(&self.state, request_principal(&context)).and_then(|account| {
            let thread = self.state.get_comment(&account, None, &args.comment_id)?;
            let image = if args.image.unwrap_or(false) && thread.summary.image.is_some() {
                Some(self.state.comment_image(&account, None, &args.comment_id)?)
            } else {
                None
            };
            Ok((thread, image))
        });
        Ok(match result {
            Ok((thread, image)) => {
                let mut content = vec![ContentBlock::text(json!({"thread":thread}).to_string())];
                if let Some(bytes) = image {
                    content.push(ContentBlock::image(STANDARD.encode(bytes), "image/png"));
                }
                CallToolResult::success(content)
            }
            Err(error) => json_error(error),
        })
    }
    #[tool(
        name = "reply_app_comment",
        description = "저장 커멘트에 에이전트 답글을 추가합니다. reply_id를 생략하면 서버가 만듭니다."
    )]
    async fn reply_app_comment(
        &self,
        Parameters(args): Parameters<ReplyCommentArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = account(&self.state, request_principal(&context)).and_then(|account| {
            self.state.reply_comment(
                &account,
                None,
                &args.comment_id,
                AppCommentReplyRequest {
                    id: args.reply_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                    text: args.text,
                },
                AppCommentAuthor::Agent,
            )
        });
        Ok(match result {
            Ok((reply, meta)) => json_result(json!({"reply":reply,"meta":meta})),
            Err(error) => json_error(error),
        })
    }
    #[tool(
        name = "resolve_app_comment",
        description = "커멘트를 해결하거나 다시 엽니다. 고친 앱 판이 있으면 fixed_app_version을 함께 기록합니다."
    )]
    async fn resolve_app_comment(
        &self,
        Parameters(args): Parameters<ResolveCommentArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = account(&self.state, request_principal(&context)).and_then(|account| {
            self.state.resolve_comment(
                &account,
                None,
                &args.comment_id,
                AppCommentResolveRequest {
                    resolved: args.resolved,
                    fixed_app_version: args.fixed_app_version,
                },
            )
        });
        Ok(match result {
            Ok((thread, meta)) => json_result(json!({"thread":thread,"meta":meta})),
            Err(error) => json_error(error),
        })
    }
}
