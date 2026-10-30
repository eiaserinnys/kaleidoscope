use super::*;
use rmcp::{
    model::{Implementation, ServerCapabilities, ServerConfig},
    tool_handler, ServerHandler,
};

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let instructions = format!(
            "kaleidoscope는 디렉터의 데스크톱 쉘입니다. 앱 정의 JSON을 올리면 연결된 디렉터 PC의 쉘에 창으로 뜹니다.\n앱 정의는 쉘의 블록과 모듈만 씁니다. 형식은 upload_app 입력 스키마가 정본입니다.\n파일 경로는 기기마다 디렉터가 고른 폴더 기준 상대 경로이며 폴더 밖은 거부됩니다.\n파일을 여는 앱은 opens(확장자, 폴더를 이어 받을 권한, 경로를 쓸 상태 키)를 선언합니다. 탐색기에서 그 확장자 파일을 열면 그 앱 창이 뜹니다.\n고칠 때는 list_apps → get_app → 수정 후 upload_app 순서로 합니다. 같은 id면 새 버전이 되고 열린 창은 새 버전으로 바뀝니다.\n디렉터가 쉘의 연결 코드를 주면 approve_device로 승인합니다.\n작업 PAS는 지시에 적힌 workspace_id를 upload_app과 open_app에 넣어 그 작업에 띄운다.\nget_workspace로 작업의 데스크톱과 창(앱, 버전, 연 파일)을 읽는다.\nmd-editor 예제: {}\nmd-viewer 예제: {}\nweb-browser 예제: {}\nexplorer 예제: {}",
            include_str!("../../../apps/md-editor.json"),
            include_str!("../../../apps/md-viewer.json"),
            include_str!("../../../apps/web-browser.json"),
            include_str!("../../../apps/explorer.json")
        );
        let instructions = format!(
            "{}\n앱을 만들거나 고쳐 달라는 요청은 list_apps와 get_app으로 현재 정의를 확인한 뒤 upload_app으로 올리고 get_workspace로 창을 확인합니다. workspace_id를 생략하면 이 MCP 연결의 작업을 쓰고, 명시한 workspace_id가 우선합니다. 기기에서 부른 upload_app과 open_app은 그 기기에 창을 띄웁니다.\n기본 앱(list_apps의 builtin: true)은 쉘과 함께 나가며 upload_app과 delete_app으로 고치거나 지울 수 없습니다. kaleidoscope 리포의 apps/에서 고치고 쉘 새 판으로 냅니다. 시험으로 올린 앱은 시험 끝에 delete_app으로 지웁니다.\ndelete_workspace로 작업을 지우면 제공자에 로그인한 기기가 정합화할 때 대화를 보관합니다. 시험으로 만든 작업은 시험 끝에 지웁니다.",
            instructions
        );
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("kaleidoscope", "0.1.0"))
            .with_instructions(instructions)
    }
}
