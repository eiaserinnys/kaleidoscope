use super::*;

impl AppState {
    pub(crate) fn retire_agent(&self, workspace_id: &str) -> bool {
        let Some(soul) = self.0.soulstream.clone() else {
            return false;
        };
        let Ok(Some(row)) = self.agent_row(workspace_id) else {
            return false;
        };
        let state = self.clone();
        let workspace = workspace_id.to_string();
        let session = row.session_id;
        tokio::spawn(async move {
            let path = format!("{}/api/persistent-sessions/{session}", soul.url);
            let result = soul
                .client
                .put(&path)
                .bearer_auth(&soul.token)
                .json(&json!({"enabled":false}))
                .send()
                .await;
            match result {
                Ok(response)
                    if response.status().is_success()
                        || response.status() == reqwest::StatusCode::NOT_FOUND =>
                {
                    if let Ok(mut relays) = state.0.relays.lock() {
                        if let Some(handle) = relays.remove(&workspace) {
                            handle.abort();
                        }
                    }
                    if let Ok(db) = state.lock_db() {
                        if let Err(error) =
                            db.execute("DELETE FROM agents WHERE workspace_id=?1", [&workspace])
                        {
                            eprintln!("PAS 행을 지우지 못했습니다: {error}");
                        }
                        if let Err(error) = db.execute(
                            "DELETE FROM agent_items WHERE workspace_id=?1",
                            [&workspace],
                        ) {
                            eprintln!("PAS 기록을 지우지 못했습니다: {error}");
                        }
                    }
                    if let Ok(mut activity) = state.0.activity.lock() {
                        activity.remove(&workspace);
                    }
                }
                Ok(response) => eprintln!("PAS를 내리지 못했습니다(HTTP {}).", response.status()),
                Err(error) => eprintln!("PAS를 내리지 못했습니다: {error}"),
            }
        });
        true
    }

    pub(crate) fn rename_agent(&self, workspace_id: &str, name: &str) {
        let (Some(soul), Ok(Some(row))) = (self.0.soulstream.clone(), self.agent_row(workspace_id))
        else {
            return;
        };
        if row.workspace_name == name {
            return;
        }
        let state = self.clone();
        let workspace = workspace_id.to_string();
        let name = name.to_string();
        let session = row.session_id;
        tokio::spawn(async move {
            let path = format!("{}/api/persistent-sessions/{session}", soul.url);
            match soul
                .client
                .put(&path)
                .bearer_auth(&soul.token)
                .json(&json!({"display_name":format!("kaleidoscope · {name}")}))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    if let Ok(db) = state.lock_db() {
                        if let Err(error) = db.execute(
                            "UPDATE agents SET workspace_name=?2 WHERE workspace_id=?1",
                            params![workspace, name],
                        ) {
                            eprintln!("PAS 작업 이름을 저장하지 못했습니다: {error}");
                        }
                    }
                }
                Ok(response) => eprintln!(
                    "PAS 작업 이름을 바꾸지 못했습니다(HTTP {}).",
                    response.status()
                ),
                Err(error) => eprintln!("PAS 작업 이름을 바꾸지 못했습니다: {error}"),
            }
        });
    }
}
