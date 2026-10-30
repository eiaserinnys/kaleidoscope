use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use kaleidoscope_core::kaleidoscope_contract::{
    conversation::ConversationItemKind,
    local_agent::{LocalAgentPhase, LocalAgentSnapshot},
    CoreReply, CoreRequest, Rect,
};
use kaleidoscope_core::Core;
use serde_json::{json, Value};

use super::{call, record, screen};

const APP_ID: &str = "e2e-local-agent";
const AGENT_ID: &str = "test-agent";
const COMMAND: &str = "fake-agent";

fn snapshot(core: &Core, window_id: &str) -> Result<LocalAgentSnapshot, String> {
    match call(
        core,
        CoreRequest::LocalAgentAttach {
            window_id: window_id.into(),
        },
    )? {
        CoreReply::LocalAgentAttach { snapshot } => Ok(snapshot),
        reply => Err(format!("unexpected local agent attach response: {reply:?}")),
    }
}

fn wait_snapshot(
    core: &Core,
    window_id: &str,
    description: &str,
    ready: impl Fn(&LocalAgentSnapshot) -> bool,
) -> Result<LocalAgentSnapshot, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let current = snapshot(core, window_id)?;
        if ready(&current) {
            return Ok(current);
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "timed out waiting for {description}: {:?}",
                current.phase
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn wait_pid_file(path: &Path) -> Result<Vec<u32>, String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if path.is_file() {
            let mut contents = String::new();
            fs::File::open(path)
                .and_then(|mut file| file.read_to_string(&mut contents))
                .map_err(|error| error.to_string())?;
            let pids: Result<Vec<u32>, _> =
                contents.split_whitespace().map(str::parse::<u32>).collect();
            let pids = pids.map_err(|error| format!("invalid process log: {error}"))?;
            if pids.len() == 3 {
                if pids.contains(&0) {
                    return Err(format!("process log contains pid 0: {pids:?}"));
                }
                return Ok(pids);
            }
            if pids.len() > 3 {
                return Err(format!(
                    "expected wrapper, agent and grandchild pids, got {pids:?}"
                ));
            }
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "process log did not contain all three pids: {}",
                path.display()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn check_pathext(agent_bin: &Path) -> Result<PathBuf, String> {
    let wrapper = agent_bin.join(format!("{COMMAND}.cmd"));
    if !wrapper.is_file() {
        return Err(format!("command wrapper is missing: {}", wrapper.display()));
    }
    let path = env::var_os("PATH").ok_or("PATH is missing")?;
    let first_path = env::split_paths(&path).next();
    if first_path.as_deref() != Some(agent_bin) {
        return Err(format!("agent bin is not first in PATH: {first_path:?}"));
    }
    let pathext = env::var("PATHEXT").map_err(|_| "PATHEXT is missing")?;
    if !pathext
        .split(';')
        .any(|extension| extension.eq_ignore_ascii_case(".cmd"))
    {
        return Err(format!("PATHEXT does not include .CMD: {pathext}"));
    }
    Ok(wrapper)
}

fn app_definition(pid_log: &Path) -> Value {
    json!({
        "id": APP_ID,
        "name": "Local agent E2E",
        "requires": { "blocks": 8, "modules": { "files": 1, "local_agent": 1 } },
        "permissions": [
            { "module": "local_agent", "id": "run", "label": "Run test agent" },
            { "module": "files", "id": "work", "access": "readwrite", "label": "Test folder" }
        ],
        "state": { "agent_id": AGENT_ID },
        "ui": {
            "type": "agent_session",
            "permission": "run",
            "root": { "permission": "work" },
            "agents": [{
                "id": AGENT_ID,
                "name": "Test agent",
                "command": COMMAND,
                "args": ["tree"],
                "env": { "TEST_SCENARIO": "tree", "TEST_PID_LOG": pid_log.to_string_lossy() }
            }],
            "selected": { "state": "agent_id" },
            "on_select": { "set_state": "agent_id" }
        }
    })
}

fn open_and_run(
    core: &Core,
    desktop_id: &str,
    folder: &Path,
    out: &Path,
    log: &mut fs::File,
    label: &str,
) -> Result<(String, Vec<u32>), String> {
    let pid_log = out.join("local-agent.pids");
    if pid_log.exists() {
        fs::remove_file(&pid_log).map_err(|error| error.to_string())?;
    }
    call(
        core,
        CoreRequest::AppImport {
            definition_json: app_definition(&pid_log).to_string(),
        },
    )?;
    let window_id = match call(
        core,
        CoreRequest::WindowOpen {
            desktop_id: desktop_id.into(),
            app_id: APP_ID.into(),
            rect: Some(Rect {
                x: 64,
                y: 72,
                width: 820,
                height: 560,
            }),
        },
    )? {
        CoreReply::WindowOpen { window } => window.id,
        reply => return Err(format!("unexpected local agent window response: {reply:?}")),
    };
    let state = BTreeMap::from([("agent_id".into(), json!(AGENT_ID))]);
    call(
        core,
        CoreRequest::WindowSetState {
            window_id: window_id.clone(),
            state,
        },
    )?;
    let grant = match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: window_id.clone(),
            permission: "work".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(grant) } => grant,
        reply => return Err(format!("test folder was not granted: {reply:?}")),
    };
    if Path::new(&grant.root_path) != fs::canonicalize(folder).map_err(|e| e.to_string())? {
        return Err(format!("unexpected test folder grant: {grant:?}"));
    }
    let consent = snapshot(core, &window_id)?;
    if consent.phase != LocalAgentPhase::AwaitingPermission {
        return Err(format!(
            "expected execution consent, got {:?}",
            consent.phase
        ));
    }
    let execution = consent
        .execution
        .as_ref()
        .ok_or("execution consent is missing")?;
    if execution.command != COMMAND || execution.args != ["tree"] {
        return Err(format!("unexpected command in consent: {execution:?}"));
    }
    call(
        core,
        CoreRequest::LocalAgentAllow {
            window_id: window_id.clone(),
            spec_hash: execution.spec_hash.clone(),
        },
    )?;
    let ready = wait_snapshot(core, &window_id, "agent ready", |value| {
        value.phase == LocalAgentPhase::Ready
    })?;
    if !ready.agents.iter().any(|agent| agent.id == AGENT_ID)
        || ready.selected.as_deref() != Some(AGENT_ID)
    {
        return Err(format!("test agent selection was not retained: {ready:?}"));
    }
    record(
        log,
        "local-agent.ready",
        json!({ "label": label, "window_id": window_id, "generation": ready.generation }),
    )?;
    if label == "window-close" {
        screen(out, log, "local-agent-ready")?;
    }
    let generation = ready.generation.clone();
    let request_id = format!("e2e-{label}");
    match call(
        core,
        CoreRequest::LocalAgentSend {
            window_id: window_id.clone(),
            generation: generation.clone(),
            request_id: request_id.clone(),
            text: "hello".into(),
            attachments: vec![],
        },
    )? {
        CoreReply::LocalAgentSend {
            request_id: returned,
            ..
        } if returned == request_id => {}
        reply => return Err(format!("unexpected local agent send response: {reply:?}")),
    };
    wait_snapshot(core, &window_id, "test agent reply", |value| {
        value
            .history
            .iter()
            .any(|item| item.kind == ConversationItemKind::Assistant && item.text.contains("안녕"))
    })?;
    let pids = wait_pid_file(&pid_log)?;
    let visible = visible_windows(&pids)?;
    if !visible.is_empty() {
        return Err(format!(
            "local agent process has visible top-level windows: {visible:?}"
        ));
    }
    record(
        log,
        "local-agent.processes",
        json!({
            "label": label,
            "command": COMMAND,
            "wrapper": "fake-agent.cmd",
            "pids": pids,
            "wrapper_pid": pids[0],
            "agent_pid": pids[1],
            "grandchild_pid": pids[2],
            "visible_window_pids": visible,
            "passed": true
        }),
    )?;
    record(
        log,
        "local-agent.reply",
        json!({ "label": label, "generation": generation, "text": "안녕" }),
    )?;
    Ok((window_id, pids))
}

pub(super) fn scenario(core: &Core, out: &Path, log: &mut fs::File) -> Result<(), String> {
    let agent_bin = env::var_os("KALEIDOSCOPE_E2E_AGENT_BIN")
        .map(PathBuf::from)
        .ok_or("test agent bin path is missing")?;
    let wrapper = check_pathext(&agent_bin)?;
    let folder = env::var_os("KALEIDOSCOPE_E2E_PICK_FOLDER")
        .map(PathBuf::from)
        .ok_or("test folder path is missing")?;
    if !folder.is_dir() {
        return Err(format!("test folder is missing: {}", folder.display()));
    }
    record(
        log,
        "local-agent.pathext",
        json!({ "command": COMMAND, "wrapper": wrapper, "pathext_cmd": true }),
    )?;
    let shell = match call(core, CoreRequest::StateGet {})? {
        CoreReply::StateGet { snapshot } => snapshot,
        reply => return Err(format!("unexpected state response: {reply:?}")),
    };
    let workspace = shell
        .device
        .active_workspace_id
        .ok_or("no active workspace")?;
    let desktop_id = shell
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("no active desktop")?;

    let (closed_window, closed_pids) =
        open_and_run(core, desktop_id, &folder, out, log, "window-close")?;
    call(
        core,
        CoreRequest::WindowClose {
            window_id: closed_window.clone(),
        },
    )?;
    wait_processes_exit(&closed_pids)?;
    record(
        log,
        "local-agent.window-close",
        json!({ "window_id": closed_window, "pids": closed_pids, "passed": true }),
    )?;

    let (open_window, open_pids) = open_and_run(core, desktop_id, &folder, out, log, "app-exit")?;
    record(
        log,
        "local-agent.shell-exit-pending",
        json!({ "window_id": open_window, "pids": open_pids }),
    )?;
    record(
        log,
        "complete",
        json!({ "scenario": "local-agent", "passed": true }),
    )
}

fn wait_processes_exit(pids: &[u32]) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let mut alive = Vec::new();
        for pid in pids {
            if process_is_alive(*pid)? {
                alive.push(*pid);
            }
        }
        if alive.is_empty() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!("process tree survived window.close: {alive:?}"));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> Result<bool, String> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    let handle = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(handle) => handle,
        Err(error) if error.code() == windows::core::HRESULT::from_win32(87) => return Ok(false),
        Err(error) => return Err(format!("could not query process {pid}: {error}")),
    };
    let wait = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) }.map_err(|error| error.to_string())?;
    match wait {
        WAIT_OBJECT_0 => Ok(false),
        WAIT_TIMEOUT => Ok(true),
        WAIT_FAILED => Err(format!("could not wait for process {pid}")),
        other => Err(format!(
            "unexpected wait result for process {pid}: {other:?}"
        )),
    }
}

#[cfg(not(windows))]
fn process_is_alive(_pid: u32) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
fn visible_windows(pids: &[u32]) -> Result<Vec<u32>, String> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    };

    unsafe extern "system" fn visit(hwnd: HWND, context: LPARAM) -> BOOL {
        let pids = &mut *(context.0 as *mut Vec<u32>);
        if IsWindowVisible(hwnd).as_bool() {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 {
                pids.push(pid);
            }
        }
        BOOL(1)
    }

    let mut visible = Vec::new();
    unsafe { EnumWindows(Some(visit), LPARAM(&mut visible as *mut _ as isize)) }
        .map_err(|error| format!("could not enumerate top-level windows: {error}"))?;
    Ok(visible
        .into_iter()
        .filter(|pid| pids.contains(pid))
        .collect())
}

#[cfg(not(windows))]
fn visible_windows(_pids: &[u32]) -> Result<Vec<u32>, String> {
    Ok(Vec::new())
}
