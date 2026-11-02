//! 인증 없는 공개 HTTPS 요청. 확인한 DNS 주소로만 연결한다.
use std::collections::BTreeMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use kaleidoscope_contract::{
    data,
    validate::{allowed_public_http_path, valid_https_origin},
};

pub struct PublicResponse {
    pub status: u16,
    pub rate_limit: Option<kaleidoscope_contract::registry::RateLimitHint>,
    pub mime: String,
    pub bytes: Vec<u8>,
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
    if !valid_https_origin(base_url) || !allowed_public_http_path(paths, path) {
        return Err("허용하지 않은 공개 HTTPS 주소 또는 경로입니다".into());
    }
    let url = url::Url::parse(base_url).map_err(|error| error.to_string())?;
    let host = url.host_str().ok_or("호스트가 없습니다")?;
    let addresses: Vec<_> = (host, 443)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("공개 주소가 아닌 DNS 결과입니다".into());
    }
    let client = client_builder()
        .no_proxy()
        .resolve_to_addrs(host, &addresses)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let address = format!("{}{}", base_url.trim_end_matches('/'), path);
    let response = client
        .get(address)
        .query(query)
        .send()
        .map_err(|error| error.to_string())?;
    read_response(response, limit)
}

fn read_response(
    mut response: reqwest::blocking::Response,
    limit: u64,
) -> Result<PublicResponse, String> {
    let status = response.status().as_u16();
    let rate_limit = crate::rate_limit::rate_limit(status, response.headers());
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
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("응답이 너무 큽니다".into());
    }
    Ok(PublicResponse {
        status,
        rate_limit,
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
}
