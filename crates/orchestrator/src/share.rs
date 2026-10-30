use super::*;
use axum::extract::{rejection::JsonRejection, Extension, Path};
use kaleidoscope_contract::registry::{ShareUpload, SHARE_BLOCK_END, SHARE_BLOCK_START};
use similar::TextDiff;
use std::collections::BTreeMap;

const SHARE_INTRO: &str = "디렉터가 kaleidoscope 쉘에서 「같이 보기」로 켠 창에 지금 보이는 내용입니다. 쉘이 디렉터의 말 뒤에 붙였고 디렉터가 쓴 글이 아닙니다. 지난번 말 뒤로 달라진 것만 담았습니다. 지금 모습 전체는 MCP get_shared_view로 읽을 수 있습니다. 이미지나 웹 화면이 보이는 창은 모습이 바뀌었을 때 「같이 보기 - 앱 이름.png」 첨부로 함께 옵니다.";

#[derive(Debug, Clone, Serialize)]
pub(super) struct SharedView {
    pub window_id: String,
    pub workspace_id: String,
    pub app_name: String,
    pub device_name: String,
    pub updated_at: String,
    pub visual: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SentView {
    app_name: String,
    text: String,
}

#[derive(Default)]
pub(super) struct ShareStore {
    views: HashMap<(String, String), SharedView>,
    sent: HashMap<String, BTreeMap<String, SentView>>,
}

impl ShareStore {
    pub(super) fn put(
        &mut self,
        device_id: &str,
        device_name: &str,
        window_id: &str,
        upload: ShareUpload,
    ) {
        self.views.insert(
            (device_id.to_string(), window_id.to_string()),
            SharedView {
                window_id: window_id.to_string(),
                workspace_id: upload.workspace_id,
                app_name: upload.app_name,
                device_name: device_name.to_string(),
                updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                visual: upload.visual,
                text: upload.text,
            },
        );
    }

    pub(super) fn delete(&mut self, device_id: &str, window_id: &str) {
        self.views
            .remove(&(device_id.to_string(), window_id.to_string()));
    }

    pub(super) fn delete_device(&mut self, device_id: &str) {
        self.views.retain(|(device, _), _| device != device_id);
    }

    fn workspace_views(&self, workspace_id: &str) -> Vec<SharedView> {
        let mut latest = HashMap::<String, SharedView>::new();
        for view in self
            .views
            .values()
            .filter(|view| view.workspace_id == workspace_id)
        {
            let replace = latest.get(&view.window_id).is_none_or(|current| {
                (&view.updated_at, &view.device_name) > (&current.updated_at, &current.device_name)
            });
            if replace {
                latest.insert(view.window_id.clone(), view.clone());
            }
        }
        let mut views: Vec<_> = latest.into_values().collect();
        views.sort_by(|a, b| {
            a.app_name
                .cmp(&b.app_name)
                .then(a.window_id.cmp(&b.window_id))
        });
        views
    }
}

impl AppState {
    pub(super) fn put_shared_view(
        &self,
        device_id: &str,
        device_name: &str,
        window_id: &str,
        upload: ShareUpload,
    ) -> Result<(), CoreError> {
        self.0
            .shares
            .lock()
            .map_err(|_| server_error("같이 보기 상태를 저장할 수 없습니다."))?
            .put(device_id, device_name, window_id, upload);
        Ok(())
    }

    pub(super) fn delete_shared_view(&self, device_id: &str, window_id: &str) {
        if let Ok(mut shares) = self.0.shares.lock() {
            shares.delete(device_id, window_id);
        }
    }

    pub(super) fn delete_device_shared_views(&self, device_id: &str) {
        if let Ok(mut shares) = self.0.shares.lock() {
            shares.delete_device(device_id);
        }
    }

    pub(super) fn shared_views(&self, workspace_id: &str) -> Result<Vec<SharedView>, CoreError> {
        Ok(self
            .0
            .shares
            .lock()
            .map_err(|_| server_error("같이 보기 상태를 읽을 수 없습니다."))?
            .workspace_views(workspace_id))
    }

    pub(super) fn share_block_for_send(
        &self,
        workspace_id: &str,
    ) -> Result<Option<(String, BTreeMap<String, SentView>)>, CoreError> {
        let shares = self
            .0
            .shares
            .lock()
            .map_err(|_| server_error("같이 보기 상태를 읽을 수 없습니다."))?;
        let views = shares.workspace_views(workspace_id);
        let sent = shares.sent.get(workspace_id).cloned().unwrap_or_default();
        Ok(build_share_block(&views, &sent))
    }

    pub(super) fn mark_shared_views_sent(
        &self,
        workspace_id: &str,
        sent: BTreeMap<String, SentView>,
    ) -> Result<(), CoreError> {
        self.0
            .shares
            .lock()
            .map_err(|_| server_error("같이 보기 상태를 저장할 수 없습니다."))?
            .sent
            .insert(workspace_id.to_string(), sent);
        Ok(())
    }
}

pub(super) async fn put_share(
    State(state): State<AppState>,
    Extension((device_id, device_name)): Extension<(String, String)>,
    Path(window_id): Path<String>,
    body: Result<Json<ShareUpload>, JsonRejection>,
) -> Response {
    let Ok(Json(upload)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    };
    if upload.workspace_id.trim().is_empty()
        || upload.text.as_bytes().len() > kaleidoscope_contract::SHARE_TEXT_MAX_BYTES
    {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            CoreError::new(ErrorCode::InvalidRequest),
        );
    }
    match state.put_shared_view(&device_id, &device_name, &window_id, upload) {
        Ok(()) => Json(json!({})).into_response(),
        Err(error) => http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

pub(super) async fn delete_share(
    State(state): State<AppState>,
    Extension((device_id, _)): Extension<(String, String)>,
    Path(window_id): Path<String>,
) -> Response {
    state.delete_shared_view(&device_id, &window_id);
    Json(json!({})).into_response()
}

fn build_share_block(
    views: &[SharedView],
    sent: &BTreeMap<String, SentView>,
) -> Option<(String, BTreeMap<String, SentView>)> {
    if views.is_empty() && sent.is_empty() {
        return None;
    }

    let mut next = BTreeMap::new();
    let mut entries = Vec::new();
    for view in views {
        next.insert(
            view.window_id.clone(),
            SentView {
                app_name: view.app_name.clone(),
                text: view.text.clone(),
            },
        );
        let previous = sent.get(&view.window_id);
        let (status, content) = match previous {
            None => ("새로 같이 봄", Some(view.text.clone())),
            Some(previous) if previous.text == view.text => ("그대로", None),
            Some(previous) => {
                let diff = TextDiff::from_lines(&previous.text, &view.text)
                    .unified_diff()
                    .context_radius(1)
                    .to_string();
                if diff.len() > view.text.len() {
                    ("바뀜(전체)", Some(view.text.clone()))
                } else {
                    ("바뀜", Some(diff))
                }
            }
        };
        entries.push((
            view.app_name.clone(),
            view.window_id.clone(),
            format!(
                "## {} (창 {}): {}{}",
                view.app_name,
                short_window_id(&view.window_id),
                status,
                content.map(|text| format!("\n{text}")).unwrap_or_default()
            ),
        ));
    }

    for (window_id, previous) in sent {
        if !next.contains_key(window_id) {
            entries.push((
                previous.app_name.clone(),
                window_id.clone(),
                format!(
                    "## {} (창 {}): 같이 보기 끝",
                    previous.app_name,
                    short_window_id(window_id)
                ),
            ));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let block = format!(
        "{SHARE_BLOCK_START}\n{SHARE_INTRO}\n\n{}\n{SHARE_BLOCK_END}",
        entries
            .into_iter()
            .map(|(_, _, entry)| entry)
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    Some((block, next))
}

fn short_window_id(window_id: &str) -> &str {
    window_id.get(..8).unwrap_or(window_id)
}

pub(super) fn strip_share_block(text: &str) -> String {
    let mut in_block = false;
    text.lines()
        .filter(|line| {
            if *line == SHARE_BLOCK_START {
                in_block = true;
                return false;
            }
            if *line == SHARE_BLOCK_END {
                in_block = false;
                return false;
            }
            !in_block
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn view(window_id: &str, app_name: &str, text: &str, updated_at: &str) -> SharedView {
        SharedView {
            window_id: window_id.into(),
            workspace_id: "w".into(),
            app_name: app_name.into(),
            device_name: "pc".into(),
            updated_at: updated_at.into(),
            visual: false,
            text: text.into(),
        }
    }

    fn block(views: &[SharedView], sent: &BTreeMap<String, SentView>) -> String {
        build_share_block(views, sent).unwrap().0
    }

    #[test]
    fn new_unchanged_deleted_and_changed_views_are_described() {
        let original =
            "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10";
        let current = [view(
            "12345678-a",
            "편집기",
            original,
            "2026-01-01T00:00:00.000Z",
        )];
        let first = block(&current, &BTreeMap::new());
        assert!(first.contains(&format!(
            "## 편집기 (창 12345678): 새로 같이 봄\n{original}"
        )));
        let sent = build_share_block(&current, &BTreeMap::new()).unwrap().1;
        let same = block(&current, &sent);
        assert!(same.contains("## 편집기 (창 12345678): 그대로"));
        assert!(!same.contains("a\nb\nc"));
        let changed_text =
            "line 1\nline 2\nline 3\nchanged\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10";
        let changed = [view(
            "12345678-a",
            "편집기",
            changed_text,
            "2026-01-02T00:00:00.000Z",
        )];
        let changed_block = block(&changed, &sent);
        assert!(changed_block.contains("## 편집기 (창 12345678): 바뀜\n@@"));
        assert!(changed_block.contains("-line 4\n+changed"));
        let deleted = block(&[], &sent);
        assert!(deleted.contains("## 편집기 (창 12345678): 같이 보기 끝"));
    }

    #[test]
    fn large_diff_falls_back_to_full_text_and_empty_state_has_no_block() {
        let old = BTreeMap::from([(
            "12345678-a".into(),
            SentView {
                app_name: "편집기".into(),
                text: "old\n".repeat(50),
            },
        )]);
        let current = [view(
            "12345678-a",
            "편집기",
            "new",
            "2026-01-02T00:00:00.000Z",
        )];
        assert!(block(&current, &old).contains("바뀜(전체)\nnew"));
        assert!(build_share_block(&[], &BTreeMap::new()).is_none());
    }

    #[test]
    fn diff_keeps_changed_content_that_looks_like_a_file_header() {
        let old = BTreeMap::from([(
            "12345678-a".into(),
            SentView {
                app_name: "편집기".into(),
                text: "line 1\n-- option\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10".into(),
            },
        )]);
        let current = [view(
            "12345678-a",
            "편집기",
            "line 1\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10",
            "2026-01-02T00:00:00.000Z",
        )];
        assert!(block(&current, &old).contains("\n--- option\n"));
    }

    #[test]
    fn strip_share_block_keeps_user_text_and_trims_end() {
        assert_eq!(
            strip_share_block("내 요청\n\n<kaleidoscope-share>\n화면\n</kaleidoscope-share>\n  "),
            "내 요청"
        );
        assert_eq!(
            strip_share_block("<kaleidoscope-share>\n화면\n</kaleidoscope-share>  "),
            ""
        );
    }

    fn device(state: &AppState) -> (String, String) {
        let id = Uuid::new_v4().to_string();
        let token = random_token();
        state
            .lock_db()
            .unwrap()
            .execute(
                "INSERT INTO devices(id,name,token_sha256,created_at) VALUES(?1,'test-pc',?2,?3)",
                params![id, sha256_hex(token.as_bytes()), timestamp()],
            )
            .unwrap();
        (id, token)
    }

    #[tokio::test]
    async fn authenticated_put_delete_and_utf8_size_limit_work() {
        let state = AppState::in_memory("secret");
        let (_, token) = device(&state);
        let call = |method: &str, window: &str, body: String| {
            Request::builder()
                .method(method)
                .uri(format!("/api/device/shares/{window}"))
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()
        };
        let app = crate::router(state.clone());
        let upload = json!({"workspace_id":"w","app_name":"편집기","text":"hello","visual":true});
        let response = app
            .clone()
            .oneshot(call("PUT", "window-1", upload.to_string()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let view = state.shared_views("w").unwrap().pop().unwrap();
        assert_eq!(view.text, "hello");
        assert_eq!(view.device_name, "test-pc");
        assert!(view.visual);
        assert!(!view.updated_at.is_empty());

        let invalid = json!({"workspace_id":" ","app_name":"편집기","text":"hello","visual":false});
        assert_eq!(
            app.clone()
                .oneshot(call("PUT", "window-1", invalid.to_string()))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        let oversized = json!({
            "workspace_id":"w",
            "app_name":"편집기",
            "text":"x".repeat(kaleidoscope_contract::SHARE_TEXT_MAX_BYTES + 1),
            "visual":false
        });
        assert_eq!(
            app.clone()
                .oneshot(call("PUT", "window-1", oversized.to_string()))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            app.clone()
                .oneshot(call("DELETE", "window-1", String::new()))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert!(state.shared_views("w").unwrap().is_empty());
        let _ = response.into_body().collect().await.unwrap();
    }

    #[tokio::test]
    async fn stream_cleanup_waits_for_last_connection_and_then_clears_device_views() {
        let state = AppState::in_memory("secret");
        let (device_id, _) = device(&state);
        let first = state.stream(device_id.clone(), None).unwrap();
        let second = state.stream(device_id.clone(), None).unwrap();
        state
            .put_shared_view(
                &device_id,
                "test-pc",
                "window-1",
                ShareUpload {
                    workspace_id: "w".into(),
                    app_name: "편집기".into(),
                    text: "hello".into(),
                    visual: false,
                },
            )
            .unwrap();
        drop(first);
        assert_eq!(state.shared_views("w").unwrap().len(), 1);
        drop(second);
        assert!(state.shared_views("w").unwrap().is_empty());
    }
}
