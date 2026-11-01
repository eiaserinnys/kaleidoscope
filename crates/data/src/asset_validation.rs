//! 자산 업로드와 번들 자산에 공통으로 적용하는 형식 검사.
use base64::{engine::general_purpose::STANDARD, Engine};
use kaleidoscope_contract::{
    assets::{AssetFormat, AssetUpload},
    data::MEDIA_MAX_BYTES,
};
use quick_xml::{events::Event, Reader, XmlVersion};
use sha2::{Digest, Sha256};

pub fn validate_upload(upload: &AssetUpload) -> Result<Vec<u8>, String> {
    let id = upload.id.as_bytes();
    if id.is_empty()
        || id.len() > 64
        || !id
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        || upload.id.starts_with("builtin-")
        || upload.version == 0
        || upload.source.trim().is_empty()
        || upload.license.trim().is_empty()
    {
        return Err("자산 식별자 또는 메타데이터가 올바르지 않습니다".into());
    }
    if upload.data_base64.len() as u64 > ((MEDIA_MAX_BYTES + 2) / 3) * 4 {
        return Err("자산이 너무 큽니다".into());
    }
    let bytes = STANDARD
        .decode(&upload.data_base64)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MEDIA_MAX_BYTES {
        return Err("자산이 너무 큽니다".into());
    }
    if format!("{:x}", Sha256::digest(&bytes)) != upload.sha256 {
        return Err("자산 해시가 일치하지 않습니다".into());
    }
    validate_bytes(upload.format, &bytes)?;
    Ok(bytes)
}

pub fn validate_bytes(format: AssetFormat, bytes: &[u8]) -> Result<(), String> {
    if format == AssetFormat::Html {
        let text = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
        return if text.trim().is_empty() {
            Err("HTML 자산이 비어 있습니다".into())
        } else {
            Ok(())
        };
    }
    if format == AssetFormat::Svg {
        return validate_svg(bytes);
    }
    let expected = match format {
        AssetFormat::Png => image::ImageFormat::Png,
        AssetFormat::Jpeg => image::ImageFormat::Jpeg,
        AssetFormat::Webp => image::ImageFormat::WebP,
        AssetFormat::Gif => image::ImageFormat::Gif,
        AssetFormat::Svg => unreachable!(),
        AssetFormat::Html => unreachable!(),
    };
    if image::guess_format(bytes).ok() != Some(expected) {
        return Err("자산 이미지 형식이 일치하지 않습니다".into());
    }
    image::load_from_memory_with_format(bytes, expected).map_err(|error| error.to_string())?;
    Ok(())
}

/// SVG의 실행 요소, 이벤트 속성과 외부 참조를 거부한다.
pub fn validate_svg(bytes: &[u8]) -> Result<(), String> {
    let text = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
    let mut reader = Reader::from_str(text);
    let mut root = false;
    let mut depth = 0usize;
    loop {
        let event = reader.read_event().map_err(|error| error.to_string())?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name().as_ref().to_ascii_lowercase();
                if !root {
                    if name != "svg" {
                        return Err("SVG 뿌리 요소가 필요합니다".into());
                    }
                    root = true;
                } else if depth == 0 {
                    return Err("SVG 뿌리가 여럿입니다".into());
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
                    return Err("SVG에 허용하지 않는 요소가 있습니다".into());
                }
                for attr in element.attributes() {
                    let attr = attr.map_err(|error| error.to_string())?;
                    let key = attr.key.local_name().as_ref().to_ascii_lowercase();
                    let qualified = attr.key.as_ref().to_ascii_lowercase();
                    let value = attr
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|error| error.to_string())?;
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
                        return Err("SVG에 실행 가능한 속성이 있습니다".into());
                    }
                    if key == "href" && !value.trim().starts_with('#') {
                        return Err("SVG 외부 참조는 허용되지 않습니다".into());
                    }
                    for (offset, _) in lower.match_indices("url(") {
                        let target = lower[offset + 4..]
                            .trim_start()
                            .trim_start_matches(['\'', '"']);
                        if !target.starts_with('#') {
                            return Err("SVG 외부 참조는 허용되지 않습니다".into());
                        }
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => depth = depth.checked_sub(1).ok_or("SVG 태그가 맞지 않습니다")?,
            Event::DocType(_) | Event::GeneralRef(_) => {
                return Err("SVG의 외부 선언은 허용되지 않습니다".into())
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || depth != 0 {
        return Err("SVG가 완전하지 않습니다".into());
    }
    Ok(())
}
