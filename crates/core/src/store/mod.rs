//! 정적 스토어의 공개 자료와 설치 전 묶음.
pub(crate) mod bundle;
pub(crate) mod fetch;
pub(crate) mod install;
mod media;

#[cfg(test)]
pub(crate) mod tests;

use kaleidoscope_contract::{data::ResourceMediaRef, errors, CoreError};
use std::collections::BTreeMap;
use url::{Host, Url};

pub(crate) use fetch::StoreClient;
pub(crate) use media::{media_key, read_media};

pub(crate) fn client(inner: &crate::Inner, server: &str) -> Result<StoreClient<std::sync::Arc<dyn fetch::Transport>>, CoreError> {
    #[cfg(test)]
    if let Some(transport) = inner.store_transport.lock().unwrap().clone() {
        return StoreClient::with_transport(server, transport);
    }
    let _ = inner;
    StoreClient::with_transport(server, std::sync::Arc::new(fetch::PublicTransport))
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
        if url.scheme() != "https" {
            return Err(errors::STORECLIENT_URL_HTTPS_REQUIRED("입력한 주소"));
        }
        if input.chars().any(char::is_whitespace)
            || input.contains('\\')
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.port().is_some()
        {
            return Err(errors::STORECLIENT_URL_COMPONENT_INVALID());
        }
        match url.host() {
            Some(Host::Domain(host))
                if !host.eq_ignore_ascii_case("localhost")
                    && !host.to_ascii_lowercase().ends_with(".localhost") => {}
            Some(Host::Ipv4(ip)) if !kaleidoscope_data::public_http::is_public_ip(ip.into()) => {
                return Err(errors::STORECLIENT_URL_PRIVATE_ADDRESS())
            }
            Some(Host::Ipv6(ip)) if !kaleidoscope_data::public_http::is_public_ip(ip.into()) => {
                return Err(errors::STORECLIENT_URL_PRIVATE_ADDRESS())
            }
            Some(Host::Ipv4(_) | Host::Ipv6(_)) => {}
            Some(Host::Domain(_)) => return Err(errors::STORECLIENT_URL_PRIVATE_ADDRESS()),
            _ => return Err(errors::STORECLIENT_URL_COMPONENT_INVALID()),
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
