use kaleidoscope_orchestrator::{backup_loop, backup_once, load_or_create_token, router, AppState};
use std::{env, net::SocketAddr, path::PathBuf};

#[derive(Debug)]
struct Options {
    bind: String,
    db: PathBuf,
    token: Option<String>,
    token_file: Option<PathBuf>,
    print: bool,
}
impl Options {
    fn parse(args: impl Iterator<Item = String>) -> Result<Option<Self>, String> {
        let mut options = Self {
            bind: env::var("KALEIDOSCOPE_BIND").unwrap_or_else(|_| "127.0.0.1:4219".into()),
            db: env::var_os("KALEIDOSCOPE_DB_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| "kaleidoscope.db".into()),
            token: env::var("KALEIDOSCOPE_MCP_TOKEN")
                .ok()
                .filter(|s| !s.is_empty()),
            token_file: None,
            print: false,
        };
        let mut args = args;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--help" | "-h" => {
                    println!("kaleidoscope-orchestrator [--bind <주소>] [--db <경로>] [--token <토큰>] [--token-file <경로>] [--print-mcp-config]");
                    return Ok(None);
                }
                "--print-mcp-config" => options.print = true,
                "--bind" | "--db" | "--token" | "--token-file" => {
                    let value = args
                        .next()
                        .filter(|v| !v.trim().is_empty())
                        .ok_or_else(|| format!("{arg} 값이 필요합니다"))?;
                    match arg.as_str() {
                        "--bind" => options.bind = value,
                        "--db" => options.db = value.into(),
                        "--token" => options.token = Some(value),
                        _ => options.token_file = Some(value.into()),
                    }
                }
                _ => return Err(format!("알 수 없는 옵션: {arg}")),
            }
        }
        Ok(Some(options))
    }
}
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
async fn run() -> Result<(), String> {
    let Some(options) = Options::parse(env::args().skip(1))? else {
        return Ok(());
    };
    let address: SocketAddr = options
        .bind
        .parse()
        .map_err(|e| format!("주소 오류: {e}"))?;
    let token_file = options.token_file.unwrap_or_else(|| {
        let mut path = options.db.as_os_str().to_owned();
        path.push(".token");
        path.into()
    });
    let token = match options.token {
        Some(token) => token,
        None => load_or_create_token(&token_file)?,
    };
    let state = AppState::open(&options.db, token.clone())?;
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|e| e.to_string())?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?;
    eprintln!("주소: {actual}\nDB: {}\n토큰 파일: {}\nMCP: http://{actual}/mcp (Authorization: Bearer <토큰>)", options.db.display(), token_file.display());
    if options.print {
        println!(
            "{}",
            serde_json::json!({"mcpServers":{"kaleidoscope":{"type":"http","url":format!("http://{actual}/mcp"),"headers":{"Authorization":format!("Bearer {token}")}}}})
        );
    }
    if let Err(error) = backup_once(&state) {
        eprintln!("초기 백업 실패: {error}");
    }
    tokio::spawn(backup_loop(state.clone()));
    tokio::spawn(kaleidoscope_orchestrator::worker::worker_schedule_loop(
        state.clone(),
    ));
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|e| e.to_string())
}
