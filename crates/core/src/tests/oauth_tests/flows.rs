use super::*;

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
    assert_eq!(error.message, "로그인을 마치지 않았습니다");
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
