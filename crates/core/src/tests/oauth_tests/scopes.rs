use super::*;

#[test]
fn scope_growth_requires_login_then_registers_again_with_new_scopes() {
    let fixture = OAuthFixture::start();
    let temp = TempDir::new().unwrap();
    let host = Arc::new(BrowserHost::default());
    let (core, window) = make_core(host.clone(), &temp, &fixture, ConnectionKind::Oauth);
    login(&core, &window).unwrap();
    assert_eq!(fixture.state.lock().unwrap().registrations, 1);

    core.inner.connections.lock().unwrap()[0].scopes = Some("read write".into());
    host.expected_scope
        .lock()
        .unwrap()
        .replace("read write".into());

    let (sender, receiver) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        let _ = sender.send(event.clone());
    }));
    let requests_before = fixture.state.lock().unwrap().resource_requests;
    core.handle(CoreRequest::DataAttach {
        window_id: window.clone(),
        dormant: vec![],
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut login_required = false;
    let mut last_status = None;
    while Instant::now() < deadline {
        if let Ok(CoreEvent::DataUpdate { view, .. }) =
            receiver.recv_timeout(Duration::from_millis(100))
        {
            last_status = view.sources.get("items").cloned();
            if matches!(
                view.sources.get("items"),
                Some(SourceStatus::LoginRequired { .. })
            ) {
                login_required = true;
                break;
            }
        }
    }
    assert!(
        login_required,
        "범위가 늘면 원천이 로그인 필요가 된다: status={last_status:?}"
    );
    assert_eq!(
        fixture.state.lock().unwrap().resource_requests,
        requests_before,
        "옛 토큰으로 자원 요청을 보내지 않는다"
    );

    login(&core, &window).unwrap();
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
        "새 범위로 로그인하면 원천이 준비된다: status={last_status:?}"
    );
    {
        let state = fixture.state.lock().unwrap();
        assert_eq!(state.registrations, 2);
        assert_eq!(
            state.registration_scopes,
            vec!["read".to_string(), "read write".to_string()]
        );
    }
    let record: Value =
        serde_json::from_str(&std::fs::read_to_string(temp.path().join("logins.json")).unwrap())
            .unwrap();
    assert_eq!(record["example"]["scopes"], "read write");
}
