use super::*;
use axum::{
    extract::rejection::JsonRejection,
    extract::{Extension, Path},
};
use kaleidoscope_contract::{
    registry::{AgentCreateRequest, DeviceAgentReply},
    AgentAttachment, AgentInfo, AgentItem, AgentItemKind, AgentUpdate, Workspace,
};

#[derive(Clone)]
pub struct Soulstream {
    pub url: String,
    pub token: String,
    pub profile: String,
    pub folder_id: Option<String>,
    pub client: reqwest::Client,
}

#[derive(Clone)]
pub(super) struct AgentRow {
    pub workspace_id: String,
    pub session_id: String,
    pub model_preset: String,
    pub workspace_name: String,
    pub created_at: String,
    pub cursor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct StoredAgentAttachment {
    pub name: String,
    pub mime: String,
    pub path: String,
}

type ApiResult<T> = Result<T, (StatusCode, CoreError)>;
fn failure(status: StatusCode, code: ErrorCode, message: &str) -> (StatusCode, CoreError) {
    (
        status,
        CoreError {
            code,
            message: message.into(),
            details: vec![],
        },
    )
}
fn bad() -> (StatusCode, CoreError) {
    (
        StatusCode::BAD_REQUEST,
        CoreError::new(ErrorCode::InvalidRequest),
    )
}
fn server(message: &str) -> (StatusCode, CoreError) {
    failure(StatusCode::BAD_GATEWAY, ErrorCode::Server, message)
}
fn db_fail(error: CoreError) -> (StatusCode, CoreError) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}
fn response<T: Serialize>(result: ApiResult<T>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err((status, error)) => http::error_response(status, error),
    }
}
fn label(preset: &str) -> &str {
    registry::AGENT_MODELS
        .iter()
        .find(|(p, _)| *p == preset)
        .map(|(_, l)| *l)
        .unwrap_or(preset)
}

impl AppState {
    pub fn configure_soulstream(
        &mut self,
        url: Option<String>,
        token: Option<String>,
        profile: String,
        folder_id: Option<String>,
    ) {
        if let (Some(url), Some(token)) = (
            url.filter(|s| !s.is_empty()),
            token.filter(|s| !s.is_empty()),
        ) {
            Arc::get_mut(&mut self.0)
                .expect("설정은 상태 공유 전에 해야 합니다")
                .soulstream = Some(Soulstream {
                url,
                token,
                profile,
                folder_id,
                client: reqwest::Client::new(),
            });
        }
    }
    pub fn start_relays(&self) -> Result<(), String> {
        if self.0.soulstream.is_none() {
            return Ok(());
        }
        let rows = self.agent_rows().map_err(|e| e.message)?;
        let workspaces: std::collections::HashSet<_> = {
            let db = self.lock_db().map_err(|e| e.message)?;
            super::layouts::load_entities::<Workspace>(&db, "workspaces")
                .map_err(|e| e.message)?
                .into_iter()
                .map(|workspace| workspace.id)
                .collect()
        };
        for row in rows {
            if workspaces.contains(&row.workspace_id) {
                self.start_relay(row);
            } else {
                self.retire_agent(&row.workspace_id);
            }
        }
        Ok(())
    }
    fn agent_rows(&self) -> Result<Vec<AgentRow>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db
            .prepare("SELECT workspace_id,session_id,model_preset,created_at,cursor,workspace_name FROM agents")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(AgentRow {
                    workspace_id: r.get(0)?,
                    session_id: r.get(1)?,
                    model_preset: r.get(2)?,
                    created_at: r.get(3)?,
                    cursor: r.get(4)?,
                    workspace_name: r.get(5)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }
    pub(super) fn agent_row(&self, workspace_id: &str) -> Result<Option<AgentRow>, CoreError> {
        self.lock_db()?.query_row("SELECT workspace_id,session_id,model_preset,created_at,cursor,workspace_name FROM agents WHERE workspace_id=?1", [workspace_id], |r| Ok(AgentRow {workspace_id:r.get(0)?,session_id:r.get(1)?,model_preset:r.get(2)?,created_at:r.get(3)?,cursor:r.get(4)?,workspace_name:r.get(5)?})).optional().map_err(db_error)
    }

    fn agent_info(&self, row: &AgentRow) -> AgentInfo {
        let (busy, tool) = self
            .0
            .activity
            .lock()
            .unwrap()
            .get(&row.workspace_id)
            .cloned()
            .unwrap_or_default();
        AgentInfo {
            workspace_id: row.workspace_id.clone(),
            model_preset: row.model_preset.clone(),
            model_label: label(&row.model_preset).into(),
            busy,
            tool,
            created_at: row.created_at.clone(),
        }
    }
    pub(super) fn history(&self, workspace_id: &str) -> Result<Vec<AgentItem>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db.prepare("SELECT id,kind,text,at,attachments FROM (SELECT id,kind,text,at,attachments FROM agent_items WHERE workspace_id=?1 ORDER BY id DESC LIMIT ?2) ORDER BY id").map_err(db_error)?;
        let rows = stmt
            .query_map(
                params![workspace_id, registry::AGENT_HISTORY_LIMIT as i64],
                |r| {
                    let kind: String = r.get(1)?;
                    let kind = match kind.as_str() {
                        "user" => AgentItemKind::User,
                        "assistant" => AgentItemKind::Assistant,
                        "error" => AgentItemKind::Error,
                        _ => AgentItemKind::Notice,
                    };
                    let stored: String = r.get(4)?;
                    let stored: Vec<StoredAgentAttachment> = serde_json::from_str(&stored)
                        .map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                4,
                                rusqlite::types::Type::Text,
                                Box::new(error),
                            )
                        })?;
                    Ok(AgentItem {
                        id: r.get::<_, i64>(0)?.to_string(),
                        kind,
                        text: r.get(2)?,
                        at: r.get(3)?,
                        attachments: stored
                            .into_iter()
                            .map(|attachment| AgentAttachment {
                                name: attachment.name,
                                mime: attachment.mime,
                            })
                            .collect(),
                    })
                },
            )
            .map_err(db_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
    }
    pub(super) fn add_item(
        &self,
        workspace_id: &str,
        kind: AgentItemKind,
        text: &str,
        attachments: &[StoredAgentAttachment],
    ) -> Result<AgentItem, CoreError> {
        let at = timestamp();
        let db = self.lock_db()?;
        let kind_string = match kind {
            AgentItemKind::User => "user",
            AgentItemKind::Assistant => "assistant",
            AgentItemKind::Error => "error",
            AgentItemKind::Notice => "notice",
        };
        let stored = serde_json::to_string(attachments)
            .map_err(|_| server_error("대화 첨부를 저장할 수 없습니다."))?;
        db.execute(
            "INSERT INTO agent_items(workspace_id,kind,text,at,attachments) VALUES(?1,?2,?3,?4,?5)",
            params![workspace_id, kind_string, text, at, stored],
        )
        .map_err(db_error)?;
        Ok(AgentItem {
            id: db.last_insert_rowid().to_string(),
            kind,
            text: text.into(),
            at,
            attachments: attachments
                .iter()
                .map(|attachment| AgentAttachment {
                    name: attachment.name.clone(),
                    mime: attachment.mime.clone(),
                })
                .collect(),
        })
    }
    pub(super) fn stored_attachment(
        &self,
        workspace_id: &str,
        item_id: &str,
        index: u32,
    ) -> Result<Option<StoredAgentAttachment>, CoreError> {
        let Ok(item_id) = item_id.parse::<i64>() else {
            return Ok(None);
        };
        let stored: Option<String> = self
            .lock_db()?
            .query_row(
                "SELECT attachments FROM agent_items WHERE workspace_id=?1 AND id=?2",
                params![workspace_id, item_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let Some(stored) = stored else {
            return Ok(None);
        };
        let attachments: Vec<StoredAgentAttachment> = serde_json::from_str(&stored)
            .map_err(|_| server_error("대화 첨부 기록을 읽을 수 없습니다."))?;
        Ok(attachments.get(index as usize).cloned())
    }
    pub(super) fn emit(&self, workspace_id: &str, update: AgentUpdate) {
        self.send_event(DeviceEvent::AgentUpdate {
            workspace_id: workspace_id.into(),
            update,
        });
    }
    pub(super) fn activity(&self, workspace_id: &str, busy: bool, tool: Option<String>) {
        let mut values = self.0.activity.lock().unwrap();
        let new = (busy, tool.clone());
        if values.get(workspace_id).cloned().unwrap_or_default() != new {
            values.insert(workspace_id.into(), new);
            drop(values);
            self.emit(workspace_id, AgentUpdate::Activity { busy, tool });
        }
    }
    pub(super) fn cursor(&self, workspace_id: &str, cursor: i64) -> Result<(), CoreError> {
        self.lock_db()?
            .execute(
                "UPDATE agents SET cursor=?2 WHERE workspace_id=?1 AND cursor<?2",
                params![workspace_id, cursor],
            )
            .map_err(db_error)?;
        Ok(())
    }
}

pub(super) async fn get_agent(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let result = (|| {
        let agent = state
            .agent_row(&id)
            .map_err(db_fail)?
            .map(|row| state.agent_info(&row));
        Ok(DeviceAgentReply {
            agent,
            items: state.history(&id).map_err(db_fail)?,
            models: registry::agent_models(),
        })
    })();
    response(result)
}

pub(super) async fn create_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(device): Extension<(String, String)>,
    body: Result<Json<AgentCreateRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return response::<Value>(Err(bad()));
    };
    match tokio::spawn(async move { create(&state, &id, &device.0, request).await }).await {
        Ok(result) => response(result),
        Err(_) => response::<AgentInfo>(Err(server("PAS 만들기 작업이 실패했습니다."))),
    }
}

async fn create(
    state: &AppState,
    id: &str,
    device_id: &str,
    request: AgentCreateRequest,
) -> ApiResult<AgentInfo> {
    let name = request.workspace_name.trim();
    if name.is_empty()
        || !registry::AGENT_MODELS
            .iter()
            .any(|(p, _)| *p == request.model_preset)
    {
        return Err(bad());
    }
    let _guard = state.0.create_lock.lock().await;
    if let Some(row) = state.agent_row(id).map_err(db_fail)? {
        return Ok(state.agent_info(&row));
    }
    let soul = state
        .0
        .soulstream
        .as_ref()
        .ok_or_else(|| server("소울스트림 연결 설정이 없습니다."))?;
    let role = role_text(name, id);
    let instruction = initial_instruction(name, id);
    let choices = std::iter::once(request.model_preset.as_str()).chain(
        registry::AGENT_MODELS
            .iter()
            .map(|(p, _)| *p)
            .filter(|p| *p != request.model_preset),
    );
    let mut created = None;
    for preset in choices {
        let mut body = json!({"display_name":format!("kaleidoscope · {name}"),"agent_id":soul.profile,"initial_instruction":instruction,"settings":{"default_model":{"model_preset":preset,"reasoning_effort":null}}});
        if let Some(folder) = &soul.folder_id {
            body["folder_id"] = json!(folder);
        }
        let reply = soul
            .client
            .post(format!("{}/api/persistent-sessions", soul.url))
            .bearer_auth(&soul.token)
            .json(&body)
            .send()
            .await
            .map_err(|_| server("소울스트림에 연결할 수 없습니다."))?;
        let status = reply.status();
        let data: Value = reply.json().await.unwrap_or(Value::Null);
        if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY
            && data["error"]["code"] == "INVALID_MODEL_PRESET"
        {
            continue;
        }
        if !status.is_success() {
            let message: String = data["error"]["message"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(200)
                .collect();
            return Err(server(&format!(
                "소울스트림이 PAS를 만들지 못했습니다(HTTP {}): {}",
                status.as_u16(),
                message.replace(&soul.token, "[가림]")
            )));
        }
        let session_id = data["session"]["session_id"]
            .as_str()
            .ok_or_else(|| server("소울스트림이 세션 id를 돌려주지 않았습니다."))?;
        created = Some((preset.to_string(), session_id.to_string()));
        break;
    }
    let (preset, session_id) =
        created.ok_or_else(|| server("고를 수 있는 모델을 지금 모두 쓸 수 없습니다."))?;
    let now = timestamp();
    state.lock_db().map_err(db_fail)?.execute("INSERT INTO agents(workspace_id,device_id,session_id,model_preset,workspace_name,created_at,cursor) VALUES(?1,?2,?3,?4,?5,?6,0)", params![id,device_id,session_id,preset,name,now]).map_err(db_error).map_err(db_fail)?;
    let fallback: Vec<_> = registry::AGENT_MODELS
        .iter()
        .filter(|(p, _)| *p != preset)
        .map(|(p, _)| json!({"model_preset":p,"reasoning_effort":null}))
        .collect();
    let path = format!("{}/api/persistent-sessions/{}", soul.url, session_id);
    if !matches!(soul.client.put(&path).bearer_auth(&soul.token).json(&json!({"settings":{"fallback_models":fallback}})).send().await, Ok(r) if r.status().is_success())
    {
        eprintln!("PAS 대체 모델 순서를 설정하지 못했습니다.");
    }
    if !matches!(soul.client.post(format!("{path}/instructions")).bearer_auth(&soul.token).json(&json!({"text":role})).send().await, Ok(r) if r.status().is_success())
    {
        eprintln!("PAS 지속 지시를 설정하지 못했습니다.");
    }
    let notice = if preset != request.model_preset {
        Some(
            state
                .add_item(
                    id,
                    AgentItemKind::Notice,
                    &format!(
                        "{} 모델을 지금 쓸 수 없어 {} 모델로 시작했습니다.",
                        label(&request.model_preset),
                        label(&preset)
                    ),
                    &[],
                )
                .map_err(db_fail)?,
        )
    } else {
        None
    };
    state
        .0
        .activity
        .lock()
        .unwrap()
        .insert(id.into(), (true, None));
    let row = state.agent_row(id).map_err(db_fail)?.unwrap();
    let info = state.agent_info(&row);
    state.emit(
        id,
        AgentUpdate::Created {
            agent: info.clone(),
        },
    );
    if let Some(item) = notice {
        state.emit(id, AgentUpdate::Item { item });
    }
    state.start_relay(row);
    Ok(info)
}

pub(super) fn initial_instruction(name: &str, id: &str) -> String {
    format!(
        "{}\n\n처음 시작이다. 도구를 쓰지 말고 이 작업의 PAS로서 한두 줄로 인사해 다오.",
        role_text(name, id)
    )
}

pub(super) fn role_text(name: &str, id: &str) -> String {
    format!("이 세션은 kaleidoscope 쉘의 작업 「{name}」을 맡은 PAS다(workspace_id: {id}).\n- 디렉터는 쉘 안의 「작업 PAS」 창에서 말한다. caller_info.source가 kaleidoscope인 말이 디렉터의 말이다.\n- 앱을 만들거나 고치면 kaleidoscope MCP의 upload_app에 workspace_id \"{id}\"를 넣어 이 작업에 띄운다. 이미 있는 앱을 다시 띄울 때는 open_app에 같은 workspace_id를 넣는다.\n- 「이 창」, 「지금 보는 것」처럼 화면을 가리키면 먼저 get_workspace(workspace_id \"{id}\")로 지금 펼친 데스크톱과 창(앱, 버전, 연 파일)을 읽는다. 고칠 때는 get_app으로 정의를 받아 고친 뒤 upload_app으로 올린다.\n- 앱 만들기와 고치기, 화면 읽기처럼 이 창에서 끝나는 일은 카드를 만들지 않고 바로 한다. 답은 짧게 한다.")
}

#[path = "agent_lifecycle.rs"]
mod lifecycle;

#[cfg(test)]
#[path = "agent_lifecycle_tests.rs"]
mod lifecycle_tests;

#[path = "agent_attachments.rs"]
mod attachments;
pub(super) use attachments::{get_attachment, send_message};

#[cfg(test)]
#[path = "agent_attachment_tests.rs"]
mod attachment_tests;

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
