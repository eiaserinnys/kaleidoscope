//! 기기 갱신 요청 처리. 색인의 최신 판을 준비해 MCP 정책에 따라 바로 설치하거나
//! 쉘 전체 동의를 등록한다. 네트워크 작업은 기기 이벤트 읽기 루프 밖에서 한다.
use std::sync::{mpsc, Arc};

use kaleidoscope_contract::{
    errors,
    store::StoreOrigin,
    CoreError,
    StoreUpdateRequest, StoreUpdateResponse, StoreUpdateResult,
};

use crate::store::install::{self, InstallOutcome, PreparedInstall};
use crate::{link, store, store_latest, Inner};

enum Applied {
    Reply(StoreUpdateResult),
    Consent { consent_request_id: String, receiver: mpsc::Receiver<bool>, prepared: PreparedInstall },
}

fn expired(request: &StoreUpdateRequest) -> Result<(), CoreError> {
    let valid = chrono::DateTime::parse_from_rfc3339(&request.expires_at)
        .is_ok_and(|deadline| deadline > chrono::Utc::now());
    if valid { Ok(()) } else { Err(errors::STORECLIENT_UPDATE_REQUEST_EXPIRED()) }
}

fn current_origin(inner: &Inner, id: &str) -> Option<StoreOrigin> {
    inner.state.lock().unwrap().shared.apps.iter().find(|app| app.id == id)
        .and_then(|app| app.origin.clone())
}

/// 설치된 앱의 최신 출처와 판을 결과로 만든다. 확정 단계가 상태를 바꾼 뒤 읽는다.
fn installed_result(inner: &Inner, id: &str, outcome: InstallOutcome) -> Result<StoreUpdateResult, CoreError> {
    let state = inner.state.lock().unwrap();
    let app = state.shared.apps.iter().find(|app| app.id == id).ok_or_else(|| errors::STORECLIENT_UPDATE_APP_MISSING(id))?;
    let origin = app.origin.clone().ok_or_else(|| errors::STORECLIENT_UPDATE_STORE_REQUIRED(id))?;
    Ok(match outcome {
        InstallOutcome::Installed => StoreUpdateResult::Installed { origin, version: app.current_version },
        InstallOutcome::Unchanged => StoreUpdateResult::Unchanged { origin, version: app.current_version },
    })
}

/// 동의 없이 commit하는 경로. 만료 뒤에는 확정하지 않는다.
fn commit_now(inner: &Arc<Inner>, generation: u64, request: &StoreUpdateRequest, prepared: PreparedInstall) -> Result<StoreUpdateResult, CoreError> {
    if !link::is_current(inner, generation) { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    expired(request)?;
    let outcome = install::commit_prepared_install(inner, prepared)?;
    installed_result(inner, &request.app_id, outcome)
}

/// 쉘 전체 동의를 등록하고 MCP 결과로 consent_required를 만든다.
/// 등록 전에 만료됐거나 링크가 바뀌었으면 동의 창을 만들지 않는다.
fn register_consent(inner: &Arc<Inner>, generation: u64, request: &StoreUpdateRequest, prepared: PreparedInstall) -> Result<Applied, CoreError> {
    if !link::is_current(inner, generation) { return Err(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED()); }
    expired(request)?;
    let registered = crate::installation_consent::register_shell(
        inner, generation, prepared.release, &prepared.server, &prepared.bundle.digest,
        &prepared.bundle.definition, prepared.from_origin.clone(), prepared.replacing, prepared.modified,
    )?;
    let (consent_request_id, receiver) = registered.ok_or_else(errors::STORECLIENT_INSTALL_CONTEXT_CHANGED)?;
    Ok(Applied::Consent { consent_request_id, receiver, prepared })
}

fn begin(inner: &Arc<Inner>, generation: u64, request: &StoreUpdateRequest) -> Result<Applied, CoreError> {
    expired(request)?;
    let id = request.app_id.as_str();
    if kaleidoscope_contract::builtin::is_builtin(id) { return Err(errors::STORECLIENT_UPDATE_BUILTIN(id)); }
    let installed = current_origin(inner, id);
    let installed_app = installed.is_some() || inner.state.lock().unwrap().shared.apps.iter().any(|app| app.id == id);
    let Some(store_url) = request.store_url.clone().or_else(|| installed.as_ref().map(|origin| origin.store_url.clone())) else {
        return Err(if installed_app { errors::STORECLIENT_UPDATE_STORE_REQUIRED(id) } else { errors::STORECLIENT_UPDATE_APP_MISSING(id) });
    };
    let client = store::client(inner, &store_url)?;
    let server = client.server().as_str().to_owned();
    // 캐시 주기와 무관하게 색인을 한 번 즉시 읽어 최신 release를 고르고, 최신 판 표시도 같은 색인으로 맞춘다.
    let index = client.index("").map_err(|failure| failure.error)?;
    store_latest::record(inner, &index);
    let item = index.items.iter().find(|item| item.id == id).ok_or_else(|| errors::STORECLIENT_FETCH_NOT_FOUND(id))?;
    if !item.compatible { return Err(errors::STORECLIENT_INSTALL_INCOMPATIBLE(id)); }
    let prepared = install::prepare_shell_install(inner, &server, id, item.release, request.replace)?;
    // MCP 정책: 설치 안 된 앱은 늘 동의, 설치된 앱은 replace 없는 출처 변경을 거부하고
    // 권한 검토 범위가 같으면 바로, 다르면 쉘 동의를 받는다.
    if !installed_app { return register_consent(inner, generation, request, prepared); }
    if !request.replace && !prepared.same_origin { return Err(errors::REGISTRYINSTALL_ORIGIN_CONFLICT(id)); }
    if prepared.scope_changed { return register_consent(inner, generation, request, prepared); }
    Ok(Applied::Reply(commit_now(inner, generation, request, prepared)?))
}

fn post(inner: &Inner, generation: u64, response: &StoreUpdateResponse) {
    if !link::is_current(inner, generation) { return; }
    let file = inner.link_file.lock().unwrap().clone();
    if let Some(file) = file {
        if let Err(error) = inner.registry.post_store_update_response(&file.server_url, &file.token, response) {
            eprintln!("앱 갱신 응답 전송 실패: {error:?}");
        }
    }
}

/// 승인 뒤 설치는 준비한 같은 바이트와 기대 판, 세대 검사를 그대로 쓴다.
/// 끝난 MCP 요청에는 두 번째 결과를 보내지 않고 기존 앱 변경 이벤트로 결과를 보인다.
fn await_consent(inner: Arc<Inner>, generation: u64, request_id: String, receiver: mpsc::Receiver<bool>, prepared: PreparedInstall) {
    std::thread::spawn(move || {
        // 링크 교체·코어 종료로 동의가 취소되면 채널이 닫혀 취소로 읽는다.
        if !receiver.recv().unwrap_or(false) { return; }
        if !link::is_current(&inner, generation) {
            eprintln!("앱 갱신 동의 뒤 연결이 바뀌어 설치하지 않았습니다: request_id={request_id}");
            return;
        }
        if let Err(error) = install::commit_prepared_install(&inner, prepared) {
            if let Some(code) = error.id.as_deref() {
                eprintln!("앱 갱신 설치 실패: code={code} {}", error.message);
            } else {
                eprintln!("앱 갱신 설치 실패: {}", error.message);
            }
        }
    });
}

pub(crate) fn handle_device_event(inner: &Arc<Inner>, generation: u64, request: StoreUpdateRequest) {
    if !link::is_current(inner, generation) { return; }
    let inner = Arc::clone(inner);
    std::thread::spawn(move || {
        let request_id = request.request_id.clone();
        match begin(&inner, generation, &request) {
            Ok(Applied::Reply(result)) => post(&inner, generation, &StoreUpdateResponse { request_id, result }),
            Ok(Applied::Consent { consent_request_id, receiver, prepared }) => {
                post(&inner, generation, &StoreUpdateResponse {
                    request_id: request_id.clone(),
                    result: StoreUpdateResult::ConsentRequired { consent_request_id },
                });
                await_consent(Arc::clone(&inner), generation, request_id, receiver, prepared);
            }
            Err(error) => post(&inner, generation, &StoreUpdateResponse {
                request_id,
                result: StoreUpdateResult::Error { error },
            }),
        }
    });
}
