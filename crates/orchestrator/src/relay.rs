use super::*;
use crate::agent::{initial_instruction, AgentRow};
use kaleidoscope_contract::{AgentItemKind, AgentUpdate};

const SILENT: &str = "[SILENT]";
const CACHE_MESSAGE: &str = "캐시 유지용 호출입니다. 도구를 쓰지 말고 '[SILENT]'만 답하십시오.";

impl AppState {
    pub(super) fn start_relay(&self, row: AgentRow) {
        if self.0.soulstream.is_none() {
            return;
        }
        let state = self.clone();
        tokio::spawn(async move { relay(state, row).await });
    }
}

#[derive(Default)]
struct Frame {
    event: String,
    id: Option<i64>,
    data: Vec<String>,
}
#[derive(Default)]
struct Projection {
    text: String,
    sent: usize,
}

async fn relay(state: AppState, row: AgentRow) {
    let soul = state.0.soulstream.as_ref().unwrap();
    let initial = initial_instruction(&row.workspace_name, &row.workspace_id);
    let mut cursor = row.cursor;
    let mut delay = 2;
    let mut projection = Projection::default();
    loop {
        let result = tokio::time::timeout(
            Duration::from_secs(120),
            soul.client
                .get(format!(
                    "{}/api/sessions/{}/events",
                    soul.url, row.session_id
                ))
                .bearer_auth(&soul.token)
                .header("Accept", "text/event-stream")
                .header("Last-Event-ID", cursor.max(1).to_string())
                .send(),
        )
        .await;
        if let Ok(Ok(mut reply)) = result {
            if reply.status().is_success() {
                let mut bytes = Vec::new();
                let mut frame = Frame::default();
                loop {
                    let chunk = tokio::time::timeout(Duration::from_secs(120), reply.chunk()).await;
                    let Ok(Ok(Some(chunk))) = chunk else { break };
                    delay = 2;
                    bytes.extend_from_slice(&chunk);
                    while let Some(end) = bytes.iter().position(|b| *b == b'\n') {
                        let line: Vec<u8> = bytes.drain(..=end).collect();
                        let line = String::from_utf8_lossy(&line);
                        let line = line.trim_end_matches(['\r', '\n']);
                        if line.is_empty() {
                            if !frame.data.is_empty() {
                                if let Ok(value) =
                                    serde_json::from_str::<Value>(&frame.data.join("\n"))
                                {
                                    let name = if frame.event.is_empty() {
                                        value["type"].as_str().unwrap_or("")
                                    } else {
                                        &frame.event
                                    };
                                    if let Err(error) = process(
                                        &state,
                                        &row.workspace_id,
                                        &initial,
                                        name,
                                        &value,
                                        &mut projection,
                                    ) {
                                        eprintln!(
                                            "PAS 이벤트를 저장하지 못했습니다: {}",
                                            error.message
                                        );
                                        break;
                                    }
                                    if let Some(id) = frame.id.filter(|id| *id > cursor) {
                                        if let Err(error) = state.cursor(&row.workspace_id, id) {
                                            eprintln!(
                                                "PAS 커서를 저장하지 못했습니다: {}",
                                                error.message
                                            );
                                            break;
                                        }
                                        cursor = id;
                                    }
                                }
                            }
                            frame = Frame::default();
                        } else if let Some(value) = line.strip_prefix("event:") {
                            frame.event = value.trim_start_matches(' ').into();
                        } else if let Some(value) = line.strip_prefix("id:") {
                            frame.id = value.trim().parse().ok();
                        } else if let Some(value) = line.strip_prefix("data:") {
                            frame
                                .data
                                .push(value.strip_prefix(' ').unwrap_or(value).into());
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(delay)).await;
        delay = (delay * 2).min(30);
    }
}

fn process(
    state: &AppState,
    workspace: &str,
    initial: &str,
    event: &str,
    data: &Value,
    projection: &mut Projection,
) -> Result<(), CoreError> {
    let item = |kind, text: &str| -> Result<(), CoreError> {
        let item = state.add_item(workspace, kind, text)?;
        state.emit(workspace, AgentUpdate::Item { item });
        Ok(())
    };
    match event {
        "user_message" => {
            let source = data["caller_info"]["source"].as_str().unwrap_or("");
            let text = data["text"].as_str().unwrap_or("");
            if ["kaleidoscope", "browser", "soul-app", "slack"].contains(&source)
                && text.trim() != CACHE_MESSAGE
                && !text.trim().ends_with(initial.trim())
            {
                item(AgentItemKind::User, text)?;
                state.activity(workspace, true, None);
            }
        }
        "text_start" => *projection = Projection::default(),
        "text_delta" => {
            projection
                .text
                .push_str(data["text"].as_str().unwrap_or(""));
            let trimmed = projection.text.trim();
            if !(!trimmed.is_empty() && SILENT.starts_with(trimmed)) {
                let delta = &projection.text[projection.sent..];
                if !delta.is_empty() {
                    state.emit(workspace, AgentUpdate::Delta { text: delta.into() });
                    projection.sent = projection.text.len();
                }
            }
        }
        "assistant_message" => {
            *projection = Projection::default();
            let text = data["content"].as_str().unwrap_or("");
            if !text.trim().is_empty() && text.trim() != SILENT {
                item(AgentItemKind::Assistant, text)?;
            }
        }
        "tool_start" => state.activity(
            workspace,
            true,
            data["tool_name"].as_str().map(str::to_string),
        ),
        "tool_result" => state.activity(workspace, true, None),
        "complete" | "session_ended" => {
            *projection = Projection::default();
            state.activity(workspace, false, None);
        }
        "error" | "assistant_error" => {
            let text = data["message"]
                .as_str()
                .or_else(|| data["error"].as_str())
                .unwrap_or("턴이 실패했습니다.");
            item(AgentItemKind::Error, text)?;
            state.activity(workspace, false, None);
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_initial_instruction_is_not_a_user_message() {
        let state = AppState::in_memory("secret");
        state.lock_db().unwrap().execute("INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at) VALUES('w','d','s','claude-opus','작업','now')", []).unwrap();
        let initial = format!(
            "{}\n\n처음 시작이다. 도구를 쓰지 말고 이 작업의 PAS로서 한두 줄로 인사해 다오.",
            crate::agent::role_text("작업", "w")
        );
        let mut p = Projection::default();
        process(&state, "w", &initial, "user_message", &json!({"text":format!("앞에 붙은 소울스트림 글\n{initial}  "),"caller_info":{"source":"browser"}}), &mut p).unwrap();
        process(
            &state,
            "w",
            &initial,
            "user_message",
            &json!({"text":"브라우저에서 보낸 말","caller_info":{"source":"browser"}}),
            &mut p,
        )
        .unwrap();
        let history = state.history("w").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].text, "브라우저에서 보낸 말");
    }

    #[test]
    fn projection_filters_silent_and_records_real_messages() {
        let state = AppState::in_memory("secret");
        let mut events = state.0.events.subscribe();
        let mut p = Projection::default();
        let emit = |event: &str, data: Value, p: &mut Projection| {
            process(&state, "w", "처음 지시", event, &data, p).unwrap()
        };
        emit(
            "user_message",
            json!({"text":CACHE_MESSAGE,"caller_info":{"source":"browser"}}),
            &mut p,
        );
        emit(
            "user_message",
            json!({"text":"숨김","caller_info":{"source":"agent"}}),
            &mut p,
        );
        emit("text_start", json!({}), &mut p);
        emit("text_delta", json!({"text":"[SIL"}), &mut p);
        emit("text_delta", json!({"text":"ENT]"}), &mut p);
        emit("assistant_message", json!({"content":"[SILENT]"}), &mut p);
        assert!(events.try_recv().is_err());
        emit(
            "user_message",
            json!({"text":"안녕","caller_info":{"source":"kaleidoscope"}}),
            &mut p,
        );
        emit("text_start", json!({}), &mut p);
        emit("text_delta", json!({"text":"[SI"}), &mut p);
        emit("text_delta", json!({"text":"작합니다"}), &mut p);
        emit("tool_start", json!({"tool_name":"list_apps"}), &mut p);
        emit("tool_result", json!({}), &mut p);
        emit("assistant_message", json!({"content":"답변"}), &mut p);
        emit("complete", json!({}), &mut p);
        let all: Vec<_> = std::iter::from_fn(|| events.try_recv().ok()).collect();
        assert!(all.iter().any(|e| matches!(e, DeviceEvent::AgentUpdate {update:AgentUpdate::Delta {text},..} if text == "[SI작합니다")));
        assert!(all.iter().any(|e| matches!(e, DeviceEvent::AgentUpdate {update:AgentUpdate::Activity {tool:Some(name),..},..} if name == "list_apps")));
        assert!(all.iter().any(|e| matches!(
            e,
            DeviceEvent::AgentUpdate {
                update: AgentUpdate::Activity { busy: false, .. },
                ..
            }
        )));
        let history: Vec<_> = state
            .history("w")
            .unwrap()
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert_eq!(history, vec!["안녕", "답변"]);
    }
}
