//! 이 기기에서 허용한 스토어의 읽기 전용 전송.
use std::{collections::BTreeMap, io::Read, time::Duration};

use kaleidoscope_data::public_http::{PublicHttpError, PublicResponse};

use super::fetch::Transport;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) struct AllowedServerTransport;

impl AllowedServerTransport {
    fn request(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        invite: Option<&str>,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError> {
        if !kaleidoscope_contract::validate::allowed_public_http_path(paths, path) {
            return Err(PublicHttpError::InvalidAddress);
        }
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| PublicHttpError::Transport(error.to_string()))?;
        let mut request = client.get(format!("{origin}{path}"));
        if let Some(invite) = invite {
            request = request.header(super::fetch::INVITE_HEADER, invite);
        }
        let mut response = request
            .send()
            .map_err(|error| PublicHttpError::Transport(error.without_url().to_string()))?;
        let status = response.status().as_u16();
        let mut headers = BTreeMap::<String, String>::new();
        for (name, value) in response.headers() {
            let name = name.as_str();
            if name == "set-cookie" || name == "set-cookie2" {
                continue;
            }
            if let Ok(value) = value.to_str() {
                headers
                    .entry(name.into())
                    .and_modify(|v| {
                        v.push_str(", ");
                        v.push_str(value);
                    })
                    .or_insert_with(|| value.into());
            }
        }
        let rate_limit = kaleidoscope_data::rate_limit::rate_limit(status, response.headers());
        let retry_after = headers.get("retry-after").cloned();
        let mime = headers.get("content-type").cloned().unwrap_or_default();
        let mut bytes = Vec::new();
        (&mut response)
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| PublicHttpError::Transport(error.to_string()))?;
        if bytes.len() as u64 > limit {
            return Err(PublicHttpError::TooLarge);
        }
        Ok(PublicResponse {
            status,
            headers,
            rate_limit,
            retry_after,
            mime,
            bytes,
        })
    }
}

impl Transport for AllowedServerTransport {
    fn get(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError> {
        self.request(origin, paths, path, None, limit)
    }

    fn get_with_invite(
        &self,
        origin: &str,
        paths: &[String],
        path: &str,
        invite: &str,
        limit: u64,
    ) -> Result<PublicResponse, PublicHttpError> {
        self.request(origin, paths, path, Some(invite), limit)
    }
}
