use super::*;
use rmcp::{
    model::{Implementation, ServerCapabilities, ServerConfig},
    tool_handler, ServerHandler,
};

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let instructions = kaleidoscope_contract::APP_AUTHORING_GUIDE;
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("kaleidoscope", "0.1.0"))
            .with_instructions(instructions.to_string())
    }
}
