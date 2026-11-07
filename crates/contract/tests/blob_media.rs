use kaleidoscope_contract::{
    data::{self, BlobMediaRef, Crop, MediaRef},
    validate::parse_app_definition, BLOB_MEDIA_BLOCK_SET_VERSION, BLOCK_SET_VERSION,
    CONTRACT_VERSION,
};
use serde_json::{json, Value};

fn storage() -> Value {
    json!({"prefixes": ["media/"]})
}

fn app(ui: Value, blocks: u32, storage: Option<Value>) -> Value {
    let mut value = json!({
        "id": "blob-media-test",
        "name": "기기 저장소 미디어 시험",
        "requires": {"blocks": blocks, "modules": {"assets": 1}},
        "permissions": [],
        "assets": [{"id": "entry", "version": 1}],
        "state": {},
        "ui": ui,
    });
    if let Some(storage) = storage {
        value["requires"]["modules"]["client"] = json!(4);
        value["client"] = json!({
            "runtime": "javascript",
            "entry": {"id": "entry", "version": 1},
            "device_storage": storage,
        });
    }
    value
}

#[test]
fn blob_reference_round_trips_with_crop_and_rejects_unknown_fields() {
    let plain: MediaRef = serde_json::from_value(json!({"blob": "media/clip.mp4"})).unwrap();
    assert_eq!(
        plain,
        MediaRef::Blob(BlobMediaRef {
            blob: "media/clip.mp4".into(),
            crop: None,
        })
    );
    assert_eq!(
        serde_json::to_value(&plain).unwrap(),
        json!({"blob": "media/clip.mp4"})
    );
    let crop = Crop {
        x: 0.0,
        y: 0.0,
        w: 0.5,
        h: 0.5,
    };
    let cropped = MediaRef::Blob(BlobMediaRef {
        blob: "media/preview.png".into(),
        crop: Some(crop),
    });
    let value = serde_json::to_value(&cropped).unwrap();
    assert_eq!(value["crop"]["w"], json!(0.5));
    assert_eq!(serde_json::from_value::<MediaRef>(value).unwrap(), cropped);
    for bad in [
        json!({"blob": "media/a.mp4", "path": "a.mp4"}),
        json!({"blob": "media/a.mp4", "permission": "files"}),
        json!({"blob": "media/a.mp4", "query": {}}),
        json!({"blob": "media/a.mp4", "scope": "window"}),
    ] {
        assert!(
            serde_json::from_value::<MediaRef>(bad.clone()).is_err(),
            "거부해야 한다: {bad}"
        );
    }
    assert_eq!(
        serde_json::from_value::<MediaRef>(json!({"permission": "files", "path": "a.mp4"})).unwrap(),
        MediaRef::Resource(data::ResourceMediaRef {
            permission: "files".into(),
            path: "a.mp4".into(),
            query: Default::default(),
            crop: None,
        })
    );
    assert!(matches!(
        serde_json::from_value::<MediaRef>(json!({"asset": "photo"})).unwrap(),
        MediaRef::Asset(_)
    ));
}

#[test]
fn schema_lists_blob_variant_and_versions_advance() {
    assert_eq!(BLOB_MEDIA_BLOCK_SET_VERSION, 52);
    assert!(BLOCK_SET_VERSION >= BLOB_MEDIA_BLOCK_SET_VERSION);
    assert_eq!(CONTRACT_VERSION, 45);
    let text = serde_json::to_string(&schemars::schema_for!(kaleidoscope_contract::data::MediaRef))
        .expect("schema serializes");
    for name in ["ResourceMediaRef", "AssetMediaRef", "BlobMediaRef"] {
        assert!(text.contains(name), "missing {name}");
    }
    assert!(text.contains("\"required\":[\"blob\"]"), "blob is required");
    assert!(
        kaleidoscope_contract::app_definition_schema().is_object(),
        "앱 정의 스키마는 그대로 만든다"
    );
}

#[test]
fn blob_literal_requires_new_block_set_and_device_storage() {
    let image = json!({"type": "image", "src": {"blob": "media/photo.png"}});
    for blocks in [4, BLOB_MEDIA_BLOCK_SET_VERSION - 1] {
        let error = parse_app_definition(&app(image.clone(), blocks, Some(storage())).to_string())
            .expect_err("blob에는 새 판이 필요하다");
        assert!(
            format!("{error:?}").contains(&format!("requires.blocks가 {BLOB_MEDIA_BLOCK_SET_VERSION} 이상")),
            "{error:?}"
        );
    }
    let error = parse_app_definition(
        &app(
            json!({"type": "media", "src": {"blob": "media/clip.mp4"}}),
            BLOB_MEDIA_BLOCK_SET_VERSION,
            None,
        )
        .to_string(),
    )
    .expect_err("device_storage 선언이 필요하다");
    assert!(format!("{error:?}").contains("client.device_storage"), "{error:?}");
    parse_app_definition(
        &app(
            json!({"type": "image", "src": {"blob": "media/photo.png"}}),
            BLOB_MEDIA_BLOCK_SET_VERSION,
            Some(storage()),
        )
        .to_string(),
    )
    .expect("선언과 판이 맞으면 통과한다");
    parse_app_definition(
        &app(
            json!({"type": "media", "src": {"blob": "media/clip.mp4", "crop": {"x": 0, "y": 0, "w": 1, "h": 1}}}),
            BLOB_MEDIA_BLOCK_SET_VERSION,
            Some(storage()),
        )
        .to_string(),
    )
    .expect("media 블록도 같다");
}

#[test]
fn metrics_literal_image_checks_blob_like_image_and_media() {
    let metrics = json!({
        "type": "metrics",
        "items": [{"label": "사진", "value": "1", "image": {"blob": "media/photo.png"}}],
    });
    let error = parse_app_definition(
        &app(metrics, BLOB_MEDIA_BLOCK_SET_VERSION - 1, Some(storage())).to_string(),
    )
    .expect_err("동적이 아닌 metrics image도 정적 검사를 받는다");
    assert!(format!("{error:?}").contains("requires.blocks"), "{error:?}");
}

#[test]
fn resource_and_asset_literals_keep_old_block_versions() {
    parse_app_definition(
        &app(
            json!({"type": "image", "src": {"permission": "files", "path": "photo.png"}}),
            4,
            None,
        )
        .to_string(),
    )
    .expect("기존 미디어 참조는 판을 올리지 않는다");
    parse_app_definition(
        &app(
            json!({"type": "image", "src": {"asset": "entry", "version": 1}}),
            4,
            None,
        )
        .to_string(),
    )
    .expect("기존 자산 참조는 판을 올리지 않는다");
}
