use super::*;
use axum::{
    extract::{rejection::JsonRejection, Extension},
    response::IntoResponse,
};
use kaleidoscope_contract::{
    errors,
    preferences::{message_receiver, AccountPreferences},
};

#[derive(Deserialize)]
pub(super) struct DefaultRequest {
    #[serde(deserialize_with = "deserialize_app_id")]
    app_id: Option<String>,
}
fn deserialize_app_id<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
#[derive(Deserialize)]
pub(super) struct AnswerRequest {
    app_id: String,
    use_as_default: bool,
}

fn read_from(db: &Connection, account: &str) -> Result<AccountPreferences, CoreError> {
    let raw: Option<String> = db
        .query_row(
            "SELECT data FROM account_preferences WHERE account_id=?1",
            [account],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| errors::SERVER_PREFERENCES_READ_FAILED().and_details(vec![e.to_string()]))?;
    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|e| errors::SERVER_PREFERENCES_READ_FAILED().and_details(vec![e.to_string()])),
        None => Ok(AccountPreferences::default()),
    }
}

fn validate_app(db: &Connection, app_id: &str) -> Result<(), CoreError> {
    if kaleidoscope_contract::builtin::is_builtin(app_id) {
        return Ok(());
    }
    let row: Option<(String, String)> = db.query_row(
        "SELECT a.name,v.definition FROM apps a JOIN app_versions v ON v.app_id=a.id AND v.version=a.current_version WHERE a.id=?1 AND a.deleted_at IS NULL",
        [app_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|e| errors::SERVER_PREFERENCES_READ_FAILED().and_details(vec![e.to_string()]))?;
    let (name, raw) = row.ok_or_else(|| {
        errors::SERVER_PREFERENCES_APP_NOT_FOUND().and_details(vec![format!("app_id: {app_id}")])
    })?;
    let definition: AppDefinition = serde_json::from_str(&raw)
        .map_err(|e| errors::SERVER_PREFERENCES_READ_FAILED().and_details(vec![e.to_string()]))?;
    if message_receiver(&definition).is_none() {
        return Err(errors::SERVER_PREFERENCES_APP_NOT_RECEIVABLE(name)
            .and_details(vec![format!("app_id: {app_id}")]));
    }
    Ok(())
}

impl AppState {
    pub(super) fn read_preferences(&self, account: &str) -> Result<AccountPreferences, CoreError> {
        let db = self
            .lock_db()
            .map_err(|_| errors::SERVER_PREFERENCES_READ_FAILED())?;
        read_from(&db, account)
    }
    fn update_preferences(
        &self,
        account: &str,
        app_id: Option<&str>,
        answer: Option<bool>,
    ) -> Result<AccountPreferences, CoreError> {
        let mut db = self
            .lock_db()
            .map_err(|_| errors::SERVER_PREFERENCES_WRITE_FAILED())?;
        let tx = db.transaction().map_err(|e| {
            errors::SERVER_PREFERENCES_WRITE_FAILED().and_details(vec![e.to_string()])
        })?;
        if let Some(id) = app_id {
            validate_app(&tx, id)?;
        }
        let mut preferences = read_from(&tx, account)?;
        if let Some(use_as_default) = answer {
            let id = app_id.expect("answer always has app_id");
            if !preferences
                .asked_message_app_ids
                .iter()
                .any(|asked| asked == id)
            {
                preferences.asked_message_app_ids.push(id.to_owned());
            }
            if use_as_default {
                preferences.default_message_app_id = Some(id.to_owned());
            }
        } else {
            preferences.default_message_app_id = app_id.map(str::to_owned);
        }
        preferences.revision += 1;
        let data = serde_json::to_string(&preferences).map_err(|e| {
            errors::SERVER_PREFERENCES_WRITE_FAILED().and_details(vec![e.to_string()])
        })?;
        tx.execute("INSERT INTO account_preferences(account_id,data) VALUES(?1,?2) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data", params![account, data])
            .map_err(|e| errors::SERVER_PREFERENCES_WRITE_FAILED().and_details(vec![e.to_string()]))?;
        tx.commit().map_err(|e| {
            errors::SERVER_PREFERENCES_WRITE_FAILED().and_details(vec![e.to_string()])
        })?;
        drop(db);
        self.send_event_for_account(
            DeviceEvent::PreferencesChanged {
                preferences: preferences.clone(),
            },
            account,
        );
        Ok(preferences)
    }
}
fn response(result: Result<AccountPreferences, CoreError>) -> Response {
    match result {
        Ok(preferences) => Json(preferences).into_response(),
        Err(error) => {
            let status = match error.code {
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            http::error_response(status, error)
        }
    }
}
pub(super) async fn get_preferences(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
) -> Response {
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.read_preferences(&account)),
    )
}
pub(super) async fn set_default(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    body: Result<Json<DefaultRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            errors::SERVER_PREFERENCES_BODY_INVALID(),
        );
    };
    response(
        state
            .device_account_id(&device.0)
            .and_then(|account| state.update_preferences(&account, body.app_id.as_deref(), None)),
    )
}
pub(super) async fn answer(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    body: Result<Json<AnswerRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return http::error_response(
            StatusCode::BAD_REQUEST,
            errors::SERVER_PREFERENCES_BODY_INVALID(),
        );
    };
    response(state.device_account_id(&device.0).and_then(|account| {
        state.update_preferences(&account, Some(&body.app_id), Some(body.use_as_default))
    }))
}
