//! 인증 없는 공개 HTTPS 요청. 확인한 DNS 주소로만 연결한다.
use std::collections::BTreeMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use kaleidoscope_contract::{
    data::{self, HttpMethod},
    validate::{allowed_public_http_path, valid_https_origin},
};

pub struct PublicResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub rate_limit: Option<kaleidoscope_contract::registry::RateLimitHint>,
    pub retry_after: Option<String>,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub enum PublicHttpError {
    InvalidAddress,
    PrivateAddress,
    Transport(String),
    TooLarge,
}

impl std::fmt::Display for PublicHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidAddress => write!(f, "허용하지 않은 공개 HTTPS 주소 또는 경로입니다"),
            Self::PrivateAddress => write!(f, "공개 주소가 아닌 DNS 결과입니다"),
            Self::Transport(reason) => write!(f, "{reason}"),
            Self::TooLarge => write!(f, "응답이 너무 큽니다"),
        }
    }
}

fn client_builder() -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("kaleidoscope/", env!("CARGO_PKG_VERSION")))
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => public_v6(ip),
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    // 공개 전역 유니캐스트 범위만 허용하고 문서용 접두어를 제외한다.
    segments[0] & 0xe000 == 0x2000
        && !(segments[0] == 0x2001 && segments[1] < 0x0200)
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        && segments[0] != 0x2002
        && !(segments[0] == 0x3fff && segments[1] & 0xf000 == 0)
        && ip.to_ipv4_mapped().is_none()
}

pub fn get(
    base_url: &str,
    paths: &[String],
    path: &str,
    query: &BTreeMap<String, String>,
    limit: u64,
) -> Result<PublicResponse, String> {
    get_typed(base_url, paths, path, query, limit).map_err(|error| error.to_string())
}

pub fn get_typed(
    base_url: &str,
    paths: &[String],
    path: &str,
    query: &BTreeMap<String, String>,
    limit: u64,
) -> Result<PublicResponse, PublicHttpError> {
    request_typed(base_url, paths, path, query, HttpMethod::Get, &BTreeMap::new(), None, limit)
}

pub fn request_typed(
    base_url: &str, paths: &[String], path: &str, query: &BTreeMap<String, String>,
    method: HttpMethod, headers: &BTreeMap<String, String>, body: Option<&[u8]>, limit: u64,
) -> Result<PublicResponse, PublicHttpError> {
    request_with(
        base_url,
        paths,
        path,
        query,
        method,
        headers,
        body,
        limit,
        |host| {
            if let Ok(ip) = host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .parse::<IpAddr>()
            {
                return Ok(vec![std::net::SocketAddr::new(ip, 443)]);
            }
            (host, 443)
                .to_socket_addrs()
                .map(|items| items.collect())
                .map_err(|error| error.to_string())
        },
        |host, addresses, address, query, method, headers, body, limit| {
            let client = client_builder()
                .no_proxy()
                .resolve_to_addrs(host, addresses)
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
                .build()
                .map_err(|error| PublicHttpError::Transport(error.to_string()))?;
            let mut request = client.request(reqwest::Method::from_bytes(method.as_str().as_bytes()).expect("HTTP 메서드는 계약에 정의되어 있다"), address).query(query);
            for (name, value) in headers { request = request.header(name.as_str(), value.as_str()); }
            if let Some(body) = body { request = request.body(body.to_vec()); }
            let response = request.send()
                .map_err(|error| PublicHttpError::Transport(error.without_url().to_string()))?;
            read_response(response, limit)
        },
    )
}

/// 전송과 DNS 해석을 분리하되 동일한 주소·공인 IP 검사를 적용한다.
pub fn get_with<R, T>(
    base_url: &str,
    paths: &[String],
    path: &str,
    query: &BTreeMap<String, String>,
    limit: u64,
    resolve: R,
    transport: T,
) -> Result<PublicResponse, PublicHttpError>
where
    R: FnOnce(&str) -> Result<Vec<std::net::SocketAddr>, String>,
    T: FnOnce(
        &str,
        &[std::net::SocketAddr],
        &str,
        &BTreeMap<String, String>,
        u64,
    ) -> Result<PublicResponse, PublicHttpError>,
{
    request_with(base_url, paths, path, query, HttpMethod::Get, &BTreeMap::new(), None, limit, resolve,
        |host, addresses, address, query, _, _, _, limit| transport(host, addresses, address, query, limit))
}

/// 같은 공개 주소 검사 뒤 메서드와 헤더, 본문을 전송한다.
pub fn request_with<R, T>(
    base_url: &str, paths: &[String], path: &str, query: &BTreeMap<String, String>,
    method: HttpMethod, headers: &BTreeMap<String, String>, body: Option<&[u8]>, limit: u64,
    resolve: R, transport: T,
) -> Result<PublicResponse, PublicHttpError>
where
    R: FnOnce(&str) -> Result<Vec<std::net::SocketAddr>, String>,
    T: FnOnce(&str, &[std::net::SocketAddr], &str, &BTreeMap<String, String>, HttpMethod, &BTreeMap<String, String>, Option<&[u8]>, u64) -> Result<PublicResponse, PublicHttpError>,
{
    let parsed = url::Url::parse(base_url).map_err(|_| PublicHttpError::InvalidAddress)?;
    let valid_ip_origin = match parsed.host() {
        Some(url::Host::Ipv4(ip)) => {
            if !is_public_ip(ip.into()) {
                return Err(PublicHttpError::PrivateAddress);
            }
            true
        }
        Some(url::Host::Ipv6(ip)) => {
            if !is_public_ip(ip.into()) {
                return Err(PublicHttpError::PrivateAddress);
            }
            true
        }
        _ => false,
    } && parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && !base_url.chars().any(char::is_whitespace)
        && base_url.split_once("://").is_some_and(|(_, rest)| {
            let authority = rest.split('/').next().unwrap_or("");
            !authority.contains('@') && rest.find('/').is_none_or(|i| &rest[i..] == "/")
        });
    if !(valid_https_origin(base_url) || valid_ip_origin) || !allowed_public_http_path(paths, path)
    {
        return Err(PublicHttpError::InvalidAddress);
    }
    let host = parsed.host_str().ok_or(PublicHttpError::InvalidAddress)?;
    let addresses = resolve(host).map_err(PublicHttpError::Transport)?;
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(PublicHttpError::PrivateAddress);
    }
    let address = format!("{}{}", base_url.trim_end_matches('/'), path);
    transport(host, &addresses, &address, query, method, headers, body, limit)
}

fn read_response(
    mut response: reqwest::blocking::Response,
    limit: u64,
) -> Result<PublicResponse, PublicHttpError> {
    let status = response.status().as_u16();
    let mut headers = BTreeMap::<String, String>::new();
    for (name, value) in response.headers() {
        let name = name.as_str();
        if name == "set-cookie" || name == "set-cookie2" { continue; }
        if let Ok(value) = std::str::from_utf8(value.as_bytes()) {
            headers.entry(name.to_owned()).and_modify(|v| { v.push_str(", "); v.push_str(value); }).or_insert_with(|| value.to_owned());
        }
    }
    let rate_limit = crate::rate_limit::rate_limit(status, response.headers());
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
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

#[cfg(test)]
mod tests {
    use super::{client_builder, read_response};
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn public_client_sends_product_user_agent() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let count = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            String::from_utf8_lossy(&request[..count]).into_owned()
        });
        client_builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .unwrap();
        let request = server.join().unwrap().to_lowercase();
        assert!(request.contains(&format!(
            "user-agent: kaleidoscope/{}",
            env!("CARGO_PKG_VERSION")
        )));
    }

    #[test]
    fn public_response_preserves_rate_limit_hint() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            stream.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 7\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
        });
        let response = client_builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .unwrap();
        let response = read_response(response, 1024).unwrap();
        assert_eq!(response.rate_limit.unwrap().retry_after_secs, Some(7));
        server.join().unwrap();
    }

    #[test]
    fn response_exposes_combined_headers_without_cookies() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).unwrap();
            stream.write_all(b"HTTP/1.1 412 Precondition Failed\r\nETag: v1\r\nX-Result: one\r\nX-Result: two\r\nSet-Cookie: secret=1\r\nSet-Cookie2: secret=2\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let response = client_builder().no_proxy().build().unwrap().get(format!("http://{address}/")).send().unwrap();
        let response = read_response(response, 1024).unwrap();
        assert_eq!(response.status, 412);
        assert_eq!(response.headers["etag"], "v1");
        assert_eq!(response.headers["x-result"], "one, two");
        assert!(!response.headers.contains_key("set-cookie"));
        assert!(!response.headers.contains_key("set-cookie2"));
        server.join().unwrap();
    }
}
