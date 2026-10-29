use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::registry::{AgentAttachmentReply, AgentSendRequest};
pub(crate) async fn send_message(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<Json<AgentSendRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return response::<Value>(Err(bad()));
    };
    match tokio::spawn(async move { send(&state, &id, request).await }).await {
        Ok(result) => response(result),
        Err(_) => response::<Value>(Err(server("PAS 메시지 보내기 작업이 실패했습니다."))),
    }
}

pub(super) async fn send(
    state: &AppState,
    id: &str,
    request: AgentSendRequest,
) -> ApiResult<Value> {
    let text = request.text.trim();
    if text.chars().count() > registry::AGENT_MESSAGE_MAX_CHARS {
        return Err(failure(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "보낼 글이 허용된 길이를 넘었습니다.",
        ));
    }
    if request.attachments.len() > kaleidoscope_contract::AGENT_ATTACHMENTS_MAX {
        return Err(failure(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "첨부 파일은 한 번에 최대 10개까지 보낼 수 있습니다.",
        ));
    }
    if text.is_empty() && request.attachments.is_empty() {
        return Err(failure(
            StatusCode::BAD_REQUEST,
            ErrorCode::InvalidRequest,
            "글이나 첨부 파일을 하나 이상 입력해 주세요.",
        ));
    }
    let mut decoded = Vec::with_capacity(request.attachments.len());
    let mut total_bytes = 0u64;
    for attachment in &request.attachments {
        if attachment.name.trim().is_empty() {
            return Err(failure(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidRequest,
                "첨부 파일 이름이 비어 있습니다.",
            ));
        }
        let bytes = STANDARD.decode(&attachment.data_base64).map_err(|_| {
            failure(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidRequest,
                "첨부 파일 내용이 올바른 표준 base64가 아닙니다.",
            )
        })?;
        if bytes.len() as u64 > kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES {
            return Err(failure(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidRequest,
                "첨부 파일 하나가 허용된 크기를 넘었습니다.",
            ));
        }
        total_bytes += bytes.len() as u64;
        if total_bytes > kaleidoscope_contract::AGENT_ATTACHMENTS_TOTAL_MAX_BYTES {
            return Err(failure(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidRequest,
                "첨부 파일의 합계가 허용된 크기를 넘었습니다.",
            ));
        }
        decoded.push(bytes);
    }
    let row = state.agent_row(id).map_err(db_fail)?.ok_or_else(|| {
        failure(
            StatusCode::NOT_FOUND,
            ErrorCode::NotFound,
            "작업 PAS를 찾을 수 없습니다.",
        )
    })?;
    let soul = state
        .0
        .soulstream
        .as_ref()
        .ok_or_else(|| server("소울스트림 연결 설정이 없습니다."))?;
    let mut attachment_paths = Vec::with_capacity(request.attachments.len());
    if !request.attachments.is_empty() {
        let reply = soul
            .client
            .get(format!(
                "{}/api/persistent-sessions/{}",
                soul.url, row.session_id
            ))
            .bearer_auth(&soul.token)
            .send()
            .await
            .map_err(|_| server("PAS 노드를 확인하지 못했습니다."))?;
        if !reply.status().is_success() {
            return Err(server("PAS 노드를 확인하지 못했습니다."));
        }
        let data: Value = reply
            .json()
            .await
            .map_err(|_| server("PAS 노드를 확인하지 못했습니다."))?;
        let node_id = data["session"]["node_id"]
            .as_str()
            .filter(|node| !node.is_empty())
            .ok_or_else(|| server("PAS 노드 정보가 없습니다."))?;
        for (attachment, bytes) in request.attachments.iter().zip(decoded) {
            let mime = if attachment.mime.is_empty() {
                "application/octet-stream"
            } else {
                attachment.mime.as_str()
            };
            let filename = attachment.name.replace('/', "_").replace('\\', "_");
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(filename)
                .mime_str(mime)
                .map_err(|_| server("첨부 파일 형식을 처리하지 못했습니다."))?;
            let form = reqwest::multipart::Form::new()
                .text("session_id", row.session_id.clone())
                .part("file", part);
            let reply = soul
                .client
                .post(format!("{}/api/attachments/sessions", soul.url))
                .bearer_auth(&soul.token)
                .query(&[("nodeId", node_id)])
                .multipart(form)
                .send()
                .await
                .map_err(|_| server("첨부 파일을 소울스트림에 올리지 못했습니다."))?;
            if !reply.status().is_success() {
                return Err(server("첨부 파일을 소울스트림에 올리지 못했습니다."));
            }
            let data: Value = reply
                .json()
                .await
                .map_err(|_| server("첨부 파일 응답을 읽지 못했습니다."))?;
            attachment_paths.push(
                data["path"]
                    .as_str()
                    .filter(|path| !path.is_empty())
                    .ok_or_else(|| server("소울스트림이 첨부 파일 경로를 돌려주지 않았습니다."))?
                    .to_string(),
            );
        }
    }
    let mut body =
        json!({"text":text,"caller_info":{"source":"kaleidoscope","display_name":"디렉터"}});
    if !attachment_paths.is_empty() {
        body["attachment_paths"] = json!(attachment_paths);
    }
    let result = soul
        .client
        .post(format!(
            "{}/api/sessions/{}/intervene",
            soul.url, row.session_id
        ))
        .bearer_auth(&soul.token)
        .json(&body)
        .send()
        .await
        .map_err(|_| server("소울스트림에 말을 보내지 못했습니다."))?;
    if !result.status().is_success() {
        return Err(server("소울스트림에 말을 보내지 못했습니다."));
    }
    Ok(json!({}))
}

pub(crate) async fn get_attachment(
    State(state): State<AppState>,
    Path((workspace_id, item_id, index)): Path<(String, String, u32)>,
) -> Response {
    let result = async {
        let attachment = state
            .stored_attachment(&workspace_id, &item_id, index)
            .map_err(db_fail)?
            .ok_or_else(|| {
                failure(
                    StatusCode::NOT_FOUND,
                    ErrorCode::NotFound,
                    "기록에서 첨부 파일을 찾을 수 없습니다.",
                )
            })?;
        let row = state
            .agent_row(&workspace_id)
            .map_err(db_fail)?
            .ok_or_else(|| {
                failure(
                    StatusCode::NOT_FOUND,
                    ErrorCode::NotFound,
                    "작업 PAS를 찾을 수 없습니다.",
                )
            })?;
        let soul = state
            .0
            .soulstream
            .as_ref()
            .ok_or_else(|| server("소울스트림 연결 설정이 없습니다."))?;
        let reply = soul
            .client
            .get(format!(
                "{}/api/persistent-sessions/{}",
                soul.url, row.session_id
            ))
            .bearer_auth(&soul.token)
            .send()
            .await
            .map_err(|_| server("PAS 노드를 확인하지 못했습니다."))?;
        if !reply.status().is_success() {
            return Err(server("PAS 노드를 확인하지 못했습니다."));
        }
        let data: Value = reply
            .json()
            .await
            .map_err(|_| server("PAS 노드를 확인하지 못했습니다."))?;
        let node_id = data["session"]["node_id"]
            .as_str()
            .filter(|node| !node.is_empty())
            .ok_or_else(|| server("PAS 노드 정보가 없습니다."))?;
        let reply = soul
            .client
            .get(format!("{}/api/attachments/files", soul.url))
            .bearer_auth(&soul.token)
            .query(&[("nodeId", node_id), ("path", attachment.path.as_str())])
            .send()
            .await
            .map_err(|_| server("첨부 파일을 가져오지 못했습니다."))?;
        if reply.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(failure(
                StatusCode::NOT_FOUND,
                ErrorCode::NotFound,
                "소울스트림에서 첨부 파일을 찾을 수 없습니다.",
            ));
        }
        if !reply.status().is_success() {
            return Err(server("첨부 파일을 가져오지 못했습니다."));
        }
        if reply
            .content_length()
            .is_some_and(|length| length > kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES)
        {
            return Err(failure(
                StatusCode::BAD_REQUEST,
                ErrorCode::InvalidRequest,
                "쉘에서 열기에는 너무 큰 첨부입니다",
            ));
        }
        let mut stream = reply.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| server("첨부 파일을 가져오지 못했습니다."))?;
            if bytes.len() as u64 + chunk.len() as u64
                > kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES
            {
                return Err(failure(
                    StatusCode::BAD_REQUEST,
                    ErrorCode::InvalidRequest,
                    "쉘에서 열기에는 너무 큰 첨부입니다",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(AgentAttachmentReply {
            name: attachment.name,
            mime: attachment.mime,
            data_base64: STANDARD.encode(bytes),
        })
    }
    .await;
    response(result)
}
