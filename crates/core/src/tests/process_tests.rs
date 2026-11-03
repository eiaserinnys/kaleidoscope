use super::*;
use kaleidoscope_contract::process::{ProcessSpec, ProcessStartResult};

#[test]
fn tools_service_is_supported_before_window_validation() {
    let temp = TempDir::new().unwrap();
    let core = open_core(temp.path(), vec![], &Arc::new(FakeHost::default()));
    let error = core.handle(CoreRequest::ProcessStart {
        window_id: "missing".into(), key: "main".into(), permission: "run".into(),
        cwd_permission: "work".into(), services: vec!["tools".into()],
        spec: ProcessSpec { name: "시험".into(), command: "cat".into(), args: vec![], env: BTreeMap::new() },
    }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("PROCESS_START_WINDOW_MISSING"));
}

#[test]
fn binary_process_write_identifies_each_invalid_checkpoint() {
    let temp = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core(temp.path(), vec![], &host);
    for (body, expected) in [
        (vec![], "PROCESS_WRITE_HEADER_MISSING"),
        (vec![0, 0, 0, 2, b'{'], "PROCESS_WRITE_CHECKPOINT_TRUNCATED"),
        (
            vec![0, 0, 0, 1, b'x'],
            "PROCESS_WRITE_CHECKPOINT_JSON_INVALID",
        ),
    ] {
        let error = core
            .client_binary("process.write", "window", "handle", &body)
            .unwrap_err();
        assert_eq!(error.id.as_deref(), Some(expected));
    }
}

#[cfg(target_os = "linux")]
#[test]
fn window_close_stops_a_running_process_and_descendant() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = json!({
        "id":"process-fixture", "name":"프로세스 시험", "requires":{"blocks":17,"modules":{"assets":1,"client":3,"process":1,"files":1}},
        "permissions":[{"module":"process","id":"run","label":"실행"},{"module":"files","id":"work","label":"작업","access":"readwrite"}],
        "assets":[{"id":"client-code","version":1}], "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"process_permissions":["run"]},
        "ui":{"type":"text","value":"시험"}
    });
    let core = Arc::new(open_core(temp.path(), vec![definition.to_string()], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "process-fixture");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let (consent_tx, consent_rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::ProcessPermission { request_id, .. } = event {
            let _ = consent_tx.send(request_id.clone());
        }
    }));
    let starter = core.clone();
    let start_window = window.clone();
    let task = thread::spawn(move || {
        starter
            .handle(CoreRequest::ProcessStart {
                window_id: start_window,
                key: "main".into(),
                permission: "run".into(),
                cwd_permission: "work".into(),
                services: vec![],
                spec: ProcessSpec {
                    name: "시험".into(),
                    command: "sh".into(),
                    args: vec![
                        "-c".into(),
                        "sleep 120 & echo $$ $! > pids; while :; do printf 'output\\n'; done"
                            .into(),
                    ],
                    env: BTreeMap::new(),
                },
            })
            .unwrap()
    });
    core.handle(CoreRequest::ProcessRespondPermission {
        window_id: window.clone(),
        request_id: consent_rx.recv_timeout(Duration::from_secs(10)).unwrap(),
        allow: true,
    })
    .unwrap();
    assert!(matches!(
        task.join().unwrap(),
        CoreReply::ProcessStart {
            result: ProcessStartResult::Started { .. }
        }
    ));
    let deadline = Instant::now() + Duration::from_secs(10);
    let pids = loop {
        if let Ok(text) = fs::read_to_string(folder.path().join("pids")) {
            let ids: Vec<u32> = text
                .split_whitespace()
                .filter_map(|value| value.parse().ok())
                .collect();
            if ids.len() == 2 {
                break ids;
            }
        }
        assert!(Instant::now() < deadline, "자식 시작 시간 초과");
        thread::sleep(Duration::from_millis(10));
    };
    core.handle(CoreRequest::WindowClose { window_id: window })
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let running: Vec<_> = pids
            .iter()
            .copied()
            .filter(|pid| {
                fs::read_to_string(format!("/proc/{pid}/stat"))
                    .ok()
                    .and_then(|stat| stat.split_whitespace().nth(2).map(str::to_owned))
                    .is_some_and(|state| state != "Z")
            })
            .collect();
        if running.is_empty() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "창 닫기 뒤 남은 프로세스: {running:?}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(unix)]
#[test]
fn consent_and_checkpoint_follow_the_window() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = json!({
        "id":"process-fixture", "name":"프로세스 시험", "requires":{"blocks":17,"modules":{"assets":1,"client":3,"process":1,"files":1}},
        "permissions":[{"module":"process","id":"run","label":"실행"},{"module":"files","id":"work","label":"작업","access":"readwrite"}],
        "assets":[{"id":"client-code","version":1}], "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"process_permissions":["run"]},
        "ui":{"type":"text","value":"시험"}
    });
    let core = Arc::new(open_core(temp.path(), vec![definition.to_string()], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "process-fixture");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::ProcessPermission { request_id, .. } = event {
            let _ = tx.send(request_id.clone());
        }
    }));
    let spec = ProcessSpec {
        name: "시험".into(),
        command: "cat".into(),
        args: vec![],
        env: BTreeMap::new(),
    };
    let repeated_spec = spec.clone();
    let start_core = core.clone();
    let start_window = window.clone();
    let task = thread::spawn(move || {
        start_core
            .handle(CoreRequest::ProcessStart {
                window_id: start_window,
                key: "main".into(),
                permission: "run".into(),
                spec,
                cwd_permission: "work".into(),
                services: vec![],
            })
            .unwrap()
    });
    let request_id = rx.recv_timeout(Duration::from_secs(10)).expect("허용 요청");
    core.handle(CoreRequest::ProcessRespondPermission {
        window_id: window.clone(),
        request_id,
        allow: true,
    })
    .unwrap();
    let CoreReply::ProcessStart {
        result: ProcessStartResult::Started { handle, .. },
    } = task.join().unwrap()
    else {
        panic!("시작 결과")
    };
    core.handle(CoreRequest::ProcessWrite {
        window_id: window.clone(),
        handle: handle.clone(),
        bytes: b"abc\n".to_vec(),
        checkpoint: Some(json!({"write":1})),
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let next = loop {
        let CoreReply::ProcessRead { bytes, next, .. } = core
            .handle(CoreRequest::ProcessRead {
                window_id: window.clone(),
                handle: handle.clone(),
                after: 0,
                max_bytes: 1024,
            })
            .unwrap()
        else {
            panic!("읽기 결과")
        };
        if !bytes.is_empty() {
            assert_eq!(bytes, b"abc\n");
            break next;
        }
        assert!(Instant::now() < deadline, "출력 대기 시간 초과");
        thread::sleep(Duration::from_millis(10));
    };
    core.handle(CoreRequest::ProcessAck {
        window_id: window.clone(),
        handle: handle.clone(),
        after: next,
        checkpoint: Some(json!({"read":1})),
    })
    .unwrap();
    let CoreReply::ProcessAttach {
        process: Some(attached),
    } = core
        .handle(CoreRequest::ProcessAttach {
            window_id: window.clone(),
            key: "main".into(),
        })
        .unwrap()
    else {
        panic!("재연결 결과")
    };
    assert_eq!(attached.handle, handle);
    assert_eq!(attached.after, next);
    assert_eq!(attached.checkpoint, Some(json!({"read":1})));
    let metadata = br#"{"binary":true}"#;
    let mut packet = (metadata.len() as u32).to_be_bytes().to_vec();
    packet.extend_from_slice(metadata);
    packet.extend_from_slice(b"binary\n");
    core.client_binary("process.write", &window, &handle, &packet)
        .unwrap();
    let CoreReply::ProcessAttach {
        process: Some(attached),
    } = core
        .handle(CoreRequest::ProcessAttach {
            window_id: window.clone(),
            key: "main".into(),
        })
        .unwrap()
    else {
        panic!("재연결 결과")
    };
    assert_eq!(attached.checkpoint, Some(json!({"binary":true})));
    assert!(core
        .handle(CoreRequest::ProcessRead {
            window_id: "other".into(),
            handle: handle.clone(),
            after: next,
            max_bytes: 1
        })
        .is_err());
    core.handle(CoreRequest::ProcessStop {
        window_id: window.clone(),
        handle,
    })
    .unwrap();
    let same_core = core.clone();
    let same_window = window.clone();
    let same_spec = repeated_spec.clone();
    let (done_tx, done_rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = done_tx.send(same_core.handle(CoreRequest::ProcessStart {
            window_id: same_window,
            key: "main".into(),
            permission: "run".into(),
            spec: same_spec,
            cwd_permission: "work".into(),
            services: vec![],
        }));
    });
    let CoreReply::ProcessStart {
        result: ProcessStartResult::Started { handle: again, .. },
    } = done_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("같은 명세는 다시 묻지 않아야 합니다")
        .unwrap()
    else {
        panic!("재시작 결과")
    };
    assert!(rx.try_recv().is_err(), "같은 명세를 다시 물었습니다");
    core.handle(CoreRequest::ProcessStop {
        window_id: window.clone(),
        handle: again,
    })
    .unwrap();
    let mut changed_env = repeated_spec.clone();
    changed_env.env.insert("FIXTURE".into(), "changed".into());
    let mut changed_args = repeated_spec;
    changed_args.args.push("changed".into());
    for changed in [changed_env, changed_args] {
        let changed_core = core.clone();
        let changed_window = window.clone();
        let changed_task = thread::spawn(move || {
            changed_core
                .handle(CoreRequest::ProcessStart {
                    window_id: changed_window,
                    key: "main".into(),
                    permission: "run".into(),
                    spec: changed,
                    cwd_permission: "work".into(),
                    services: vec![],
                })
                .unwrap()
        });
        let request_id = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("바뀐 명세의 허용 요청");
        core.handle(CoreRequest::ProcessRespondPermission {
            window_id: window.clone(),
            request_id,
            allow: false,
        })
        .unwrap();
        assert!(
            matches!(changed_task.join().unwrap(), CoreReply::ProcessStart { result: ProcessStartResult::Cancelled { status } } if status == "cancelled")
        );
    }
    assert!(matches!(
        core.handle(CoreRequest::ProcessAttach {
            window_id: window,
            key: "main".into()
        })
        .unwrap(),
        CoreReply::ProcessAttach { process: None }
    ));
}

#[cfg(windows)]
fn windows_process_diagnostics(
    core: &Core,
    window: &str,
    handle: &str,
    work: &Path,
    requested_at: std::time::SystemTime,
    started: Instant,
    spawn_returned: Duration,
) -> String {
    let files: Vec<_> = fs::read_dir(work)
        .map(|entries| entries.filter_map(Result::ok).map(|entry| entry.file_name()).collect())
        .unwrap_or_default();
    let output = core.handle(CoreRequest::ProcessRead {
        window_id: window.into(),
        handle: handle.into(),
        after: 0,
        max_bytes: 64 * 1024,
    });
    match output {
        Ok(CoreReply::ProcessRead { bytes, stderr_tail, exit, .. }) => format!(
            "요청 시각: {requested_at:?}, 경과: {:?}, 시작 응답: {spawn_returned:?}\n파일 목록: {files:?}\nstdout:\n{}\nstderr:\n{}\n종료: {exit:?}",
            started.elapsed(), String::from_utf8_lossy(&bytes), String::from_utf8_lossy(&stderr_tail)
        ),
        other => format!("출력 조회 실패: {other:?}, 요청 시각: {requested_at:?}, 경과: {:?}, 시작 응답: {spawn_returned:?}, 파일 목록: {files:?}", started.elapsed()),
    }
}

#[cfg(windows)]
#[test]
fn windows_process_cmd_terminates_descendants_in_unicode_cwd() {
    let temp = TempDir::new().unwrap();
    let work = temp.path().join("한글 작업 폴더");
    fs::create_dir(&work).unwrap();
    fs::write(
        work.join("child.cmd"),
        include_str!("fixtures/process/child.cmd").replace('\n', "\r\n"),
    )
    .unwrap();
    fs::write(
        work.join("worker.ps1"),
        include_str!("fixtures/process/worker.ps1"),
    )
    .unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(work.clone()));
    let definition = json!({
        "id":"process-fixture", "name":"프로세스 시험", "requires":{"blocks":17,"modules":{"assets":1,"client":3,"process":1,"files":1}},
        "permissions":[{"module":"process","id":"run","label":"실행"},{"module":"files","id":"work","label":"작업","access":"readwrite"}],
        "assets":[{"id":"client-code","version":1}], "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"process_permissions":["run"]}, "ui":{"type":"text","value":"시험"}
    });
    let data = temp.path().join("data");
    let core = Arc::new(open_core(&data, vec![definition.to_string()], &host));
    let (_, desktop) = active_ids(&core);
    let window = open_window(&core, &desktop, "process-fixture");
    core.handle(CoreRequest::FilesPickFolder {
        window_id: window.clone(),
        permission: "work".into(),
    })
    .unwrap();
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::ProcessPermission { request_id, .. } = event {
            let _ = tx.send(request_id.clone());
        }
    }));
    let spec = ProcessSpec {
        name: "시험".into(),
        command: work.join("child.cmd").to_string_lossy().into_owned(),
        args: vec![],
        env: BTreeMap::new(),
    };
    let owner = core.clone();
    let start_window = window.clone();
    let requested_at = std::time::SystemTime::now();
    let started = Instant::now();
    let task = thread::spawn(move || {
        owner
            .handle(CoreRequest::ProcessStart {
                window_id: start_window,
                key: "main".into(),
                permission: "run".into(),
                spec,
                cwd_permission: "work".into(),
                services: vec![],
            })
            .unwrap()
    });
    let request_id = rx.recv_timeout(Duration::from_secs(15)).expect("허용 요청");
    core.handle(CoreRequest::ProcessRespondPermission {
        window_id: window.clone(),
        request_id,
        allow: true,
    })
    .unwrap();
    let CoreReply::ProcessStart {
        result: ProcessStartResult::Started { handle, .. },
    } = task.join().unwrap()
    else {
        panic!("시작 결과")
    };
    let spawn_returned = started.elapsed();
    // 이 시험은 멈춤이 자손까지 끝내는지를 본다. CI 러너에서 PowerShell 첫 기동이
    // 30초를 넘긴 일이 있어(cmd_started 뒤 worker_started 없음) 기동 대기는 넉넉히 둔다.
    let deadline = Instant::now() + Duration::from_secs(120);
    while !work.join("child.pid").exists() {
        assert!(Instant::now() < deadline, "자손 시작 시간 초과\n{}", windows_process_diagnostics(&core, &window, &handle, &work, requested_at, started, spawn_returned));
        thread::sleep(Duration::from_millis(50));
    }
    let diagnostics = windows_process_diagnostics(&core, &window, &handle, &work, requested_at, started, spawn_returned);
    eprintln!("자손 확인 진단:\n{diagnostics}");
    let pid = fs::read_to_string(work.join("child.pid")).unwrap();
    let cwd = fs::read_to_string(work.join("cwd.txt")).unwrap();
    assert_eq!(
        fs::canonicalize(cwd.trim_start_matches('\u{feff}')).unwrap(),
        fs::canonicalize(&work).unwrap()
    );
    core.handle(CoreRequest::ProcessStop {
        window_id: window,
        handle,
    })
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let output = std::process::Command::new("tasklist.exe")
            .args(["/FI", &format!("PID eq {}", pid.trim()), "/NH"])
            .output()
            .unwrap();
        if !String::from_utf8_lossy(&output.stdout).contains(pid.trim()) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "자손 프로세스가 남았습니다: {pid}\n{diagnostics}"
        );
        thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(unix)]
#[test]
fn tool_services_follow_process_window_and_server_lifetimes() {
    use kaleidoscope_contract::{process::spec_hash, ServerMode};
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = json!({
        "id":"process-services-fixture", "name":"서비스 시험", "requires":{"blocks":18,"modules":{"assets":1,"client":4,"process":1,"files":1}},
        "permissions":[{"module":"process","id":"run","label":"실행"},{"module":"files","id":"work","label":"작업","access":"readwrite"}],
        "assets":[{"id":"client-code","version":1}], "client":{"runtime":"javascript","entry":{"id":"client-code","version":1},"process_permissions":["run"]},
        "ui":{"type":"text","value":"시험"}
    });
    let mut old_definition = definition.clone();
    old_definition["id"] = json!("process-services-old");
    old_definition["requires"]["blocks"] = json!(17);
    old_definition["requires"]["modules"]["client"] = json!(3);
    let core = open_core(temp.path(), vec![definition.to_string(), old_definition.to_string()], &host);
    let (_, desktop) = active_ids(&core);
    let old_window = open_window(&core, &desktop, "process-services-old");
    let error = core.handle(CoreRequest::ProcessStart { window_id: old_window, key: "old".into(), permission: "run".into(), cwd_permission: "work".into(), services: vec!["tools".into()], spec: ProcessSpec { name: "시험".into(), command: "cat".into(), args: vec![], env: BTreeMap::new() } }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("PROCESS_START_SERVICE_VERSION_REQUIRED"));
    let link = LinkFile { revoked: false, mode: ServerMode::Remote, format: 1,
        server_url: "http://127.0.0.1:1".into(), device_id: "device".into(), device_name: "시험".into(), token: "secret-device-token".into() };
    *core.inner.link_file.lock().unwrap() = Some(link.clone());
    core.inner.state.lock().unwrap().link = LinkStatus::Connected { mode: ServerMode::Remote, server_url: link.server_url.clone(), device_name: "시험".into() };
    let spec = ProcessSpec { name: "시험".into(), command: "cat".into(), args: vec![], env: BTreeMap::new() };
    core.inner.state.lock().unwrap().device.process_access.push(kaleidoscope_contract::process::ProcessAccess {
        app_id: "process-services-fixture".into(), permission: "run".into(), spec_hash: spec_hash(&spec), granted_at: "시험".into(),
    });
    let start = |key: &str| {
        let window = open_window(&core, &desktop, "process-services-fixture");
        core.handle(CoreRequest::FilesPickFolder { window_id: window.clone(), permission: "work".into() }).unwrap();
        let reply = core.handle(CoreRequest::ProcessStart { window_id: window.clone(), key: key.into(), permission: "run".into(), cwd_permission: "work".into(), spec: spec.clone(), services: vec!["tools".into()] }).unwrap();
        let serialized = serde_json::to_string(&reply).unwrap();
        assert!(!serialized.contains("secret-device-token"));
        let CoreReply::ProcessStart { result: ProcessStartResult::Started { handle, services, .. } } = reply else { panic!("실행 결과가 없다") };
        let url = services["tools"].clone().unwrap();
        let attached = core.handle(CoreRequest::ProcessAttach { window_id: window.clone(), key: key.into() }).unwrap();
        assert!(!serde_json::to_string(&attached).unwrap().contains("secret-device-token"));
        assert!(matches!(attached, CoreReply::ProcessAttach { process: Some(snapshot) } if snapshot.services["tools"].as_deref() == Some(url.as_str())));
        (window, handle, url)
    };
    let http = reqwest::blocking::Client::new();
    let (window, handle, old) = start("stop");
    core.handle(CoreRequest::ProcessStop { window_id: window, handle }).unwrap();
    assert_eq!(http.get(&old).send().unwrap().status(), 403);
    let (window, _, old) = start("close");
    core.handle(CoreRequest::WindowClose { window_id: window }).unwrap();
    assert_eq!(http.get(&old).send().unwrap().status(), 403);
    let (window, handle, old) = start("switch");
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| { if let CoreEvent::ProcessServicesChanged { window_id, handle } = event { let _ = tx.send((window_id.clone(), handle.clone(), serde_json::to_string(event).unwrap())); } }));
    let replacement = LinkFile { server_url: "http://127.0.0.1:2".into(), ..link.clone() };
    crate::server_switch::activate(&core.inner, replacement.clone(), 0).unwrap();
    let (event_window, event_handle, event) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!((event_window, event_handle), (window.clone(), handle.clone()));
    assert!(!event.contains("secret-device-token"));
    assert_eq!(http.get(&old).send().unwrap().status(), 403);
    crate::server_switch::activate(&core.inner, link, 0).unwrap();
    let restored = core.handle(CoreRequest::ProcessAttach { window_id: window.clone(), key: "switch".into() }).unwrap();
    assert!(matches!(restored, CoreReply::ProcessAttach { process: Some(process) } if process.services["tools"].is_none()));
    let (tx, rx) = mpsc::channel();
    core.subscribe(Box::new(move |event| { if let CoreEvent::ProcessServicesChanged { window_id, handle } = event { let _ = tx.send((window_id.clone(), handle.clone())); } }));
    crate::server_switch::activate(&core.inner, replacement, 0).unwrap();
    assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), (window, handle));
    core.shutdown();
}
