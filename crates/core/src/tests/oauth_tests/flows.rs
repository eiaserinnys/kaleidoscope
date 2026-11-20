use super::*;
use crate::connections::LoginStore;
use serde_json::json;

#[test]
fn another_windows_get_does_not_hide_unseen_stream_items() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    let client = crate::conversation_http::Client::new(&core.inner, &window, "api", "/v1").unwrap();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    fixture.state.lock().unwrap().stream_status = 403;
    crate::conversation_stream::watch(
        &core.inner,
        "key".into(),
        &window,
        client.clone(),
        "thread-1",
        "0",
    );
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(10)).unwrap(),
        CoreEvent::ConversationError { .. }
    ));
    let (_, desktop) = active_ids(&core);
    let second = open_window(&core, &desktop, "connection-app");
    while rx.try_recv().is_ok() {}
    {
        let mut state = fixture.state.lock().unwrap();
        state.stream_status = 200;
        state.stream_item = true;
    }
    crate::conversation_stream::watch(&core.inner, "key".into(), &second, client, "thread-1", "1");
    let event = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        matches!(&event, CoreEvent::ConversationUpdate { update: kaleidoscope_contract::conversation::ConversationEvent::Snapshot { snapshot }, .. } if snapshot.items.iter().any(|item| item.id == "item-2")),
        "{event:?}"
    );
}

#[test]
fn stream_auth_failure_reports_and_successful_login_reconnects() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    let client = crate::conversation_http::Client::new(&core.inner, &window, "api", "/v1").unwrap();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = tx.send(event.clone());
    }));
    fixture.state.lock().unwrap().stream_status = 401;
    crate::conversation_stream::watch(&core.inner, "key".into(), &window, client, "thread-1", "0");
    let event = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(matches!(
        &event,
        CoreEvent::ConversationError { error, .. }
            if error.id.as_deref() == Some("CONV_STREAM_LOGIN_REQUIRED")
                && error.code == kaleidoscope_contract::ErrorCode::LoginRequired
    ));
    fixture.state.lock().unwrap().stream_status = 200;
    login(&core, &window).unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(10)).unwrap(),
        CoreEvent::ConversationUpdate {
            update: kaleidoscope_contract::conversation::ConversationEvent::Snapshot { .. },
            ..
        }
    ));
    fixture.state.lock().unwrap().stream_status = 403;
    let event = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(matches!(
        &event,
        CoreEvent::ConversationError { error, .. }
            if error.id.as_deref() == Some("CONV_STREAM_PERMISSION_DENIED")
    ));
    fixture.state.lock().unwrap().stream_status = 200;
    login(&core, &window).unwrap();
    assert!(matches!(
        rx.recv_timeout(Duration::from_secs(10)).unwrap(),
        CoreEvent::ConversationUpdate {
            update: kaleidoscope_contract::conversation::ConversationEvent::Snapshot { .. },
            ..
        }
    ));
}

#[test]
fn login_registers_persists_and_oauth_source_uses_bearer_token() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    host.wrong_state_first.store(true, Ordering::SeqCst);
    let (core, window) = make_core(host.clone(), &temp, &fixture, ConnectionKind::Oauth);
    assert_eq!(
        login(&core, &window).unwrap(),
        CoreReply::ConnectionLogin {}
    );
    let record = core.inner.login_store.entry("example").unwrap();
    assert_eq!(record.access_token.as_deref(), Some("access-token"));
    assert!(temp.path().join("logins.json").is_file());

    let (sender, receiver) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = sender.send(event.clone());
    }));
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut ready = false;
    let mut last_status = None;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            last_status = view.sources.get("items").cloned();
            if matches!(view.sources.get("items"), Some(SourceStatus::Ready { .. })) {
                ready = true;
                break;
            }
        }
    }
    assert!(
        ready,
        "OAuth 원천이 ready가 된다: status={last_status:?}, requests={}",
        fixture.state.lock().unwrap().resource_requests
    );
    let state = fixture.state.lock().unwrap();
    assert_eq!(
        state
            .last_authorization
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("authorization: bearer access-token")
    );
    let registration: Value =
        serde_json::from_str(&std::fs::read_to_string(temp.path().join("logins.json")).unwrap())
            .unwrap();
    assert_eq!(registration["example"]["client_id"], "client-1");
}

#[test]
fn authorization_url_opens_through_open_auth_url() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(InAppAuthHost::default());
    let (core, window) = make_core(host.clone(), &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    assert_eq!(
        core.inner
            .login_store
            .entry("example")
            .and_then(|entry| entry.access_token),
        Some("access-token".into())
    );
    let auth_urls = host.auth_urls.lock().unwrap();
    assert_eq!(
        auth_urls.len(),
        1,
        "인가 주소는 open_auth_url로 한 번 열고 open_url로는 열지 않는다"
    );
    assert!(
        auth_urls[0].starts_with(&format!(
            "{}/authorize?response_type=code&client_id=client-1",
            fixture.base
        )),
        "{}",
        auth_urls[0]
    );
}

#[test]
fn repeated_login_reuses_registered_client_and_loopback_port() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host.clone(), &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    login(&core, &window).unwrap();
    let ports = host.ports.lock().unwrap();
    assert_eq!(ports.len(), 2);
    assert_eq!(ports[0], ports[1]);
    assert_eq!(fixture.state.lock().unwrap().registrations, 1);
}

#[test]
fn occupied_saved_port_causes_registration_with_a_new_port() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host.clone(), &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    let port = host.ports.lock().unwrap()[0];
    let occupied = TcpListener::bind(("127.0.0.1", port)).unwrap();
    login(&core, &window).unwrap();
    let ports = host.ports.lock().unwrap();
    assert_ne!(ports[0], ports[1]);
    assert_eq!(fixture.state.lock().unwrap().registrations, 2);
    drop(occupied);
}

#[test]
fn invalid_client_re_registers_once_and_retries_authorization() {
    let fixture = OAuthFixture::start();
    fixture.state.lock().unwrap().invalid_client_first_exchange = true;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    let state = fixture.state.lock().unwrap();
    assert_eq!(state.registrations, 2);
    assert_eq!(state.authorization_exchanges, 2);
}

#[test]
fn expired_and_unauthorized_access_tokens_refresh_once() {
    let fixture = OAuthFixture::start();
    fixture
        .state
        .lock()
        .unwrap()
        .resource_requires_refreshed_token = true;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    let past = Some(1);
    core.inner
        .login_store
        .store(
            "example",
            LoginEntry {
                issuer: fixture.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                scopes: Some("read".into()),
                access_token: Some("expired".into()),
                refresh_token: Some("refresh".into()),
                expires_at: past,
            },
        )
        .unwrap();
    let result = crate::connections::request(
        &core.inner,
        &window,
        "api",
        HttpMethod::Get,
        "/old",
        Default::default(),
        None,
        ConnectionAccept::Json,
    )
    .unwrap_or_else(|error| {
        let state = fixture.state.lock().unwrap();
        panic!(
            "OAuth request failed: {error:?}; registrations={}, token_exchanges={}, refreshes={}, resources={}",
            state.registrations,
            state.authorization_exchanges,
            state.refreshes,
            state.resource_requests
        )
    });
    assert_eq!(result.status, 200);
    {
        let state = fixture.state.lock().unwrap();
        assert_eq!(state.refreshes, 1);
        assert_eq!(
            state
                .last_authorization
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("authorization: bearer refreshed")
        );
    }

    core.inner
        .login_store
        .store(
            "example",
            LoginEntry {
                issuer: fixture.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                scopes: Some("read".into()),
                access_token: Some("unauthorized".into()),
                refresh_token: Some("refresh-again".into()),
                expires_at: None,
            },
        )
        .unwrap();
    let result = crate::connections::request(
        &core.inner,
        &window,
        "api",
        HttpMethod::Get,
        "/old",
        Default::default(),
        None,
        ConnectionAccept::Json,
    )
    .unwrap();
    assert_eq!(result.status, 200);
    assert_eq!(fixture.state.lock().unwrap().refreshes, 2);
}

#[test]
fn unauthorized_token_without_refresh_is_cleared_and_requests_login() {
    let fixture = OAuthFixture::start();
    fixture
        .state
        .lock()
        .unwrap()
        .resource_requires_refreshed_token = true;
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    core.inner
        .login_store
        .store(
            "example",
            LoginEntry {
                issuer: fixture.base.clone(),
                client_id: None,
                redirect_port: None,
                scopes: Some("read".into()),
                access_token: Some("bad".into()),
                refresh_token: None,
                expires_at: None,
            },
        )
        .unwrap();
    let result = crate::connections::request(
        &core.inner,
        &window,
        "api",
        HttpMethod::Get,
        "/old",
        Default::default(),
        None,
        ConnectionAccept::Json,
    );
    assert!(
        matches!(result, Err(crate::connections::RequestError::Login(permission)) if permission == "api")
    );
    let entry = core.inner.login_store.entry("example").unwrap();
    assert_eq!(entry.access_token, None);
    assert_eq!(entry.refresh_token, None);
}

#[test]
fn relay_login_is_rejected_as_invalid_request() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Relay);
    assert_eq!(
        login(&core, &window).unwrap_err().code,
        ErrorCode::InvalidRequest
    );
}

#[test]
fn login_timeout_maps_to_invalid_request() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let (core, _) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    let info = core.inner.connections.lock().unwrap()[0].clone();
    let error = crate::oauth::login_with_timeout(
        &info,
        "test-device",
        &NoCallbackHost,
        &core.inner.login_store,
        Duration::from_millis(30),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidRequest);
    assert_eq!(error.id.as_deref(), Some("CONN_LOGIN_CALLBACK_TIMEOUT"));
    assert_eq!(
        error.message,
        "연결 example 로그인이 시간 안에 끝나지 않았습니다. 다시 로그인하고 브라우저에서 인증을 끝까지 마치세요."
    );
}

#[test]
fn unsupported_browser_maps_to_unavailable() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(UnavailableBrowserHost);
    let (core, window) = make_core(host, &temp, &fixture, ConnectionKind::Oauth);
    assert_eq!(
        login(&core, &window).unwrap_err().code,
        ErrorCode::Unavailable
    );
}

#[test]
fn wrong_state_is_ignored_then_login_can_finish() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let callback_listener = listener.try_clone().unwrap();
    let callback_thread = thread::spawn(move || {
        let redirect = Url::parse(&format!("http://127.0.0.1:{port}/callback")).unwrap();
        callback(&redirect, "wrong", "ignored").unwrap();
        callback(&redirect, "right", "accepted").unwrap();
    });
    let result =
        crate::oauth::wait_for_callback(&callback_listener, "right", Duration::from_secs(1));
    callback_thread.join().unwrap();
    assert!(matches!(result, Ok(crate::oauth::Callback::Code(code)) if code == "accepted"));
}

#[test]
fn wrong_state_without_valid_callback_times_out() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let callback_listener = listener.try_clone().unwrap();
    let callback_thread = thread::spawn(move || {
        let redirect = Url::parse(&format!("http://127.0.0.1:{port}/callback")).unwrap();
        callback(&redirect, "wrong", "ignored").unwrap();
    });
    let result =
        crate::oauth::wait_for_callback(&callback_listener, "right", Duration::from_millis(60));
    callback_thread.join().unwrap();
    assert!(matches!(result, Err(crate::oauth::FlowError::Timeout)));
}

#[test]
fn stalled_loopback_request_does_not_extend_login_deadline() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let callback_listener = listener.try_clone().unwrap();
    let stalled_client = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let (release, wait_for_release) = mpsc::channel();
    let client_thread = thread::spawn(move || {
        let _ = wait_for_release.recv_timeout(Duration::from_millis(600));
        drop(stalled_client);
    });

    let started = Instant::now();
    let result =
        crate::oauth::wait_for_callback(&callback_listener, "right", Duration::from_millis(100));
    let elapsed = started.elapsed();
    let _ = release.send(());
    client_thread.join().unwrap();

    assert!(matches!(result, Err(crate::oauth::FlowError::Timeout)));
    assert!(elapsed < Duration::from_millis(400), "elapsed: {elapsed:?}");
}

#[test]
fn simultaneous_expired_token_reads_refresh_once_and_keep_rotated_token() {
    let fixture = OAuthFixture::start();
    fixture.state.lock().unwrap().refresh_response_delay = Duration::from_millis(300);
    let temp = TempDir::new().unwrap();
    let (core, _) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    core.inner
        .login_store
        .store(
            "example",
            LoginEntry {
                issuer: fixture.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                scopes: Some("read".into()),
                access_token: Some("expired".into()),
                refresh_token: Some("rotating-refresh".into()),
                expires_at: Some(1),
            },
        )
        .unwrap();

    let barrier = Arc::new(std::sync::Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let login_store = core.inner.login_store.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                login_store.token("example", Some("read"))
            })
        })
        .collect();
    barrier.wait();
    let tokens: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap().unwrap())
        .collect();

    assert_eq!(
        tokens,
        vec![Some("refreshed".into()), Some("refreshed".into())]
    );
    let stored = core.inner.login_store.entry("example").unwrap();
    assert_eq!(stored.access_token.as_deref(), Some("refreshed"));
    assert_eq!(stored.refresh_token.as_deref(), Some("rotated-1"));
    core.inner.login_store.invalidate("example", "expired");
    let after_stale_invalidation = core.inner.login_store.entry("example").unwrap();
    assert_eq!(
        after_stale_invalidation.access_token.as_deref(),
        Some("refreshed")
    );
    assert_eq!(
        after_stale_invalidation.refresh_token.as_deref(),
        Some("rotated-1")
    );
    assert_eq!(fixture.state.lock().unwrap().refreshes, 1);
}

#[test]
fn invalidation_waits_for_refresh_and_preserves_rotated_credentials() {
    let fixture = OAuthFixture::start();
    fixture.state.lock().unwrap().refresh_response_delay = Duration::from_millis(500);
    let temp = TempDir::new().unwrap();
    let (core, _) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    core.inner
        .login_store
        .store(
            "example",
            LoginEntry {
                issuer: fixture.base.clone(),
                client_id: Some("client".into()),
                redirect_port: Some(40000),
                scopes: Some("read".into()),
                access_token: Some("expired".into()),
                refresh_token: Some("rotating-refresh".into()),
                expires_at: Some(1),
            },
        )
        .unwrap();

    let refresh_store = core.inner.login_store.clone();
    let refresh_thread = thread::spawn(move || refresh_store.refresh("example", "expired"));
    let deadline = Instant::now() + Duration::from_secs(2);
    while fixture.state.lock().unwrap().refreshes == 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(fixture.state.lock().unwrap().refreshes, 1);

    core.inner.login_store.invalidate("example", "expired");
    assert_eq!(
        refresh_thread.join().unwrap().unwrap().as_deref(),
        Some("refreshed")
    );
    let stored = core.inner.login_store.entry("example").unwrap();
    assert_eq!(stored.access_token.as_deref(), Some("refreshed"));
    assert_eq!(stored.refresh_token.as_deref(), Some("rotated-1"));
}

fn saved_login(temp: &TempDir, connection: &str) -> Value {
    let text = std::fs::read_to_string(temp.path().join("logins.json")).unwrap();
    serde_json::from_str::<Value>(&text).unwrap()[connection].clone()
}

fn expired_login(fixture: &OAuthFixture, refresh_token: &str) -> LoginEntry {
    LoginEntry {
        issuer: fixture.base.clone(),
        client_id: Some("client".into()),
        redirect_port: Some(40000),
        scopes: Some("read".into()),
        access_token: Some("expired".into()),
        refresh_token: Some(refresh_token.into()),
        expires_at: Some(1),
    }
}

#[test]
fn refresh_network_failure_keeps_login_and_recovers_without_login() {
    let fixture = OAuthFixture::start();
    fixture.state.lock().unwrap().offline = true;
    let temp = TempDir::new().unwrap();
    let (core, window) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    core.inner
        .login_store
        .store("example", expired_login(&fixture, "refresh"))
        .unwrap();

    let error = core
        .inner
        .login_store
        .token("example", Some("read"))
        .unwrap_err();
    assert_eq!(
        error.id.as_deref(),
        Some("CONN_REFRESH_OAUTH_DISCOVERY_UNREACHABLE")
    );
    assert_eq!(error.code, ErrorCode::Unavailable);

    let result = crate::connections::request(
        &core.inner,
        &window,
        "api",
        HttpMethod::Get,
        "/old",
        Default::default(),
        None,
        ConnectionAccept::Json,
    );
    assert!(matches!(
        result,
        Err(crate::connections::RequestError::Core(error))
            if error.id.as_deref() == Some("CONN_REFRESH_OAUTH_DISCOVERY_UNREACHABLE")
    ));

    let saved = saved_login(&temp, "example");
    assert_eq!(saved["access_token"], json!("expired"));
    assert_eq!(saved["refresh_token"], json!("refresh"));

    fixture.state.lock().unwrap().offline = false;
    assert_eq!(
        core.inner.login_store.token("example", Some("read")),
        Ok(Some("refreshed".to_string()))
    );
    assert_eq!(fixture.state.lock().unwrap().refreshes, 1);
    let saved = saved_login(&temp, "example");
    assert_eq!(saved["access_token"], json!("refreshed"));
    assert_eq!(saved["refresh_token"], json!("rotated-1"));
}

#[test]
fn refresh_server_failure_keeps_login() {
    let fixture = OAuthFixture::start();
    fixture.state.lock().unwrap().refresh_status = Some(503);
    let temp = TempDir::new().unwrap();
    let (core, _) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    core.inner
        .login_store
        .store("example", expired_login(&fixture, "refresh"))
        .unwrap();

    let error = core
        .inner
        .login_store
        .token("example", Some("read"))
        .unwrap_err();
    assert_eq!(error.id.as_deref(), Some("CONN_REFRESH_OAUTH_TOKEN_FAILED"));
    assert_eq!(error.code, ErrorCode::Server);
    assert_eq!(fixture.state.lock().unwrap().refreshes, 1);
    let saved = saved_login(&temp, "example");
    assert_eq!(saved["access_token"], json!("expired"));
    assert_eq!(saved["refresh_token"], json!("refresh"));
}

#[test]
fn refresh_rejection_clears_login_and_requests_login() {
    let fixture = OAuthFixture::start();
    {
        let mut state = fixture.state.lock().unwrap();
        state.refresh_status = Some(400);
        state.refresh_body = Some(json!({"error":"invalid_grant"}).to_string());
    }
    let temp = TempDir::new().unwrap();
    let (core, window) = make_core(
        Arc::new(NoCallbackHost),
        &temp,
        &fixture,
        ConnectionKind::Oauth,
    );
    core.inner
        .login_store
        .store("example", expired_login(&fixture, "refresh"))
        .unwrap();

    assert_eq!(
        core.inner.login_store.token("example", Some("read")),
        Ok(None)
    );
    let entry = core.inner.login_store.entry("example").unwrap();
    assert_eq!(entry.access_token, None);
    assert_eq!(entry.refresh_token, None);
    assert_eq!(entry.expires_at, None);
    let saved = saved_login(&temp, "example");
    assert!(saved["access_token"].is_null());
    assert!(saved["refresh_token"].is_null());
    assert!(saved["expires_at"].is_null());

    // 401과 invalid_client 본문도 같은 갈래로 지운다.
    {
        let mut state = fixture.state.lock().unwrap();
        state.refresh_status = Some(401);
        state.refresh_body = Some(json!({"error":"invalid_client"}).to_string());
    }
    core.inner
        .login_store
        .store("example", expired_login(&fixture, "refresh-2"))
        .unwrap();
    assert_eq!(
        core.inner.login_store.token("example", Some("read")),
        Ok(None)
    );
    assert_eq!(
        core.inner
            .login_store
            .entry("example")
            .unwrap()
            .refresh_token,
        None
    );

    // 서버가 거부하면 연결 요청은 로그인 필요로 이어진다.
    {
        let mut state = fixture.state.lock().unwrap();
        state.refresh_status = Some(400);
        state.refresh_body = Some(json!({"error":"invalid_grant"}).to_string());
    }
    core.inner
        .login_store
        .store("example", expired_login(&fixture, "refresh-3"))
        .unwrap();
    let result = crate::connections::request(
        &core.inner,
        &window,
        "api",
        HttpMethod::Get,
        "/old",
        Default::default(),
        None,
        ConnectionAccept::Json,
    );
    assert!(
        matches!(result, Err(crate::connections::RequestError::Login(permission)) if permission == "api")
    );
    assert_eq!(
        core.inner
            .login_store
            .entry("example")
            .unwrap()
            .refresh_token,
        None
    );
}
