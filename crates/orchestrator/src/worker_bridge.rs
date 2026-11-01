//! 워커 프로세스 하나에만 열리는 앱 간 호출 다리.
use super::*;
use axum::extract::State;
use subtle::ConstantTimeEq;

#[derive(Clone)]
struct Bridge {
    state: AppState,
    account: String,
    token: String,
    calls: Vec<String>,
    chain: Vec<String>,
    workspace: Option<String>,
    deadline: tokio::time::Instant,
}

#[derive(Deserialize)]
struct BridgeRequest {
    kind: String,
    app_id: String,
    action: Option<String>,
    entry_id: Option<String>,
    args: Option<Value>,
    workspace_id: Option<String>,
}

pub(super) struct BridgeTask(tokio::task::JoinHandle<()>);
impl Drop for BridgeTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) async fn start(
    state: AppState,
    account: &str,
    calls: Vec<String>,
    chain: Vec<String>,
    workspace: Option<&str>,
    deadline: tokio::time::Instant,
) -> Result<(String, String, BridgeTask), CoreError> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| server_error(&e.to_string()))?;
    let address = listener
        .local_addr()
        .map_err(|e| server_error(&e.to_string()))?;
    let token = random_token();
    let bridge = Bridge {
        state,
        account: account.into(),
        token: token.clone(),
        calls,
        chain,
        workspace: workspace.map(str::to_owned),
        deadline,
    };
    let app = Router::new().route("/", post(handle)).with_state(bridge);
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("워커 호출 다리 오류: {error}");
        }
    });
    Ok((format!("http://{address}/"), token, BridgeTask(task)))
}

async fn handle(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(request): Json<BridgeRequest>,
) -> Response {
    let provided = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !bool::from(provided.as_bytes().ct_eq(bridge.token.as_bytes())) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !bridge.calls.contains(&request.app_id)
        || bridge.chain.contains(&request.app_id)
        || bridge.chain.len() >= 4
    {
        return super::http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    }
    let workspace = request
        .workspace_id
        .as_deref()
        .or(bridge.workspace.as_deref());
    let result = match request.kind.as_str() {
        "read" => match request.entry_id {
            Some(entry) => bridge
                .state
                .read_app_storage(&bridge.account, &request.app_id, &entry, workspace)
                .map(|value| value.content),
            None => Err(CoreError::new(ErrorCode::InvalidRequest)),
        },
        "call" => match request.action {
            Some(action) => {
                let mut chain = bridge.chain.clone();
                chain.push(request.app_id.clone());
                let req = kaleidoscope_contract::worker::WorkerInvokeRequest {
                    action,
                    args: request.args,
                    workspace_id: workspace.map(str::to_owned),
                };
                bridge
                    .state
                    .invoke_worker_chain(
                        &bridge.account,
                        &request.app_id,
                        req,
                        chain,
                        Some(bridge.deadline),
                    )
                    .await
                    .map(|reply| reply.result)
            }
            None => Err(CoreError::new(ErrorCode::InvalidRequest)),
        },
        _ => Err(CoreError::new(ErrorCode::InvalidRequest)),
    };
    match result {
        Ok(value) => Json(json!({"result":value})).into_response(),
        Err(error) => super::http::error_response(StatusCode::BAD_REQUEST, error),
    }
}
