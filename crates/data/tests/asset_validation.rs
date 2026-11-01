use kaleidoscope_contract::assets::AssetFormat;
use kaleidoscope_data::asset_validation::validate_bytes;
use kaleidoscope_data::asset_validation::validate_svg;

#[test]
fn html_assets_accept_scripts_and_reject_empty_or_invalid_utf8() {
    assert!(validate_bytes(
        AssetFormat::Html,
        "<html><script>작동()</script></html>".as_bytes()
    )
    .is_ok());
    assert!(validate_bytes(AssetFormat::Html, b" \n").is_err());
    assert!(validate_bytes(AssetFormat::Html, &[0xff]).is_err());
}

#[test]
fn svg_rejects_active_content_and_external_references() {
    let safe =
        br##"<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(#shade)" d="M1 1"/></svg>"##;
    assert!(validate_svg(safe).is_ok());
    for svg in [
        r#"<svg><script>alert(1)</script></svg>"#,
        r#"<svg><foreignObject/></svg>"#,
        r#"<svg><path onload="alert(1)"/></svg>"#,
        r#"<svg><image href="https://example.test/a"/></svg>"#,
        r#"<svg><path fill="url(https://example.test/a)"/></svg>"#,
        r#"<svg><set attributeName="href" to="https://example.test/a"/></svg>"#,
        r#"<svg><path style="fill:u\72l(https://example.test/a)"/></svg>"#,
    ] {
        assert!(validate_svg(svg.as_bytes()).is_err(), "{svg}");
    }
}
