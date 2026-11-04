//! 공개 HTTPS 스토어 읽기.
use super::{media_ref, release_path, StoreUrl};
use kaleidoscope_contract::{
    data::ResourceMediaRef,
    errors,
    registry::RateLimitHint,
    store::{
        StoreDetailValue, StoreIndexItem, StoreIndexValue, StoreRelease, STORE_DETAIL_MAX_BYTES,
        STORE_INDEX_MAX_BYTES, STORE_MANIFEST_MAX_BYTES,
    },
    CoreError, PermissionDecl, Requires, Supported,
};
use kaleidoscope_data::public_http::{self, PublicHttpError, PublicResponse};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug)]
pub(crate) struct StoreFailure {
    pub error: CoreError,
    pub status: Option<u16>,
    pub rate_limit: Option<RateLimitHint>,
}
impl From<CoreError> for StoreFailure {
    fn from(error: CoreError) -> Self {
        Self {
            error,
            status: None,
            rate_limit: None,
        }
    }
}

pub(crate) trait Transport: Send + Sync {
    fn get(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError>;
}
impl<T: Transport + ?Sized> Transport for std::sync::Arc<T> {
    fn get(&self, origin: &str, paths: &[String], path: &str, limit: u64) -> Result<PublicResponse, PublicHttpError> {
        (**self).get(origin, paths, path, limit)
    }
}
pub(crate) struct PublicTransport;
impl Transport for PublicTransport {
    fn get(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError> {
        public_http::get_typed(origin, paths, path, &BTreeMap::new(), limit)
    }
}

pub(crate) struct StoreClient<T = PublicTransport> {
    pub(super) server: StoreUrl,
    pub(super) transport: T,
}
impl StoreClient<PublicTransport> {
    pub(crate) fn new(server: &str) -> Result<Self, CoreError> {
        Ok(Self {
            server: StoreUrl::parse(server)?,
            transport: PublicTransport,
        })
    }
}
impl<T: Transport> StoreClient<T> {
    pub(crate) fn with_transport(server: &str, transport: T) -> Result<Self, CoreError> {
        Ok(Self {
            server: StoreUrl::parse(server)?,
            transport,
        })
    }
    pub(super) fn bytes(&self, relative: &str, limit: u64) -> Result<PublicResponse, StoreFailure> {
        let path = self.server.path(relative)?;
        let allowed = vec![if self.server.prefix.is_empty() {
            path.clone()
        } else {
            format!("{}/", self.server.prefix)
        }];
        let response = self
            .transport
            .get(&self.server.origin, &allowed, &path, limit)
            .map_err(|error| {
                let err = match error {
                    PublicHttpError::InvalidAddress => super::path_error(relative),
                    PublicHttpError::PrivateAddress => errors::STORECLIENT_URL_PRIVATE_ADDRESS(),
                    PublicHttpError::TooLarge => errors::STORECLIENT_FETCH_TOO_LARGE(
                        relative,
                        kaleidoscope_contract::size::format_byte_limit(limit),
                    ),
                    PublicHttpError::Transport(reason) => {
                        errors::STORECLIENT_FETCH_TRANSPORT_FAILED(relative)
                            .and_details(vec![format!("원인: {reason}")])
                    }
                };
                StoreFailure::from(err)
            })?;
        let status = response.status;
        if !(200..300).contains(&status) {
            let mut error = match status {
                300..=399 => errors::STORECLIENT_FETCH_REDIRECT_REJECTED(relative),
                404 => errors::STORECLIENT_FETCH_NOT_FOUND(relative),
                _ => errors::STORECLIENT_FETCH_HTTP_REJECTED(relative),
            };
            let host = url::Url::parse(&self.server.origin)
                .ok()
                .and_then(|u| u.host_str().map(str::to_owned))
                .unwrap_or_default();
            error.details.push(format!("HTTP {status}; host={host}"));
            if let Some(retry_after) = &response.retry_after {
                error.details.push(format!("Retry-After: {retry_after}"));
            }
            return Err(StoreFailure {
                error,
                status: Some(status),
                rate_limit: response.rate_limit,
            });
        }
        Ok(response)
    }

    pub(super) fn json<D: serde::de::DeserializeOwned>(
        &self,
        relative: &str,
        limit: u64,
    ) -> Result<(D, Vec<u8>), StoreFailure> {
        let bytes = self.bytes(relative, limit)?.bytes;
        let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| {
            errors::STORECLIENT_JSON_INVALID(relative).and_details(vec![e.to_string()])
        })?;
        match value.get("format").and_then(|v| v.as_u64()) {
            Some(1) => {}
            Some(n) if n > 1 => return Err(errors::STORECLIENT_FORMAT_UNSUPPORTED(n).into()),
            _ => return Err(errors::STORECLIENT_JSON_INVALID(relative).into()),
        }
        let parsed = serde_json::from_value(value).map_err(|e| {
            errors::STORECLIENT_JSON_INVALID(relative).and_details(vec![e.to_string()])
        })?;
        Ok((parsed, bytes))
    }

    pub(crate) fn index(&self, permission: &str) -> Result<StoreIndexValue, StoreFailure> {
        let (index, _): (RawIndex, _) = self.json("index.json", STORE_INDEX_MAX_BYTES)?;
        let mut items = Vec::with_capacity(index.items.len());
        for item in index.items {
            let prefix = release_path(&item.id, item.release)?;
            let icon = item
                .icon
                .map(|p| self.image_ref(permission, &prefix, p, "assets/"))
                .transpose()?;
            items.push(StoreIndexItem {
                id: item.id,
                name: item.name,
                summary: item.summary,
                category: item.category,
                publisher: item.publisher,
                release: item.release,
                icon,
                badges: item.badges,
                compatible: Supported::current().renders(&item.requires),
                requires: item.requires,
                updated_at: item.updated_at,
            });
        }
        Ok(StoreIndexValue {
            format: index.format,
            generated_at: index.generated_at,
            server: self.server.as_str().into(),
            items,
        })
    }

    pub(crate) fn app(&self, id: &str, permission: &str) -> Result<StoreDetailValue, StoreFailure> {
        let prefix = release_path(id, 1)?;
        let app_prefix = prefix.strip_suffix("1/").unwrap();
        let (detail, _): (RawDetail, _) =
            self.json(&format!("{app_prefix}index.json"), STORE_DETAIL_MAX_BYTES)?;
        if detail.id != id {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        for release in &detail.releases {
            let expected = format!("{}manifest.json", release_path(id, release.release)?);
            if release.manifest != expected {
                return Err(super::path_error(&release.manifest).into());
            }
            self.server.path(&release.manifest)?;
        }
        let current = detail
            .releases
            .first()
            .ok_or_else(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH)?;
        let prefix = release_path(id, detail.release)?;
        if current.release != detail.release || current.manifest != format!("{prefix}manifest.json")
        {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let (manifest, _): (Manifest, _) =
            self.json(&current.manifest, STORE_MANIFEST_MAX_BYTES)?;
        if manifest.store_app_id != id || manifest.release != detail.release {
            return Err(errors::STORECLIENT_BUNDLE_DECLARATION_MISMATCH().into());
        }
        let icon = detail
            .icon
            .map(|p| self.image_ref(permission, &prefix, p, "assets/"))
            .transpose()?;
        let screenshots = detail
            .screenshots
            .into_iter()
            .map(|p| self.image_ref(permission, &prefix, p, "screenshots/"))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(StoreDetailValue {
            format: detail.format,
            id: detail.id,
            name: detail.name,
            summary: detail.summary,
            description: detail.description,
            category: detail.category,
            publisher: detail.publisher,
            release: detail.release,
            icon,
            screenshots,
            releases: detail.releases,
            server: self.server.as_str().into(),
            compatible: Supported::current().renders(&manifest.requires),
            requires: manifest.requires,
            permissions: manifest.permissions,
            badges: manifest.badges,
        })
    }

    fn image_ref(
        &self,
        permission: &str,
        prefix: &str,
        path: String,
        sub: &str,
    ) -> Result<ResourceMediaRef, CoreError> {
        if !path.starts_with(&format!("{prefix}{sub}")) {
            return Err(super::path_error(&path));
        }
        media_ref(&self.server, permission, path)
    }
}

#[derive(Deserialize)]
struct RawIndex {
    format: u32,
    generated_at: String,
    items: Vec<RawItem>,
}
#[derive(Deserialize)]
struct RawItem {
    id: String,
    name: String,
    summary: String,
    category: String,
    publisher: String,
    release: u32,
    icon: Option<String>,
    badges: Vec<String>,
    requires: Requires,
    updated_at: String,
}
#[derive(Deserialize)]
struct RawDetail {
    format: u32,
    id: String,
    name: String,
    summary: String,
    description: String,
    category: String,
    publisher: String,
    release: u32,
    icon: Option<String>,
    screenshots: Vec<String>,
    releases: Vec<StoreRelease>,
}
#[derive(Deserialize)]
pub(super) struct Manifest {
    pub format: u32,
    pub store_app_id: String,
    pub release: u32,
    #[serde(rename = "name")]
    pub _name: String,
    #[serde(rename = "summary")]
    pub _summary: String,
    #[serde(rename = "description")]
    pub _description: String,
    #[serde(rename = "category")]
    pub _category: String,
    #[serde(rename = "publisher")]
    pub _publisher: String,
    #[serde(rename = "published_at")]
    pub _published_at: String,
    pub icon: Option<String>,
    pub screenshots: Vec<String>,
    pub requires: Requires,
    pub permissions: Vec<PermissionDecl>,
    pub badges: Vec<String>,
    pub files: BTreeMap<String, ManifestFile>,
}
#[derive(Deserialize)]
pub(super) struct ManifestFile {
    pub sha256: String,
    pub bytes: u64,
    pub format: Option<kaleidoscope_contract::assets::AssetFormat>,
    pub source: Option<String>,
    pub license: Option<String>,
}
