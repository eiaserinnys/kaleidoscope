use super::*;

pub(super) fn snapshot(
    core: &Core,
) -> Result<kaleidoscope_core::kaleidoscope_contract::ShellSnapshot, String> {
    match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => Ok(snapshot),
        reply => Err(format!("unexpected state response: {reply:?}")),
    }
}

pub(super) fn open_window(
    core: &Core,
    desktop_id: &str,
    app_id: &str,
    rect: Rect,
) -> Result<String, String> {
    match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop_id.into(),
            app_id: app_id.into(),
            rect: Some(rect),
        },
    )? {
        CoreReply::WindowOpen { window } => Ok(window.id),
        reply => Err(format!("unexpected window.open response: {reply:?}")),
    }
}

pub(super) fn set_rect(core: &Core, window_id: &str, rect: Rect) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowSetRect {
            window_id: window_id.into(),
            rect,
        },
    )?;
    Ok(())
}

pub(super) fn set_agent_rect(
    app: &AppHandle,
    core: &Core,
    window_id: &str,
    rect: Rect,
) -> Result<(), String> {
    set_rect(core, window_id, rect)?;
    wait_window_rect(app, AGENT_APP_ID, rect)
}

pub(super) fn wait_window_rect(app: &AppHandle, app_id: &str, rect: Rect) -> Result<(), String> {
    ui::wait_dom(app, &format!(
        "const e=document.querySelector('[data-testid=\\\"app-window-{app_id}\\\"]');return !!e && parseFloat(e.style.width)==={} && parseFloat(e.style.height)==={};", rect.width, rect.height
    ), "window geometry updated")
}

pub(super) fn minimize(core: &Core, window_id: &str) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowMinimize {
            window_id: window_id.into(),
        },
    )?;
    Ok(())
}

pub(super) fn restore(core: &Core, window_id: &str) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowRestore {
            window_id: window_id.into(),
        },
    )?;
    Ok(())
}

pub(super) fn raise(core: &Core, window_id: &str) -> Result<(), String> {
    call(
        core,
        CoreRequest::WindowRaise {
            window_id: window_id.into(),
        },
    )?;
    Ok(())
}

pub(super) fn share(core: &Core, window_id: &str, on: bool) -> Result<(), String> {
    call(
        core,
        CoreRequest::ShareSet {
            window_id: window_id.into(),
            on,
        },
    )?;
    Ok(())
}

pub(super) fn import_definition(core: &Core, definition: Value) -> Result<(), String> {
    call(
        core,
        CoreRequest::AppImport {
            definition_json: definition.to_string(),
        },
    )?;
    Ok(())
}

pub(super) fn surface_definition(
    id: &str,
    name: &str,
    color: &str,
    marker: &str,
    scrollable: bool,
) -> Value {
    let content = if scrollable {
        format!(
            "<html><head><style>html,body{{margin:0;background:rgb(20,210,70);font:32px sans-serif}}body{{min-height:1600px}}.top{{height:1000px;background:rgb(20,210,70)}}.bottom{{height:600px;background:rgb(230,35,65)}}</style></head><body><div class='top'>A_TOP_MARKER</div><div class='bottom'>{marker}</div></body></html>"
        )
    } else {
        format!(
            "<html><head><style>html,body{{margin:0;min-height:100%;background:{color};font:32px sans-serif}}body{{height:100vh}}</style></head><body>{marker}</body></html>"
        )
    };
    let mut blocks = vec![json!({"type":"html_view","value":content})];
    let mut state = json!({});
    if scrollable {
        state = json!({"share_code": surface_code(false)});
        blocks.push(json!({"type":"code","value":{"state":"share_code"},"read_only":true}));
    }
    let sizes = if scrollable { vec![88, 12] } else { vec![100] };
    let ui = if scrollable {
        json!({"type":"split","direction":"row","sizes":sizes,"children":blocks})
    } else {
        blocks.remove(0)
    };
    json!({
        "id": id,
        "name": name,
        "requires": { "blocks": 11, "modules": {} },
        "permissions": [],
        "state": state,
        "ui": ui
    })
}

pub(super) fn surface_code(minimized: bool) -> String {
    let mut code = if minimized {
        "MINIMIZED_NEW_MARKER\n".to_owned()
    } else {
        String::new()
    };
    code.extend((1..=240).map(|line| format!("line {line:03}: share capture scroll marker\n")));
    code
}

pub(super) fn agent_definition(out: &Path, agent_bin: &Path) -> Value {
    let mut definition: Value = serde_json::from_str(include_str!("../../../../../apps/agent.json"))
        .expect("built-in agent app definition is valid JSON");
    definition["id"] = json!(AGENT_APP_ID);
    definition["name"] = json!("Share capture agent E2E");
    definition["storage"]["entries"][0]["default"] = json!([{
        "id": AGENT_ID,
        "name": "Test agent",
        "command": agent_bin.join("fake-agent.cmd").to_string_lossy(),
        "args": ["share"],
        "env": {
            "TEST_SCENARIO": "share-images",
            "KALEIDOSCOPE_E2E_IMAGE_DIR": out.join("share-isolate-images").to_string_lossy()
        }
    }]);
    definition
}

pub(super) fn query_layout(app: &AppHandle) -> Result<Layout, String> {
    let viewport = ui::evaluate(app, "return {width:innerWidth,height:innerHeight};")?;
    let width = viewport["width"]
        .as_u64()
        .ok_or("main viewport width is missing")? as u32;
    let height = viewport["height"]
        .as_u64()
        .ok_or("main viewport height is missing")? as u32;
    let a_width = min(600, width.saturating_sub(48).saturating_mul(52) / 100).max(440);
    let a_height = min(500, height.saturating_sub(96)).max(360);
    let right_width = min(430, width.saturating_sub(a_width).saturating_sub(48)).max(360);
    let right_x = (width as i32 - right_width as i32 - 24).max(a_width as i32 + 40);
    let agent_height = min(620, height.saturating_sub(40)).max(360);
    Ok(Layout {
        width,
        height,
        a: Rect {
            x: 24,
            y: 40,
            width: a_width,
            height: a_height,
        },
        b: Rect {
            x: 144,
            y: 100,
            width: min(430, a_width.saturating_sub(48)),
            height: min(410, a_height.saturating_sub(60)),
        },
        web: Rect {
            x: right_x,
            y: 120,
            width: right_width,
            height: min(420, height.saturating_sub(160)),
        },
        agent: Rect {
            x: right_x,
            y: 20,
            width: right_width,
            height: agent_height,
        },
    })
}

pub(super) fn wait_share_view(
    window_id: &str,
    occluded: bool,
    contains: Option<&str>,
) -> Result<kaleidoscope_core::kaleidoscope_contract::VisibleView, String> {
    let deadline = Instant::now() + WINDOW_READY_TIMEOUT;
    loop {
        if let Some(view) = ui::latest_share_view(window_id) {
            if view.visual
                && view.occluded == occluded
                && contains.is_none_or(|text| view.text.contains(text))
            {
                return Ok(view);
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "share.view did not reach occluded={occluded} for {window_id}"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

pub(super) fn wait_agent_process(core: &Core, window_id: &str) -> Result<(), String> {
    let deadline = Instant::now() + WINDOW_READY_TIMEOUT;
    loop {
        let process = match call(
            core,
            CoreRequest::ProcessAttach {
                window_id: window_id.into(),
                key: "main".into(),
            },
        )? {
            CoreReply::ProcessAttach { process } => process,
            reply => return Err(format!("unexpected process.attach response: {reply:?}")),
        };
        if let Some(process) = process {
            if let Some(exit) = process.exit {
                return Err(format!("test agent process exited: {exit:?}"));
            }
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("timed out waiting for the test agent process".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
}

pub(super) fn wait_prompt_images(directory: &Path, text: &str) -> Result<Vec<PathBuf>, String> {
    let deadline = Instant::now() + Duration::from_secs(45);
    let prompts = directory.join("prompts.jsonl");
    loop {
        if let Ok(contents) = fs::read_to_string(&prompts) {
            for line in contents.lines() {
                let Ok(prompt) = serde_json::from_str::<Value>(line) else {
                    continue;
                };
                let matches_text = prompt["text_blocks"]
                    .as_array()
                    .is_some_and(|blocks| blocks.iter().any(|block| block.as_str() == Some(text)));
                if matches_text {
                    let images = prompt["images"].as_array().ok_or("prompt images missing")?;
                    return images
                        .iter()
                        .map(|image| {
                            image
                                .as_str()
                                .map(|name| directory.join(name))
                                .ok_or_else(|| "invalid prompt image name".to_owned())
                        })
                        .collect();
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(format!("agent did not receive prompt {text:?}"));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

pub(super) fn expect_images(
    images: Vec<PathBuf>,
    count: usize,
    label: &str,
) -> Result<Vec<PathBuf>, String> {
    if images.len() != count {
        return Err(format!(
            "{label}: agent received {} images, expected {count}",
            images.len()
        ));
    }
    Ok(images)
}

pub(super) fn prompt_contains(
    directory: &Path,
    prompt_text: &str,
    marker: &str,
) -> Result<bool, String> {
    let contents =
        fs::read_to_string(directory.join("prompts.jsonl")).map_err(|error| error.to_string())?;
    for line in contents.lines() {
        let Ok(prompt) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(blocks) = prompt["text_blocks"].as_array() {
            if blocks
                .iter()
                .any(|block| block.as_str() == Some(prompt_text))
            {
                return Ok(blocks
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|block| block.contains(marker)));
            }
        }
    }
    Err(format!("agent prompt missing: {prompt_text}"))
}
