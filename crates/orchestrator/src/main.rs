use kaleidoscope_orchestrator::{backup_loop, backup_once, router, AppState};
use std::{env, net::SocketAddr, path::PathBuf};

#[tokio::main]
async fn main() {
    let token = match env::var("KALEIDOSCOPE_MCP_TOKEN") {
        Ok(value) if !value.is_empty() => value,
        _ => {
            eprintln!("KALEIDOSCOPE_MCP_TOKEN 환경변수가 필요합니다.");
            std::process::exit(1);
        }
    };
    let bind = env::var("KALEIDOSCOPE_BIND").unwrap_or_else(|_| "127.0.0.1:4219".into());
    let address: SocketAddr = match bind.parse() {
        Ok(address) => address,
        Err(error) => {
            eprintln!("KALEIDOSCOPE_BIND 주소가 올바르지 않습니다: {error}");
            std::process::exit(1);
        }
    };
    let path = env::var_os("KALEIDOSCOPE_DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("kaleidoscope.db"));
    let state = match AppState::open(path, token) {
        Ok(state) => state,
        Err(error) => {
            eprintln!("오케스트레이터를 시작할 수 없습니다: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = backup_once(&state) {
        eprintln!("초기 백업에 실패했습니다: {error}");
    }
    tokio::spawn(backup_loop(state.clone()));
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("{}에서 서버를 열 수 없습니다: {error}", address);
            std::process::exit(1);
        }
    };
    if let Err(error) = axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown())
        .await
    {
        eprintln!("서버가 종료되었습니다: {error}");
        std::process::exit(1);
    }
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}
