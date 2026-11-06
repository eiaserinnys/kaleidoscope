use super::app_comments::{bump, meta, notify, summary, thread};
use super::*;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use kaleidoscope_contract::{
    app_comments::*, app_storage::STORAGE_JSON_MAX_BYTES, data::MEDIA_MAX_BYTES, errors,
    CONVERSATION_MESSAGE_MAX_CHARS,
};

fn size_limit(n: u64) -> String {
    kaleidoscope_contract::size::format_byte_limit(n)
}
fn image_bytes(image: &Option<AppCommentImage>) -> Result<Option<Vec<u8>>, CoreError> {
    let Some(image) = image else { return Ok(None) };
    if image.image_base64.len() as u64 > ((MEDIA_MAX_BYTES + 2) / 3) * 4 {
        return Err(errors::COMMENT_CREATE_IMAGE_TOO_LARGE(size_limit(
            MEDIA_MAX_BYTES,
        )));
    }
    let bytes = STANDARD
        .decode(&image.image_base64)
        .map_err(|_| errors::COMMENT_CREATE_IMAGE_INVALID())?;
    if bytes.len() as u64 > MEDIA_MAX_BYTES {
        return Err(errors::COMMENT_CREATE_IMAGE_TOO_LARGE(size_limit(
            MEDIA_MAX_BYTES,
        )));
    }
    if kaleidoscope_data::asset_validation::validate_bytes(
        kaleidoscope_contract::assets::AssetFormat::Png,
        &bytes,
    )
    .is_err()
        || bytes.len() < 24
    {
        return Err(errors::COMMENT_CREATE_IMAGE_INVALID());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if image.meta.width != width
        || image.meta.height != height
        || image.meta.byte_size != bytes.len() as u64
    {
        return Err(errors::COMMENT_CREATE_IMAGE_INVALID());
    }
    Ok(Some(bytes))
}
fn create_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_CREATE_STORAGE_FAILED(e.to_string())
}
fn reply_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_REPLY_STORAGE_FAILED(e.to_string())
}
fn resolve_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_RESOLVE_STORAGE_FAILED(e.to_string())
}
fn delete_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_DELETE_STORAGE_FAILED(e.to_string())
}
fn sent_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_MARK_SENT_STORAGE_FAILED(e.to_string())
}
fn read_error(e: impl std::fmt::Display) -> CoreError {
    errors::COMMENT_MARK_READ_STORAGE_FAILED(e.to_string())
}

impl AppState {
    pub(super) fn create_comment(
        &self,
        account: &str,
        app_id: &str,
        request: AppCommentCreateRequest,
    ) -> Result<(AppCommentThread, AppCommentAppMeta), CoreError> {
        if app_id.trim().is_empty() {
            return Err(errors::COMMENT_CREATE_APP_ID_EMPTY());
        }
        if request.text.trim().is_empty() {
            return Err(errors::COMMENT_CREATE_TEXT_EMPTY());
        }
        if request.text.chars().count() > CONVERSATION_MESSAGE_MAX_CHARS {
            return Err(errors::COMMENT_CREATE_TEXT_TOO_LONG(
                CONVERSATION_MESSAGE_MAX_CHARS.to_string(),
            ));
        }
        if request.anchor.schema_version != APP_COMMENT_ANCHOR_SCHEMA_VERSION {
            return Err(errors::COMMENT_CREATE_ANCHOR_INVALID("schema_version"));
        }
        let anchor = serde_json::to_string(&request.anchor).map_err(create_error)?;
        let origin = serde_json::to_string(&request.origin).map_err(create_error)?;
        if serde_json::to_vec(&(&request.anchor, &request.text))
            .map_err(create_error)?
            .len()
            > STORAGE_JSON_MAX_BYTES
        {
            return Err(errors::COMMENT_CREATE_BODY_TOO_LARGE(size_limit(
                STORAGE_JSON_MAX_BYTES as u64,
            )));
        }
        let bytes = image_bytes(&request.image)?;
        let image_meta = request
            .image
            .as_ref()
            .map(|i| serde_json::to_string(&i.meta))
            .transpose()
            .map_err(create_error)?;
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(create_error)?;
        if let Some(existing) = thread(&tx, account, &request.id).map_err(create_error)? {
            let s = &existing.summary;
            let stored: Option<Vec<u8>> = tx
                .query_row(
                    "SELECT image_png FROM app_comments WHERE account_id=?1 AND id=?2",
                    params![account, request.id],
                    |r| r.get(0),
                )
                .map_err(create_error)?;
            let equal = s.app_id == app_id
                && s.anchor == request.anchor
                && s.text == request.text
                && s.origin == request.origin
                && s.created_app_version == request.created_app_version
                && s.created_definition_digest == request.created_definition_digest
                && s.created_shell_version == request.created_shell_version
                && s.source_window_id == request.source_window_id
                && s.image == request.image.as_ref().map(|i| i.meta.clone())
                && stored == bytes;
            if !equal {
                return Err(errors::COMMENT_CREATE_ID_CONFLICT());
            }
            let m = meta(&tx, account, app_id).map_err(create_error)?;
            return Ok((existing, m));
        }
        let revision = bump(&tx, account, app_id).map_err(create_error)?;
        let number: i64 = tx
            .query_row(
                "SELECT next_number FROM app_comment_apps WHERE account_id=?1 AND app_id=?2",
                params![account, app_id],
                |r| r.get(0),
            )
            .map_err(create_error)?;
        tx.execute("UPDATE app_comment_apps SET next_number=next_number+1 WHERE account_id=?1 AND app_id=?2",params![account,app_id]).map_err(create_error)?;
        let now = timestamp();
        tx.execute("INSERT INTO app_comments(account_id,id,app_id,number,created_app_version,created_definition_digest,created_shell_version,origin_json,source_window_id,anchor_json,text,resolved,resolved_app_version,sent_at,unread_reply,created_at,updated_at,revision,image_meta_json,image_png) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,NULL,NULL,0,?12,?12,?13,?14,?15)",params![account,request.id,app_id,number,request.created_app_version,request.created_definition_digest,request.created_shell_version,origin,request.source_window_id,anchor,request.text,now,revision,image_meta,bytes]).map_err(create_error)?;
        let result = thread(&tx, account, &request.id)
            .map_err(create_error)?
            .unwrap();
        let m = meta(&tx, account, app_id).map_err(create_error)?;
        let mut largest = result.summary.clone();
        largest.sent_at = Some(now.clone());
        largest.resolved_app_version = Some(u32::MAX);
        largest.reply_count = u64::MAX;
        largest.revision = u64::MAX;
        let cursor = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&(&largest.created_at, &largest.id)).map_err(create_error)?);
        let page = AppCommentListReply {
            items: vec![largest],
            next_cursor: Some(cursor),
            app_revision: u64::MAX,
        };
        if serde_json::to_vec(&page).map_err(create_error)?.len() > STORAGE_JSON_MAX_BYTES {
            return Err(errors::COMMENT_CREATE_BODY_TOO_LARGE(size_limit(
                STORAGE_JSON_MAX_BYTES as u64,
            )));
        }
        tx.commit().map_err(create_error)?;
        drop(db);
        notify(self, account, &m);
        Ok((result, m))
    }
    pub(super) fn reply_comment(
        &self,
        account: &str,
        app: Option<&str>,
        id: &str,
        request: AppCommentReplyRequest,
        author: AppCommentAuthor,
    ) -> Result<(AppCommentReply, AppCommentAppMeta), CoreError> {
        if request.text.trim().is_empty() {
            return Err(errors::COMMENT_REPLY_TEXT_EMPTY());
        }
        if request.text.chars().count() > CONVERSATION_MESSAGE_MAX_CHARS {
            return Err(errors::COMMENT_REPLY_TEXT_TOO_LONG(
                CONVERSATION_MESSAGE_MAX_CHARS.to_string(),
            ));
        }
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(reply_error)?;
        let s = summary(&tx, account, id)
            .map_err(reply_error)?
            .filter(|s| app.is_none_or(|a| a == s.app_id))
            .ok_or_else(|| errors::COMMENT_REPLY_THREAD_NOT_FOUND(id))?;
        let previous: Option<(String,String,String)> = tx.query_row("SELECT author,text,created_at FROM app_comment_replies WHERE account_id=?1 AND comment_id=?2 AND id=?3",params![account,id,request.id],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(reply_error)?;
        let author_text = match author {
            AppCommentAuthor::User => "user",
            AppCommentAuthor::Agent => "agent",
        };
        if let Some((old_author, text, created_at)) = previous {
            if old_author != author_text || text != request.text {
                return Err(errors::COMMENT_REPLY_ID_CONFLICT());
            }
            let m = meta(&tx, account, &s.app_id).map_err(reply_error)?;
            return Ok((
                AppCommentReply {
                    id: request.id,
                    author,
                    text,
                    created_at,
                },
                m,
            ));
        }
        let now = timestamp();
        tx.execute("INSERT INTO app_comment_replies(account_id,comment_id,id,author,text,created_at) VALUES(?1,?2,?3,?4,?5,?6)",params![account,id,request.id,author_text,request.text,now]).map_err(reply_error)?;
        let rev = bump(&tx, account, &s.app_id).map_err(reply_error)?;
        tx.execute("UPDATE app_comments SET updated_at=?3, revision=?4, unread_reply=CASE WHEN ?5='agent' THEN 1 ELSE unread_reply END WHERE account_id=?1 AND id=?2",params![account,id,now,rev,author_text]).map_err(reply_error)?;
        let m = meta(&tx, account, &s.app_id).map_err(reply_error)?;
        let reply = AppCommentReply {
            id: request.id,
            author,
            text: request.text,
            created_at: now,
        };
        tx.commit().map_err(reply_error)?;
        drop(db);
        notify(self, account, &m);
        Ok((reply, m))
    }
    pub(super) fn resolve_comment(
        &self,
        account: &str,
        app: Option<&str>,
        id: &str,
        request: AppCommentResolveRequest,
    ) -> Result<(AppCommentThread, AppCommentAppMeta), CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(resolve_error)?;
        let s = summary(&tx, account, id)
            .map_err(resolve_error)?
            .filter(|s| app.is_none_or(|a| a == s.app_id))
            .ok_or_else(|| errors::COMMENT_RESOLVE_NOT_FOUND(id))?;
        let rev = bump(&tx, account, &s.app_id).map_err(resolve_error)?;
        tx.execute("UPDATE app_comments SET resolved=?3,resolved_app_version=?4,updated_at=?5,revision=?6 WHERE account_id=?1 AND id=?2",params![account,id,request.resolved,if request.resolved {request.fixed_app_version} else {None},timestamp(),rev]).map_err(resolve_error)?;
        let result = thread(&tx, account, id).map_err(resolve_error)?.unwrap();
        let m = meta(&tx, account, &s.app_id).map_err(resolve_error)?;
        tx.commit().map_err(resolve_error)?;
        drop(db);
        notify(self, account, &m);
        Ok((result, m))
    }
    pub(super) fn delete_comment(
        &self,
        account: &str,
        app: &str,
        id: &str,
    ) -> Result<AppCommentAppMeta, CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(delete_error)?;
        let changed = tx
            .execute(
                "DELETE FROM app_comments WHERE account_id=?1 AND app_id=?2 AND id=?3",
                params![account, app, id],
            )
            .map_err(delete_error)?;
        if changed > 0 {
            bump(&tx, account, app).map_err(delete_error)?;
        }
        let m = meta(&tx, account, app).map_err(delete_error)?;
        tx.commit().map_err(delete_error)?;
        drop(db);
        if changed > 0 {
            notify(self, account, &m);
        }
        Ok(m)
    }
    pub(super) fn mark_comments_sent(
        &self,
        account: &str,
        app: &str,
        ids: &[String],
    ) -> Result<AppCommentAppMeta, CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(sent_error)?;
        let mut found = false;
        let mut changed = false;
        let now = timestamp();
        for id in ids {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM app_comments WHERE account_id=?1 AND app_id=?2 AND id=?3)",params![account,app,id],|r| r.get(0)).map_err(sent_error)?;
            found |= exists;
            changed |= tx.execute("UPDATE app_comments SET sent_at=?4 WHERE account_id=?1 AND app_id=?2 AND id=?3 AND sent_at IS NULL",params![account,app,id,now]).map_err(sent_error)? > 0;
        }
        if !found {
            return Err(errors::COMMENT_MARK_SENT_NOT_FOUND(
                ids.first().map(String::as_str).unwrap_or(""),
            ));
        }
        if changed {
            let rev = bump(&tx, account, app).map_err(sent_error)?;
            for id in ids {
                tx.execute("UPDATE app_comments SET revision=?4,updated_at=?5 WHERE account_id=?1 AND app_id=?2 AND id=?3 AND sent_at=?5",params![account,app,id,rev,now]).map_err(sent_error)?;
            }
        }
        let m = meta(&tx, account, app).map_err(sent_error)?;
        tx.commit().map_err(sent_error)?;
        drop(db);
        if changed {
            notify(self, account, &m);
        }
        Ok(m)
    }
    pub(super) fn mark_comment_read(
        &self,
        account: &str,
        app: &str,
        id: &str,
    ) -> Result<AppCommentAppMeta, CoreError> {
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(read_error)?;
        let s = summary(&tx, account, id)
            .map_err(read_error)?
            .filter(|s| s.app_id == app)
            .ok_or_else(|| errors::COMMENT_MARK_READ_NOT_FOUND(id))?;
        if s.unread_reply {
            let rev = bump(&tx, account, app).map_err(read_error)?;
            tx.execute("UPDATE app_comments SET unread_reply=0,updated_at=?3,revision=?4 WHERE account_id=?1 AND id=?2",params![account,id,timestamp(),rev]).map_err(read_error)?;
        }
        let m = meta(&tx, account, app).map_err(read_error)?;
        tx.commit().map_err(read_error)?;
        drop(db);
        if s.unread_reply {
            notify(self, account, &m);
        }
        Ok(m)
    }
}
