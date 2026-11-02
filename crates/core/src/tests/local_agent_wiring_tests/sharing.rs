use super::*;

#[test]
fn separate_windows_keep_separate_share_contexts_and_lifetimes() {
    let temp = TempDir::new().unwrap();
    let folder = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    host.choose(Some(folder.path().into()));
    let core = open_core(
        temp.path(),
        vec![fake_definition(temp.path()).to_string()],
        &host,
    );
    let (_, desktop) = active_ids(&core);
    let shared = open_window(&core, &desktop, "md-editor");
    core.handle(CoreRequest::ShareSet {
        window_id: shared.clone(),
        on: true,
    })
    .unwrap();
    core.handle(CoreRequest::ShareView {
        window_id: shared.clone(),
        view: kaleidoscope_contract::VisibleView {
            text:
                "공유 첫 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄\n여섯째 줄\n일곱째 줄\n마지막 줄"
                    .into(),
            visual: false,
            occluded: false,
            image_base64: None,
            bounds: Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
        },
    })
    .unwrap();
    let mut windows = Vec::new();
    for _ in 0..2 {
        let window = open_window(&core, &desktop, "test-agent");
        attach(&core, &window);
        select(&core, &window, "one");
        until(&core, &window, LocalAgentPhase::ChoosingFolder);
        core.handle(CoreRequest::FilesPickFolder {
            window_id: window.clone(),
            permission: "work".into(),
        })
        .unwrap();
        let snapshot = attach(&core, &window);
        let ready = if snapshot.phase == LocalAgentPhase::AwaitingPermission {
            allow_and_start(&core, &window)
        } else {
            until(&core, &window, LocalAgentPhase::Ready)
        };
        windows.push((window, ready.generation));
    }
    for (index, (window, generation)) in windows.iter().enumerate() {
        core.handle(CoreRequest::LocalAgentSend {
            window_id: window.clone(),
            generation: generation.clone(),
            request_id: format!("message-{index}"),
            text: "안부".into(),
            attachments: vec![],
        })
        .unwrap();
        wait_for(|| attach(&core, window).history.len() >= 2);
        assert_eq!(attach(&core, window).history[0].text, "안부");
    }
    let prompts: Vec<_> = calls(&temp.path().join("calls"))
        .into_iter()
        .filter(|v| v["method"] == "session/prompt")
        .collect();
    assert_eq!(prompts.len(), 2);
    assert!(prompts
        .iter()
        .all(|p| p["params"]["prompt"].to_string().contains("공유 첫 줄")));
    core.handle(CoreRequest::ShareView {
        window_id: shared,
        view: kaleidoscope_contract::VisibleView {
            text:
                "공유 첫 줄\n둘째 줄\n셋째 줄\n바뀐 줄\n다섯째 줄\n여섯째 줄\n일곱째 줄\n마지막 줄"
                    .into(),
            visual: false,
            occluded: false,
            image_base64: None,
            bounds: Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
        },
    })
    .unwrap();
    for (index, (window, generation)) in windows.iter().enumerate() {
        until(&core, window, LocalAgentPhase::Ready);
        core.handle(CoreRequest::LocalAgentSend {
            window_id: window.clone(),
            generation: generation.clone(),
            request_id: format!("second-{index}"),
            text: "다시".into(),
            attachments: vec![],
        })
        .unwrap();
        wait_for(|| attach(&core, window).history.len() >= 4);
    }
    let prompts: Vec<_> = calls(&temp.path().join("calls"))
        .into_iter()
        .filter(|v| v["method"] == "session/prompt")
        .collect();
    assert_eq!(prompts.len(), 4);
    assert!(prompts[2..].iter().all(|p| {
        let value = p["params"]["prompt"].to_string();
        value.contains("바뀐 줄") && !value.contains("공유 첫 줄")
    }));
    core.handle(CoreRequest::LocalAgentDetach {
        window_id: windows[1].0.clone(),
    })
    .unwrap();
    core.handle(CoreRequest::WindowClose {
        window_id: windows[0].0.clone(),
    })
    .unwrap();
    assert_eq!(attach(&core, &windows[1].0).generation, windows[1].1);
    assert_eq!(attach(&core, &windows[1].0).phase, LocalAgentPhase::Ready);
    core.shutdown();
}
