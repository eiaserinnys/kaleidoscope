use super::{active_ids, import, open_core, open_window, FakeHost};
use crate::Core;
use crate::{connections, registry_events};
use kaleidoscope_contract::{
    data::HttpMethod,
    registry::{ConnectionInfo, ConnectionKind, DeviceEvent},
};
use serde_json::json;
use std::{sync::mpsc, thread, time::Duration};
use tempfile::TempDir;

fn connection_app() -> String {
    json!({
        "id":"connection-snapshot-race",
        "name":"연결 스냅샷 경합 시험",
        "requires":{"blocks":4,"modules":{"connection":1}},
        "permissions":[{"module":"connection","id":"api","connection":"provider","access":"readwrite","label":"API"}],
        "state":{},
        "ui":{"type":"text","value":"ready"}
    })
    .to_string()
}

fn core_with_connection_window(temp: &TempDir) -> (Core, String) {
    let core = open_core(
        temp.path(),
        vec![],
        &std::sync::Arc::new(FakeHost::default()),
    );
    import(&core, &connection_app());
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "connection-snapshot-race");
    (core, window)
}

fn provider_connection() -> ConnectionInfo {
    ConnectionInfo {
        name: "provider".into(),
        kind: ConnectionKind::Oauth,
        base_url: "https://example.test".into(),
        writable: true,
        paths: vec![],
        issuer: None,
        scopes: None,
        resource: None,
    }
}

fn apply_apps_snapshot(core: &Core) {
    assert!(registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::AppsSnapshot {
            apps: vec![],
            deleted: vec![],
        }
    ));
    assert!(matches!(
        core.inner.state.lock().unwrap().link,
        kaleidoscope_contract::LinkStatus::Connected { .. }
    ));
}

#[test]
fn authorize_waits_for_the_connections_snapshot_after_apps_snapshot() {
    let temp = TempDir::new().unwrap();
    let (core, window) = core_with_connection_window(&temp);
    apply_apps_snapshot(&core);
    let inner = core.inner.clone();
    let (sender, receiver) = mpsc::channel();
    let lookup = thread::spawn(move || {
        let result = connections::authorize(&inner, &window, "api", HttpMethod::Get, "/health")
            .map(|(_, info)| info.name)
            .map_err(|error| (error.id, error.message));
        sender.send(result).unwrap();
    });

    assert!(receiver.recv_timeout(Duration::from_millis(30)).is_err());
    assert!(registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::ConnectionsSnapshot {
            connections: vec![provider_connection()],
        }
    ));
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
        Ok("provider".into())
    );
    lookup.join().unwrap();
}

#[test]
fn missing_connection_after_snapshot_keeps_the_registered_error() {
    let temp = TempDir::new().unwrap();
    let (core, window) = core_with_connection_window(&temp);
    apply_apps_snapshot(&core);
    assert!(registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::ConnectionsSnapshot {
            connections: vec![]
        }
    ));

    let started = std::time::Instant::now();
    let error = connections::authorize(&core.inner, &window, "api", HttpMethod::Get, "/health")
        .unwrap_err();

    assert_eq!(
        error.id.as_deref(),
        Some("CONN_AUTHORIZE_CONNECTION_MISSING")
    );
    assert_eq!(
        error.message,
        "연결 provider 설정을 찾지 못했습니다. 에이전트에게 이 오류 코드를 전하세요."
    );

    let login_error = connections::login(&core.inner, &window, "api").unwrap_err();
    assert_eq!(
        login_error.id.as_deref(),
        Some("CONN_LOGIN_CONNECTION_MISSING")
    );
    assert_eq!(
        login_error.message,
        "연결 provider 설정을 찾지 못했습니다. 에이전트에게 이 오류 코드를 전하세요."
    );

    let restore_error =
        match crate::conversation_http::Client::restore(&core.inner, "provider", "api") {
            Err(error) => error,
            Ok(_) => panic!("연결 설정이 없는 상태에서 제공자 복원이 성공했습니다"),
        };
    assert_eq!(
        restore_error.id.as_deref(),
        Some("CONV_HTTP_PROVIDER_UNAVAILABLE")
    );
    assert_eq!(
        restore_error.message,
        "대화 제공자 연결 provider: 사용할 수 없습니다. 에이전트에게 이 오류 코드를 전하세요."
    );
    assert!(started.elapsed() < Duration::from_secs(1));
}
