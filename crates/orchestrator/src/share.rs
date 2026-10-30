use super::*;
use axum::extract::{rejection::JsonRejection, Extension, Path};
use kaleidoscope_contract::registry::ShareUpload;

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

#[derive(Default)]
pub(super) struct ShareStore {
    views: HashMap<(String, String), SharedView>,
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
        if !self.device_owns_workspace(device_id, &upload.workspace_id)? {
            return Err(CoreError::new(ErrorCode::NotFound));
        }
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
        if !self.mcp_owns_workspace(workspace_id)? {
            return Ok(Vec::new());
        }
        Ok(self
            .0
            .shares
            .lock()
            .map_err(|_| server_error("같이 보기 상태를 읽을 수 없습니다."))?
            .workspace_views(workspace_id))
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn device(state: &AppState) -> (String, String) {
        let id = Uuid::new_v4().to_string();
        let token = random_token();
        state
            .lock_db()
            .unwrap()
            .execute(
                "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,'test-pc',(SELECT account_id FROM mcp_principal WHERE id=1),?2,?3)",
                params![id, sha256_hex(token.as_bytes()), timestamp()],
            )
            .unwrap();
        state.lock_db().unwrap().execute(
            "INSERT INTO workspaces(id,account_id,data,created_at) VALUES('w',(SELECT account_id FROM devices WHERE id=?1),'{\"id\":\"w\",\"name\":\"작업\",\"created_at\":\"now\",\"updated_at\":\"now\"}','now')",
            [&id],
        ).unwrap();
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
