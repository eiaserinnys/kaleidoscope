use super::http_client;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

fn read_request(stream: &mut TcpStream) -> std::io::Result<bool> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut bytes = Vec::new();
    let mut chunk = [0; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(false),
            Ok(n) => {
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    return Ok(true);
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return Ok(false)
            }
            Err(error) => return Err(error),
        }
    }
}

#[test]
fn shared_client_reuses_a_connection_for_two_requests() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let mut connections = 0;
        let mut requests = 0;
        while requests < 2 {
            let (mut stream, _) = listener.accept().unwrap();
            connections += 1;
            while requests < 2 && read_request(&mut stream).unwrap() {
                requests += 1;
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok",
                    )
                    .unwrap();
            }
        }
        connections
    });

    for _ in 0..2 {
        let response = http_client::shared()
            .unwrap()
            .get(format!("http://{address}/reuse"))
            .send()
            .unwrap();
        assert_eq!(response.text().unwrap(), "ok");
    }
    assert_eq!(server.join().unwrap(), 1);
}

#[test]
fn shared_client_decodes_gzip_responses() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        assert!(read_request(&mut stream).unwrap());
        let body = [
            0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xab, 0x56, 0xca, 0xcf,
            0x56, 0xb2, 0x2a, 0x29, 0x2a, 0x4d, 0xad, 0x05, 0x00, 0x90, 0x5f, 0xd4, 0xa7, 0x0b,
            0x00, 0x00, 0x00,
        ];
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(&body).unwrap();
    });

    let response = http_client::shared()
        .unwrap()
        .get(format!("http://{address}/gzip"))
        .send()
        .unwrap();
    assert_eq!(response.text().unwrap(), r#"{"ok":true}"#);
    server.join().unwrap();
}
