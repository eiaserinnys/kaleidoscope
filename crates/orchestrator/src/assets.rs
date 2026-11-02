//! 계정별 불변 자산 등록과 기기 다운로드.
use super::*;
use axum::extract::{Extension, Path, State};
use kaleidoscope_contract::assets::{AssetDep, AssetFormat, AssetMeta, AssetUpload};

pub(super) struct PreparedAsset {
    upload: AssetUpload,
    bytes: Vec<u8>,
}

pub(super) fn prepare(upload: &AssetUpload) -> Result<PreparedAsset, CoreError> {
    let bytes = kaleidoscope_data::asset_validation::validate_upload(upload)?;
    Ok(PreparedAsset {
        upload: upload.clone(),
        bytes,
    })
}

fn format_name(format: AssetFormat) -> &'static str {
    match format {
        AssetFormat::Html => "html",
        AssetFormat::Svg => "svg",
        AssetFormat::Png => "png",
        AssetFormat::Webp => "webp",
        AssetFormat::Jpeg => "jpeg",
        AssetFormat::Gif => "gif",
        AssetFormat::Javascript => "javascript",
        AssetFormat::Woff2 => "woff2",
        AssetFormat::Ttf => "ttf",
        AssetFormat::Otf => "otf",
    }
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(AssetMeta, Vec<u8>)> {
    let raw_format: String = row.get(2)?;
    let format = match raw_format.as_str() {
        "html" => AssetFormat::Html,
        "svg" => AssetFormat::Svg,
        "png" => AssetFormat::Png,
        "webp" => AssetFormat::Webp,
        "jpeg" => AssetFormat::Jpeg,
        "gif" => AssetFormat::Gif,
        "javascript" => AssetFormat::Javascript,
        "woff2" => AssetFormat::Woff2,
        "ttf" => AssetFormat::Ttf,
        "otf" => AssetFormat::Otf,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok((
        AssetMeta {
            id: row.get(0)?,
            version: row.get(1)?,
            format,
            sha256: row.get(3)?,
            source: row.get(4)?,
            license: row.get(5)?,
            byte_size: row.get::<_, i64>(6)? as u64,
            created_at: row.get(7)?,
        },
        row.get(8)?,
    ))
}

pub(super) fn get_in(
    db: &Connection,
    account: &str,
    id: &str,
    version: u32,
    query_failed: impl FnOnce() -> CoreError,
) -> Result<Option<(AssetMeta, Vec<u8>)>, CoreError> {
    db.query_row("SELECT id,version,format,sha256,source,license,byte_size,created_at,bytes FROM asset_versions WHERE account_id=?1 AND id=?2 AND version=?3",
        params![account, id, version], read_row).optional().map_err(|error| {
            query_failed().and_details(vec![error.to_string()])
        })
}

pub(super) fn insert(
    tx: &Transaction<'_>,
    account: &str,
    prepared: &PreparedAsset,
) -> Result<AssetMeta, CoreError> {
    let upload = &prepared.upload;
    if let Some((existing, bytes)) = get_in(tx, account, &upload.id, upload.version, || {
        kaleidoscope_contract::errors::ASSET_REGISTER_EXISTING_LOOKUP_FAILED(
            &upload.id,
            upload.version,
        )
    })? {
        if existing.format == upload.format
            && existing.sha256 == upload.sha256
            && existing.source == upload.source
            && existing.license == upload.license
            && bytes == prepared.bytes
        {
            return Ok(existing);
        }
        return Err(
            kaleidoscope_contract::errors::ASSET_REGISTER_VERSION_CONFLICT(
                &upload.id,
                upload.version,
            ),
        );
    }
    let meta = AssetMeta {
        id: upload.id.clone(),
        version: upload.version,
        format: upload.format,
        sha256: upload.sha256.clone(),
        source: upload.source.clone(),
        license: upload.license.clone(),
        byte_size: prepared.bytes.len() as u64,
        created_at: timestamp(),
    };
    tx.execute("INSERT INTO asset_versions(account_id,id,version,format,sha256,source,license,byte_size,created_at,bytes) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![account, meta.id, meta.version, format_name(meta.format), meta.sha256, meta.source, meta.license, meta.byte_size as i64, meta.created_at, prepared.bytes]).map_err(|error| {
            kaleidoscope_contract::errors::ASSET_REGISTER_INSERT_FAILED(&upload.id, upload.version)
                .and_details(vec![error.to_string()])
        })?;
    Ok(meta)
}

pub(super) fn verify_dependencies(
    tx: &Transaction<'_>,
    account: &str,
    assets: &[AssetDep],
) -> Result<(), CoreError> {
    for asset in assets {
        if !kaleidoscope_contract::builtin::is_bundled_asset(&asset.id, asset.version)
            && get_in(tx, account, &asset.id, asset.version, || {
                kaleidoscope_contract::errors::ASSET_APP_DEPENDENCY_LOOKUP_FAILED(
                    &asset.id,
                    asset.version,
                )
            })?
            .is_none()
        {
            return Err(
                kaleidoscope_contract::errors::ASSET_APP_DEPENDENCY_NOT_FOUND(
                    &asset.id,
                    asset.version,
                ),
            );
        }
    }
    Ok(())
}

pub(super) fn verify_client_entry(
    db: &Connection,
    account: &str,
    definition: &AppDefinition,
) -> Result<(), CoreError> {
    if let Some(client) = &definition.client {
        let asset = get_in(db, account, &client.entry.id, client.entry.version, || {
            kaleidoscope_contract::errors::ASSET_APP_CLIENT_ENTRY_LOOKUP_FAILED(
                &client.entry.id,
                client.entry.version,
            )
        })?;
        let Some((meta, _)) = asset else {
            return Err(
                kaleidoscope_contract::errors::ASSET_APP_CLIENT_ENTRY_NOT_FOUND(
                    &client.entry.id,
                    client.entry.version,
                ),
            );
        };
        if meta.format != AssetFormat::Javascript {
            return Err(
                kaleidoscope_contract::errors::ASSET_APP_CLIENT_ENTRY_FORMAT_INVALID(
                    &client.entry.id,
                    client.entry.version,
                ),
            );
        }
    }
    Ok(())
}

impl AppState {
    pub(super) fn upload_asset(&self, upload: &AssetUpload) -> Result<AssetMeta, CoreError> {
        let prepared = prepare(upload)?;
        let account = self.mcp_account_id()?;
        let mut db = self.lock_db()?;
        let tx = db.transaction().map_err(|error| {
            kaleidoscope_contract::errors::ASSET_REGISTER_TRANSACTION_BEGIN_FAILED(&upload.id)
                .and_details(vec![error.to_string()])
        })?;
        let meta = insert(&tx, &account, &prepared)?;
        tx.commit().map_err(|error| {
            kaleidoscope_contract::errors::ASSET_REGISTER_TRANSACTION_COMMIT_FAILED(&upload.id)
                .and_details(vec![error.to_string()])
        })?;
        Ok(meta)
    }

    pub(super) fn list_assets(&self) -> Result<Vec<AssetMeta>, CoreError> {
        let account = self.mcp_account_id()?;
        let db = self.lock_db()?;
        let mut statement = db.prepare("SELECT id,version,format,sha256,source,license,byte_size,created_at,X'' FROM asset_versions WHERE account_id=?1 ORDER BY id,version").map_err(|error| {
            kaleidoscope_contract::errors::ASSET_LIST_PREPARE_FAILED()
                .and_details(vec![error.to_string()])
        })?;
        let rows = statement.query_map([account], read_row).map_err(|error| {
            kaleidoscope_contract::errors::ASSET_LIST_QUERY_FAILED()
                .and_details(vec![error.to_string()])
        })?;
        rows.map(|row| {
            row.map(|(meta, _)| meta).map_err(|error| {
                kaleidoscope_contract::errors::ASSET_LIST_ROW_READ_FAILED()
                    .and_details(vec![error.to_string()])
            })
        })
        .collect()
    }

    pub(super) fn get_asset(
        &self,
        account: &str,
        id: &str,
        version: u32,
    ) -> Result<Option<(AssetMeta, Vec<u8>)>, CoreError> {
        if id.starts_with("builtin-") {
            return Ok(None);
        }
        let db = self.lock_db()?;
        get_in(&db, account, id, version, || {
            kaleidoscope_contract::errors::ASSET_DOWNLOAD_LOOKUP_FAILED(id, version)
        })
    }
}

pub(super) async fn device_get(
    State(state): State<AppState>,
    Extension(device): Extension<(String, String)>,
    Path((id, version)): Path<(String, u32)>,
) -> Response {
    let result = state
        .device_account_id(&device.0)
        .and_then(|account| state.get_asset(&account, &id, version));
    match result {
        Ok(Some((meta, bytes))) => {
            let mime = match meta.format {
                AssetFormat::Html => "text/html",
                AssetFormat::Svg => "image/svg+xml",
                AssetFormat::Png => "image/png",
                AssetFormat::Webp => "image/webp",
                AssetFormat::Jpeg => "image/jpeg",
                AssetFormat::Gif => "image/gif",
                AssetFormat::Javascript => "text/javascript",
                AssetFormat::Woff2 => "font/woff2",
                AssetFormat::Ttf => "font/ttf",
                AssetFormat::Otf => "font/otf",
            };
            (
                [
                    (header::CONTENT_TYPE, mime.to_string()),
                    (header::ETAG, format!("\"{}\"", meta.sha256)),
                    (header::CACHE_CONTROL, "private, no-store".into()),
                ],
                bytes,
            )
                .into_response()
        }
        Ok(None) => super::http::error_response(
            StatusCode::NOT_FOUND,
            kaleidoscope_contract::errors::ASSET_DOWNLOAD_NOT_FOUND(&id, version),
        ),
        Err(error) => super::http::error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}
