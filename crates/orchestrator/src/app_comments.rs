use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use kaleidoscope_contract::{app_comments::*, app_storage::STORAGE_JSON_MAX_BYTES, errors};
use rusqlite::types::Type;

const SUMMARY_COLUMNS: &str = "c.id,c.app_id,c.number,c.created_app_version,c.created_definition_digest,c.created_shell_version,c.origin_json,c.source_window_id,c.anchor_json,c.text,(SELECT count(*) FROM app_comment_replies r WHERE r.account_id=c.account_id AND r.comment_id=c.id),c.image_meta_json,c.resolved,c.resolved_app_version,c.sent_at,c.unread_reply,c.created_at,c.updated_at,c.revision,(SELECT json_object('id',r.id,'author',r.author,'text',r.text,'created_at',r.created_at) FROM app_comment_replies r WHERE r.account_id=c.account_id AND r.comment_id=c.id ORDER BY r.rowid DESC LIMIT 1)";

fn json_column<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_str(&value)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(e)))
}
fn summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AppCommentSummary> {
    let meta: Option<String> = row.get(11)?;
    let image = meta
        .map(|v| {
            serde_json::from_str(&v)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(11, Type::Text, Box::new(e)))
        })
        .transpose()?;
    Ok(AppCommentSummary {
        id: row.get(0)?,
        app_id: row.get(1)?,
        number: row.get::<_, i64>(2)? as u64,
        created_app_version: row.get(3)?,
        created_definition_digest: row.get(4)?,
        created_shell_version: row.get(5)?,
        origin: json_column(row, 6)?,
        source_window_id: row.get(7)?,
        anchor: json_column(row, 8)?,
        text: row.get(9)?,
        reply_count: row.get::<_, i64>(10)? as u64,
        last_reply: row.get::<_, Option<String>>(19)?.map(|value| serde_json::from_str(&value)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(19, Type::Text, Box::new(e)))).transpose()?,
        image,
        resolved: row.get(12)?,
        resolved_app_version: row.get(13)?,
        sent_at: row.get(14)?,
        unread_reply: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        revision: row.get::<_, i64>(18)? as u64,
    })
}
pub(super) fn summary(
    db: &Connection,
    account: &str,
    id: &str,
) -> rusqlite::Result<Option<AppCommentSummary>> {
    db.query_row(
        &format!("SELECT {SUMMARY_COLUMNS} FROM app_comments c WHERE c.account_id=?1 AND c.id=?2"),
        params![account, id],
        summary_row,
    )
    .optional()
}
pub(super) fn thread(
    db: &Connection,
    account: &str,
    id: &str,
) -> rusqlite::Result<Option<AppCommentThread>> {
    let Some(summary) = summary(db, account, id)? else {
        return Ok(None);
    };
    let mut stmt = db.prepare("SELECT id,author,text,created_at FROM app_comment_replies WHERE account_id=?1 AND comment_id=?2 ORDER BY rowid")?;
    let replies = stmt
        .query_map(params![account, id], |row| {
            let author: String = row.get(1)?;
            let author = match author.as_str() {
                "user" => AppCommentAuthor::User,
                "agent" => AppCommentAuthor::Agent,
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(AppCommentReply {
                id: row.get(0)?,
                author,
                text: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some(AppCommentThread { summary, replies }))
}
pub(super) fn meta(
    db: &Connection,
    account: &str,
    app_id: &str,
) -> rusqlite::Result<AppCommentAppMeta> {
    let revision = db
        .query_row(
            "SELECT revision FROM app_comment_apps WHERE account_id=?1 AND app_id=?2",
            params![account, app_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let (open_count, unsent_count, unread_reply_count) = db.query_row("SELECT count(*) FILTER (WHERE resolved=0), count(*) FILTER (WHERE resolved=0 AND sent_at IS NULL), count(*) FILTER (WHERE unread_reply=1) FROM app_comments WHERE account_id=?1 AND app_id=?2",params![account,app_id],|r| Ok((r.get::<_,i64>(0)? as u64,r.get::<_,i64>(1)? as u64,r.get::<_,i64>(2)? as u64)))?;
    Ok(AppCommentAppMeta {
        app_id: app_id.to_owned(),
        revision: revision as u64,
        open_count,
        unsent_count,
        unread_reply_count,
    })
}
pub(super) fn bump(db: &Connection, account: &str, app_id: &str) -> rusqlite::Result<i64> {
    db.execute("INSERT INTO app_comment_apps(account_id,app_id,revision,next_number) VALUES(?1,?2,1,1) ON CONFLICT(account_id,app_id) DO UPDATE SET revision=revision+1",params![account,app_id])?;
    db.query_row(
        "SELECT revision FROM app_comment_apps WHERE account_id=?1 AND app_id=?2",
        params![account, app_id],
        |r| r.get(0),
    )
}
pub(super) fn notify(state: &AppState, account: &str, meta: &AppCommentAppMeta) {
    state.send_event_for_account(
        DeviceEvent::AppCommentsChanged { meta: meta.clone() },
        account,
    );
}
fn list_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_LIST_STORAGE_FAILED(e.to_string())
}
fn get_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_GET_STORAGE_FAILED(e.to_string())
}

impl AppState {
    pub(super) fn comment_metas(&self, account: &str) -> Result<Vec<AppCommentAppMeta>, CoreError> {
        let db = self.lock_db()?;
        let mut stmt = db
            .prepare("SELECT app_id FROM app_comment_apps WHERE account_id=?1 ORDER BY app_id")
            .map_err(list_error)?;
        let ids = stmt
            .query_map([account], |r| r.get::<_, String>(0))
            .map_err(list_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(list_error)?;
        ids.iter()
            .map(|id| meta(&db, account, id).map_err(list_error))
            .collect()
    }
    pub(super) fn list_comments(
        &self,
        account: &str,
        app_id: &str,
        resolved: Option<bool>,
        cursor: Option<&str>,
    ) -> Result<AppCommentListReply, CoreError> {
        let after: Option<(String, String)> = cursor
            .map(|s| {
                URL_SAFE_NO_PAD
                    .decode(s)
                    .ok()
                    .and_then(|v| serde_json::from_slice(&v).ok())
                    .ok_or_else(errors::COMMENT_LIST_CURSOR_INVALID)
            })
            .transpose()?;
        let db = self.lock_db()?;
        let app_revision = meta(&db, account, app_id).map_err(list_error)?.revision;
        let mut stmt = db.prepare(&format!("SELECT {SUMMARY_COLUMNS} FROM app_comments c WHERE c.account_id=?1 AND c.app_id=?2 AND (?3 IS NULL OR c.resolved=?3) AND (?4 IS NULL OR (c.created_at,c.id)>(?4,?5)) ORDER BY c.created_at,c.id")).map_err(list_error)?;
        let mut rows = stmt
            .query(params![
                account,
                app_id,
                resolved,
                after.as_ref().map(|c| &c.0),
                after.as_ref().map(|c| &c.1)
            ])
            .map_err(list_error)?;
        let mut result = AppCommentListReply {
            items: Vec::new(),
            next_cursor: None,
            app_revision,
        };
        while let Some(row) = rows.next().map_err(list_error)? {
            let item = summary_row(row).map_err(list_error)?;
            let cursor = URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(&(&item.created_at, &item.id)).map_err(list_error)?);
            result.items.push(item);
            result.next_cursor = Some(cursor);
            if serde_json::to_vec(&result).map_err(list_error)?.len() > STORAGE_JSON_MAX_BYTES {
                result.items.pop();
                if result.items.is_empty() {
                    return Err(list_error(
                        "저장된 커멘트 한 건이 목록 크기 한도를 넘었습니다",
                    ));
                }
                let last = result.items.last().unwrap();
                result.next_cursor = Some(URL_SAFE_NO_PAD.encode(
                    serde_json::to_vec(&(&last.created_at, &last.id)).map_err(list_error)?,
                ));
                return Ok(result);
            }
        }
        result.next_cursor = None;
        Ok(result)
    }
    pub(super) fn get_comment(
        &self,
        account: &str,
        app: Option<&str>,
        id: &str,
    ) -> Result<AppCommentThread, CoreError> {
        let db = self.lock_db()?;
        thread(&db, account, id)
            .map_err(get_error)?
            .filter(|t| app.is_none_or(|app| app == t.summary.app_id))
            .ok_or_else(|| errors::COMMENT_GET_NOT_FOUND(id))
    }
    pub(super) fn comment_image(
        &self,
        account: &str,
        app: Option<&str>,
        id: &str,
    ) -> Result<Vec<u8>, CoreError> {
        let db = self.lock_db()?;
        let image: Option<Vec<u8>> = db.query_row("SELECT image_png FROM app_comments WHERE account_id=?1 AND id=?2 AND (?3 IS NULL OR app_id=?3)",params![account,id,app],|r| r.get(0)).optional().map_err(|e| errors::COMMENT_IMAGE_STORAGE_FAILED(e.to_string()))?.flatten();
        image.ok_or_else(errors::COMMENT_IMAGE_NOT_FOUND)
    }
}
