//! 인증 없는 공개 HTTPS 요청. 확인한 DNS 주소로만 연결한다.
use std::collections::BTreeMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use kaleidoscope_contract::{
    data,
    validate::{valid_https_origin, valid_public_http_path},
};

pub struct PublicResponse {
    pub status: u16,
    pub mime: String,
    pub bytes: Vec<u8>,
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
    if !valid_https_origin(base_url)
        || !valid_public_http_path(path)
        || !paths.iter().any(|allowed| allowed == path)
    {
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
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .resolve_to_addrs(host, &addresses)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(data::CONNECTION_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let address = format!("{}{}", base_url.trim_end_matches('/'), path);
    let mut response = client
        .get(address)
        .query(query)
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
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
        mime,
        bytes,
    })
}
