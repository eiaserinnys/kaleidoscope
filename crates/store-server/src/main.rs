use kaleidoscope_contract::errors::store_server as e;
use std::{net::SocketAddr, path::PathBuf, process::ExitCode};

#[tokio::main]
async fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut bind = None;
    let mut dir = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                println!("kaleidoscope-store-server --bind <주소:포트> --data-dir <폴더>");
                return ExitCode::SUCCESS;
            }
            "--bind" => bind = args.next(),
            "--data-dir" => dir = args.next(),
            _ => {
                eprintln!("사용법: kaleidoscope-store-server --bind <주소:포트> --data-dir <폴더>");
                return ExitCode::FAILURE;
            }
        }
    }
    let (Some(bind), Some(dir)) = (bind, dir) else {
        eprintln!("--bind와 --data-dir을 모두 지정하세요.");
        return ExitCode::FAILURE;
    };
    let address: SocketAddr = match bind.parse() {
        Ok(v) => v,
        Err(_) => {
            eprintln!("{}", e::STORESERVER_START_BIND_FAILED(&bind).message);
            return ExitCode::FAILURE;
        }
    };
    let dir = PathBuf::from(dir);
    if let Err(err) = kaleidoscope_store_server::initialize(&dir) {
        eprintln!("{}: {}", err.id.unwrap_or_default(), err.message);
        return ExitCode::FAILURE;
    }
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(v) => v,
        Err(_) => {
            let err = e::STORESERVER_START_BIND_FAILED(&bind);
            eprintln!("{}: {}", err.id.unwrap_or_default(), err.message);
            return ExitCode::FAILURE;
        }
    };
    println!("스토어 서버: {}", listener.local_addr().unwrap());
    if axum::serve(listener, kaleidoscope_store_server::router(dir))
        .await
        .is_err()
    {
        eprintln!("스토어 서버가 종료되었습니다.");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
