use super::*;
use rmcp::{
    model::{Implementation, ServerCapabilities, ServerConfig},
    tool_handler, ServerHandler,
};

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let instructions = "kaleidoscope는 디렉터의 데스크톱 쉘입니다. 앱 정의 JSON을 올리면 연결된 쉘에 창으로 뜹니다.\n앱 정의는 쉘의 블록과 모듈만 씁니다. 형식은 upload_app 입력 스키마가 정본입니다.\n파일 경로는 기기마다 고른 폴더 기준 상대 경로이며 폴더 밖은 거부됩니다. 파일을 여는 앱은 opens를 선언합니다.\n개인 앱은 list_apps와 get_app으로 현재 정의를 확인한 뒤 upload_app으로 올리고 get_workspace로 창을 확인합니다. workspace_id를 생략하면 이 MCP 연결의 작업을 씁니다.\n기본 앱은 쉘과 함께 나가며 upload_app과 delete_app으로 고치거나 지울 수 없습니다. 리포의 apps/에서 고치고 로컬 시험 쉘에서 확인합니다.\n기기 연결 코드는 approve_device로 승인합니다. 시험으로 만든 앱과 작업은 시험이 끝나면 지웁니다.";
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("kaleidoscope", "0.1.0"))
            .with_instructions(instructions.to_string())
    }
}
