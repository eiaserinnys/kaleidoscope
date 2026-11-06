//! 정적 스토어의 공개 자료와 설치 전 묶음.
pub(crate) mod bundle;
pub(crate) mod fetch;
pub(crate) mod install;
mod media;
mod transport;

#[cfg(test)]
pub(crate) mod tests;

use kaleidoscope_contract::{data::ResourceMediaRef, errors, CoreError};
use std::collections::BTreeMap;
use url::{Host, Url};

pub(crate) use fetch::StoreClient;
pub(crate) use media::{media_key, read_media};

pub(crate) fn client(inner: &crate::Inner, server: &str) -> Result<StoreClient<std::sync::Arc<dyn fetch::Transport>>, CoreError> {
    let server = StoreUrl::parse(server)?;
    let allowed = authorize(&server, &inner.state.lock().unwrap().device.store_servers)?;
    #[cfg(test)]
    if let Some(transport) = inner.store_transport.lock().unwrap().clone() {
        return Ok(StoreClient::new(server, transport));
    }
    let transport: std::sync::Arc<dyn fetch::Transport> = if allowed {
        std::sync::Arc::new(transport::AllowedServerTransport)
    } else {
        std::sync::Arc::new(fetch::PublicTransport)
    };
    Ok(StoreClient::new(server, transport))
}

/// 목록에 있으면 전용 전송, 공개 형식이면 기존 공개 전송을 고른다.
pub(crate) fn authorize(server: &StoreUrl, allowed: &[String]) -> Result<bool, CoreError> {
    if allowed.iter().any(|item| item == server.as_str()) {
        return Ok(true);
    }
    let url = Url::parse(server.as_str()).expect("정규화된 스토어 주소");
    let private_host = match url.host().expect("스토어 주소의 호스트") {
        Host::Domain(host) => host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost"),
        Host::Ipv4(ip) => !kaleidoscope_data::public_http::is_public_ip(ip.into()),
        Host::Ipv6(ip) => !kaleidoscope_data::public_http::is_public_ip(ip.into()),
    };
    if url.scheme() == "http" || url.port().is_some() || private_host {
        return Err(errors::STORECLIENT_SERVER_PERMISSION_REQUIRED(server.as_str()));
    }
    Ok(false)
}

#[derive(Debug, Clone)]
pub(crate) struct StoreUrl {
    normalized: String,
    origin: String,
    prefix: String,
}

impl StoreUrl {
    pub(crate) fn parse(input: &str) -> Result<Self, CoreError> {
        let url = Url::parse(input).map_err(|_| errors::STORECLIENT_URL_COMPONENT_INVALID())?;
        if !matches!(url.scheme(), "http" | "https")
            || input.chars().any(char::is_whitespace)
            || input.contains('\\')
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        if url.host().is_none() {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        // URL 파서가 점 경로를 정규화하기 전의 원문도 검사한다.
        let authority = input
            .split_once("://")
            .ok_or_else(errors::STORECLIENT_URL_COMPONENT_INVALID)?
            .1;
        if authority
            .split('/')
            .next()
            .is_some_and(|part| part.contains('@'))
        {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        let raw_path = authority.find('/').map_or("", |i| &authority[i..]);
        if raw_path.contains('\\') {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        let raw_prefix = raw_path.trim_end_matches('/');
        if !raw_prefix.is_empty()
            && !kaleidoscope_contract::validate::valid_public_http_path(raw_prefix)
        {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        let prefix = url.path().trim_end_matches('/');
        let origin = url.origin().ascii_serialization();
        let normalized = format!("{origin}{prefix}");
        Ok(Self {
            normalized,
            origin,
            prefix: prefix.into(),
        })
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.normalized
    }

    pub(crate) fn path(&self, relative: &str) -> Result<String, CoreError> {
        let path = format!("/{}", relative);
        if relative.is_empty()
            || !kaleidoscope_contract::validate::valid_public_http_path(&path)
            || relative.contains(':')
        {
            return Err(path_error(relative));
        }
        Ok(format!("{}{}", self.prefix, path))
    }
}

pub(super) fn path_error(path: &str) -> CoreError {
    let visible = if path.contains("://") || path.starts_with("//") {
        "외부 주소"
    } else {
        path.split(['?', '#']).next().unwrap_or("")
    };
    errors::STORECLIENT_PATH_OUTSIDE_STORE(visible)
}

pub(crate) fn media_ref(
    server: &StoreUrl,
    permission: &str,
    path: String,
) -> Result<ResourceMediaRef, CoreError> {
    server.path(&path)?;
    Ok(ResourceMediaRef {
        permission: permission.into(),
        path,
        query: BTreeMap::from([("server".into(), server.as_str().into())]),
        crop: None,
    })
}

pub(crate) fn release_path(id: &str, release: u32) -> Result<String, CoreError> {
    if id.is_empty()
        || release == 0
        || id.contains('/')
        || id.contains(':')
        || id.contains('%')
        || !kaleidoscope_contract::validate::valid_public_http_path(&format!("/{id}"))
    {
        return Err(path_error(id));
    }
    Ok(format!("apps/{id}/{release}/"))
}
