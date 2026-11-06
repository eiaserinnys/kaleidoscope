use super::*;
use sha2::{Digest, Sha256};

fn post(
    client: &reqwest::blocking::Client,
    server: &kaleidoscope_orchestrator::EmbeddedServer,
    session: Option<&str>,
    body: Value,
) -> Result<(Option<String>, Vec<Value>), String> {
    let mut request = client
        .post(format!("{}/mcp", server.server_url))
        .bearer_auth(&server.token)
        .header("Accept", "application/json, text/event-stream")
        .json(&body);
    if let Some(session) = session {
        request = request.header("Mcp-Session-Id", session);
    }
    let response = request
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let session = response
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .or_else(|| session.map(str::to_owned));
    let raw = response.text().map_err(|e| e.to_string())?;
    let messages = if raw.trim_start().starts_with('{') {
        vec![serde_json::from_str(&raw).map_err(|e| e.to_string())?]
    } else {
        raw.lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok((session, messages))
}

pub(super) fn mcp(app: &AppHandle, name: &str, arguments: Value) -> Result<(), String> {
    let server = app.state::<kaleidoscope_orchestrator::EmbeddedServer>();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let (session, _) = post(
        &client,
        &server,
        None,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"realtime-e2e","version":"1"}
        }}),
    )?;
    post(
        &client,
        &server,
        session.as_deref(),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )?;
    let (_, messages) = post(
        &client,
        &server,
        session.as_deref(),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":name,"arguments":arguments}}),
    )?;
    let reply = messages.last().ok_or("MCP 응답 없음")?;
    if reply.get("error").is_some()
        || reply.get("result").is_none()
        || reply["result"]["isError"] == true
    {
        return Err(format!("시험 준비 MCP {name} 실패: {reply}"));
    }
    Ok(())
}

pub(super) fn install(app: &AppHandle, core: &Core, origin: &str) -> Result<(), String> {
    mcp(
        app,
        "set_connection",
        json!({"name":"fixture-echo","kind":"oauth","base_url":origin,"writable":true,"paths":["/socket"]}),
    )?;
    let direct = format!("{}/blocked", origin.replacen("http:", "ws:", 1));
    let source = format!(
        "{}\n(() => {{
        const app = window.kaleidoscope;
        app.handle('reload_frame', () => location.reload());
        try {{
            const socket = new WebSocket({});
            socket.onopen = () => {{ app.publish({{csp:'접속됨'}}); socket.close(); }};
            socket.onerror = () => app.publish({{csp:'차단됨'}});
        }} catch (_) {{ app.publish({{csp:'차단됨'}}); }}
    }})();",
        include_str!("../../../../../ui/e2e/fixtures/realtime/client.js"),
        serde_json::to_string(&direct).unwrap()
    );
    mcp(
        app,
        "upload_asset",
        json!({
            "id":"realtime-fixture-client","version":1,"format":"javascript", "sha256":format!("{:x}", Sha256::digest(source.as_bytes())),
            "source":"ui/e2e/fixtures/realtime/client.js","license":"MIT","data_base64":STANDARD.encode(source.as_bytes())
        }),
    )?;
    let mut definition: Value = serde_json::from_str(include_str!(
        "../../../../../ui/e2e/fixtures/realtime/app.json"
    ))
    .map_err(|e| e.to_string())?;
    definition["client"]["actions"]
        .as_array_mut()
        .unwrap()
        .push(json!("reload_frame"));
    definition["client"]["outputs"]["csp"] = json!({"default":"대기"});
    let children = definition["ui"]["children"].as_array_mut().unwrap();
    children.push(json!({"type":"text","value":{"client":"csp"}}));
    children.push(
        json!({"type":"button","label":"프레임 리로드","on_click":{"client":"reload_frame"}}),
    );
    call(
        core,
        CoreRequest::AppImport {
            definition_json: definition.to_string(),
        },
    )?;
    Ok(())
}
