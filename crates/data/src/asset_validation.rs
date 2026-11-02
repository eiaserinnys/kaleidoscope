//! 자산 업로드와 번들 자산에 공통으로 적용하는 형식 검사.
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    assets::{AssetFormat, AssetUpload},
    data::MEDIA_MAX_BYTES,
    errors, CoreError,
};
use quick_xml::{events::Event, Reader, XmlVersion};
use sha2::{Digest, Sha256};

pub fn validate_upload(upload: &AssetUpload) -> Result<Vec<u8>, CoreError> {
    let id = upload.id.as_bytes();
    if id.is_empty() {
        return Err(errors::ASSET_UPLOAD_ID_EMPTY());
    }
    if id.len() > 64 {
        return Err(errors::ASSET_UPLOAD_ID_TOO_LONG());
    }
    if !id
        .iter()
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
    {
        return Err(errors::ASSET_UPLOAD_ID_INVALID());
    }
    if upload.id.starts_with("builtin-") {
        return Err(errors::ASSET_UPLOAD_ID_RESERVED());
    }
    if upload.version == 0 {
        return Err(errors::ASSET_UPLOAD_VERSION_INVALID());
    }
    if upload.source.trim().is_empty() {
        return Err(errors::ASSET_UPLOAD_SOURCE_REQUIRED());
    }
    if upload.license.trim().is_empty() {
        return Err(errors::ASSET_UPLOAD_LICENSE_REQUIRED());
    }
    if upload.data_base64.len() as u64 > ((MEDIA_MAX_BYTES + 2) / 3) * 4 {
        return Err(errors::ASSET_UPLOAD_ENCODING_TOO_LARGE(&upload.id));
    }
    let bytes = STANDARD.decode(&upload.data_base64).map_err(|error| {
        errors::ASSET_UPLOAD_ENCODING_INVALID(&upload.id).and_details(vec![error.to_string()])
    })?;
    if bytes.len() as u64 > MEDIA_MAX_BYTES {
        return Err(errors::ASSET_UPLOAD_BYTES_TOO_LARGE(&upload.id));
    }
    if format!("{:x}", Sha256::digest(&bytes)) != upload.sha256 {
        return Err(errors::ASSET_UPLOAD_HASH_MISMATCH(&upload.id));
    }
    validate_bytes_for(upload.format, &bytes, &upload.id)?;
    Ok(bytes)
}

pub fn validate_bytes(format: AssetFormat, bytes: &[u8]) -> Result<(), CoreError> {
    validate_bytes_for(format, bytes, format_name(format))
}

fn validate_bytes_for(format: AssetFormat, bytes: &[u8], asset: &str) -> Result<(), CoreError> {
    match format {
        AssetFormat::Javascript => {
            return std::str::from_utf8(bytes).map(|_| ()).map_err(|error| {
                    errors::ASSET_UPLOAD_JAVASCRIPT_ENCODING_INVALID(asset)
                    .and_details(vec![error.to_string()])
            });
        }
        AssetFormat::Woff2 | AssetFormat::Ttf | AssetFormat::Otf => {
            let valid = match format {
                AssetFormat::Woff2 => bytes.starts_with(b"wOF2"),
                AssetFormat::Ttf => bytes.starts_with(b"\0\x01\0\0") || bytes.starts_with(b"true"),
                AssetFormat::Otf => bytes.starts_with(b"OTTO"),
                _ => false,
            };
            return if valid {
                Ok(())
            } else {
                Err(errors::ASSET_UPLOAD_FONT_FORMAT_MISMATCH(
                    asset,
                    format_name(format),
                ))
            };
        }
        _ => {}
    }
    if format == AssetFormat::Html {
        let text = std::str::from_utf8(bytes).map_err(|error| {
            errors::ASSET_UPLOAD_HTML_ENCODING_INVALID(asset).and_details(vec![error.to_string()])
        })?;
        return if text.trim().is_empty() {
            Err(errors::ASSET_UPLOAD_HTML_EMPTY(asset))
        } else {
            Ok(())
        };
    }
    if format == AssetFormat::Svg {
        return validate_svg_for_asset(bytes, asset);
    }
    let expected = match format {
        AssetFormat::Png => image::ImageFormat::Png,
        AssetFormat::Jpeg => image::ImageFormat::Jpeg,
        AssetFormat::Webp => image::ImageFormat::WebP,
        AssetFormat::Gif => image::ImageFormat::Gif,
        AssetFormat::Svg => unreachable!(),
        AssetFormat::Html => unreachable!(),
        AssetFormat::Javascript | AssetFormat::Woff2 | AssetFormat::Ttf | AssetFormat::Otf => {
            unreachable!()
        }
    };
    if image::guess_format(bytes).ok() != Some(expected) {
        return Err(errors::ASSET_UPLOAD_IMAGE_FORMAT_MISMATCH(
            asset,
            format_name(format),
        ));
    }
    image::load_from_memory_with_format(bytes, expected).map_err(|error| {
        errors::ASSET_UPLOAD_IMAGE_DECODE_FAILED(asset, format_name(format))
            .and_details(vec![error.to_string()])
    })?;
    Ok(())
}

fn format_name(format: AssetFormat) -> &'static str {
    match format {
        AssetFormat::Html => "HTML",
        AssetFormat::Svg => "SVG",
        AssetFormat::Png => "PNG",
        AssetFormat::Webp => "WebP",
        AssetFormat::Jpeg => "JPEG",
        AssetFormat::Gif => "GIF",
        AssetFormat::Javascript => "JavaScript",
        AssetFormat::Woff2 => "WOFF2",
        AssetFormat::Ttf => "TTF",
        AssetFormat::Otf => "OTF",
    }
}

/// SVG의 실행 요소, 이벤트 속성과 외부 참조를 거부한다.
pub fn validate_svg(bytes: &[u8]) -> Result<(), CoreError> {
    validate_svg_for_asset(bytes, "검사 대상")
}

fn validate_svg_for_asset(bytes: &[u8], asset: &str) -> Result<(), CoreError> {
    let text = std::str::from_utf8(bytes).map_err(|error| {
        errors::ASSET_UPLOAD_SVG_ENCODING_INVALID(asset).and_details(vec![error.to_string()])
    })?;
    let mut reader = Reader::from_str(text);
    let mut root = false;
    let mut depth = 0usize;
    loop {
        let event = reader.read_event().map_err(|error| {
            errors::ASSET_UPLOAD_SVG_XML_INVALID(asset).and_details(vec![error.to_string()])
        })?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name().as_ref().to_ascii_lowercase();
                if !root {
                    if name != "svg" {
                        return Err(errors::ASSET_UPLOAD_SVG_ROOT_INVALID(asset));
                    }
                    root = true;
                } else if depth == 0 {
                    return Err(errors::ASSET_UPLOAD_SVG_MULTIPLE_ROOTS(asset));
                }
                if matches!(
                    name.as_str(),
                    "script"
                        | "foreignobject"
                        | "style"
                        | "iframe"
                        | "object"
                        | "embed"
                        | "animate"
                        | "animatemotion"
                        | "animatetransform"
                        | "set"
                ) {
                    return Err(errors::ASSET_UPLOAD_SVG_ELEMENT_FORBIDDEN(asset));
                }
                for attr in element.attributes() {
                    let attr = attr.map_err(|error| {
                        errors::ASSET_UPLOAD_SVG_XML_INVALID(asset)
                            .and_details(vec![error.to_string()])
                    })?;
                    let key = attr.key.local_name().as_ref().to_ascii_lowercase();
                    let qualified = attr.key.as_ref().to_ascii_lowercase();
                    let value =
                        attr.normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|error| {
                                errors::ASSET_UPLOAD_SVG_XML_INVALID(asset)
                                    .and_details(vec![error.to_string()])
                            })?;
                    let lower = value.to_ascii_lowercase();
                    let namespace = qualified == "xmlns" || qualified.starts_with("xmlns:");
                    if key.starts_with("on")
                        || lower.contains('\\')
                        || lower.contains("javascript:")
                        || lower.contains("@import")
                        || (!namespace
                            && (lower.contains("http:")
                                || lower.contains("https:")
                                || lower.contains("data:")))
                    {
                        return Err(errors::ASSET_UPLOAD_SVG_ATTRIBUTE_FORBIDDEN(asset));
                    }
                    if key == "href" && !value.trim().starts_with('#') {
                        return Err(errors::ASSET_UPLOAD_SVG_EXTERNAL_REFERENCE(asset));
                    }
                    for (offset, _) in lower.match_indices("url(") {
                        let target = lower[offset + 4..]
                            .trim_start()
                            .trim_start_matches(['\'', '"']);
                        if !target.starts_with('#') {
                            return Err(errors::ASSET_UPLOAD_SVG_EXTERNAL_REFERENCE(asset));
                        }
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| errors::ASSET_UPLOAD_SVG_STRUCTURE_INVALID(asset))?
            }
            Event::DocType(_) | Event::GeneralRef(_) => {
                return Err(errors::ASSET_UPLOAD_SVG_DECLARATION_FORBIDDEN(asset))
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || depth != 0 {
        return Err(errors::ASSET_UPLOAD_SVG_STRUCTURE_INVALID(asset));
    }
    Ok(())
}
