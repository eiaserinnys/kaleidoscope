use kaleidoscope_contract::errors::store_server as e;
use kaleidoscope_store_server::PublishDeclaration;
use std::{net::SocketAddr, path::PathBuf, process::ExitCode};

#[tokio::main]
async fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut bind = None;
    let mut dir = None;
    let mut invite_file = None;
    let mut publish_url = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                println!("kaleidoscope-store-server --bind <주소:포트> --data-dir <폴더> [--invite-code-file <파일>] [--publish-pull-request <주소>]");
                return ExitCode::SUCCESS;
            }
            "--bind" => bind = args.next(),
            "--data-dir" => dir = args.next(),
            "--invite-code-file" => invite_file = args.next(),
            "--publish-pull-request" => publish_url = args.next(),
            _ => {
                eprintln!("사용법: kaleidoscope-store-server --bind <주소:포트> --data-dir <폴더> [--invite-code-file <파일>] [--publish-pull-request <주소>]");
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
    let publish = match publish_url {
        None => PublishDeclaration::Direct,
        Some(url) => match PublishDeclaration::pull_request(&url) {
            Ok(value) => value,
            Err(err) => {
                eprintln!("{}: {}", err.id.unwrap_or_default(), err.message);
                return ExitCode::FAILURE;
            }
        },
    };
    let invite_file = invite_file.or_else(|| std::env::var("KALEIDOSCOPE_STORE_INVITE_FILE").ok());
    let invite = match invite_file {
        None => None,
        Some(path) => match std::fs::read_to_string(&path) {
            Ok(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
            Ok(_) | Err(_) => {
                let err = e::STORESERVER_START_INVITE_FILE_FAILED();
                eprintln!("{}: {}", err.id.unwrap_or_default(), err.message);
                return ExitCode::FAILURE;
            }
        },
    };
    let dir = PathBuf::from(dir);
    if let Err(err) = kaleidoscope_store_server::initialize(&dir, &publish) {
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
    if axum::serve(
        listener,
        kaleidoscope_store_server::router_with_publish(dir, invite, publish),
    )
    .await
    .is_err()
    {
        eprintln!("스토어 서버가 종료되었습니다.");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
