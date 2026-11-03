use super::*;
use kaleidoscope_contract::process::{ProcessSpec, ProcessStartResult};

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

#[cfg(unix)]
#[test]
fn consent_and_checkpoint_follow_the_window() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let definition = json!({
        "id":"process-fixture", "name":"프로세스 시험", "requires":{"blocks":16,"modules":{"assets":1,"client":3,"process":1,"files":1}},
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
        "id":"process-fixture", "name":"프로세스 시험", "requires":{"blocks":16,"modules":{"assets":1,"client":3,"process":1,"files":1}},
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
    let deadline = Instant::now() + Duration::from_secs(30);
    while !work.join("child.pid").exists() {
        assert!(Instant::now() < deadline, "자손 시작 시간 초과");
        thread::sleep(Duration::from_millis(50));
    }
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
            "자손 프로세스가 남았습니다: {pid}"
        );
        thread::sleep(Duration::from_millis(100));
    }
}
