use std::net::IpAddr;

#[test]
fn private_and_reserved_addresses_are_rejected() {
    for address in [
        "127.0.0.1",
        "10.1.2.3",
        "169.254.1.1",
        "192.0.2.1",
        "100.64.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
    ] {
        assert!(
            !kaleidoscope_data::public_http::is_public_ip(address.parse::<IpAddr>().unwrap()),
            "{address}"
        );
    }
    assert!(kaleidoscope_data::public_http::is_public_ip(
        "8.8.8.8".parse().unwrap()
    ));
    assert!(kaleidoscope_data::public_http::is_public_ip(
        "2606:4700:4700::1111".parse().unwrap()
    ));
}
