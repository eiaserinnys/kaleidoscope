use kaleidoscope_contract::{
    app_comments::{AppCommentAnchor, AppCommentSummary, AppCommentThread},
    registry::{DeviceEvent, APP_COMMENTS_REGISTRY_VERSION, REGISTRY_VERSION},
    CoreReply, CoreRequest, SharedState,
};
use serde_json::{json, Value};

#[test]
fn anchor_round_trips_and_distinguishes_typed_row_keys() {
    let number = json!({
        "kind": "row",
        "pointer": "/ui/items",
        "normalized_type": "list",
        "own_fingerprint": "sha256:abc",
        "parent_child_types": ["list", "text"],
        "repeat_chain": [1, "1"],
        "row_identity": 1
    });
    let mut string = number.clone();
    string["row_identity"] = json!("1");
    let number_anchor: AppCommentAnchor = serde_json::from_value(number.clone()).unwrap();
    let string_anchor: AppCommentAnchor = serde_json::from_value(string.clone()).unwrap();
    assert_ne!(number_anchor, string_anchor);
    assert_eq!(serde_json::to_value(number_anchor).unwrap(), number);
    assert_eq!(serde_json::to_value(string_anchor).unwrap(), string);
    assert!(serde_json::to_value(serde_json::from_value::<AppCommentAnchor>(json!({
        "kind":"point", "frame_rel":{"x":0.5,"y":0.25}
    })).unwrap()).unwrap().get("quote").is_none());
}

#[test]
fn summary_defaults_and_thread_round_trip() {
    let value = json!({
        "id":"c1", "app_id":"app", "number":1,
        "created_app_version":2, "created_definition_digest":"digest",
        "created_shell_version":"0.6.0", "origin":{"kind":"builtin"},
        "source_window_id":"w1", "anchor":{"kind":"block","pointer":"/ui"},
        "text":"고쳐 주세요", "reply_count":1, "resolved":false,
        "created_at":"2026-11-06T00:00:00Z",
        "updated_at":"2026-11-06T00:00:00Z", "revision":3
    });
    let summary: AppCommentSummary = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(summary.sent_at, None);
    assert!(!summary.unread_reply);
    let mut thread_value = serde_json::to_value(summary).unwrap();
    thread_value["replies"] = json!([{"id":"r1","author":"agent","text":"고쳤습니다","created_at":"2026-11-06T00:01:00Z"}]);
    let thread: AppCommentThread = serde_json::from_value(thread_value.clone()).unwrap();
    assert_eq!(serde_json::to_value(thread).unwrap(), thread_value);
}

#[test]
fn events_and_commands_keep_small_metadata_and_images_out_of_lists() {
    let meta = json!({"app_id":"app","revision":3,"open_count":1,"unsent_count":1,"unread_reply_count":0});
    for value in [
        json!({"event":"app_comments.snapshot","apps":[meta.clone()]}),
        json!({"event":"app_comments.changed","app_id":"app","revision":3,"open_count":1,"unsent_count":1,"unread_reply_count":0}),
    ] {
        let event: DeviceEvent = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), value);
    }
    assert_eq!(REGISTRY_VERSION, APP_COMMENTS_REGISTRY_VERSION);
    for value in [
        json!({"op":"comment.list","app_id":"app","cursor":"next"}),
        json!({"op":"comment.get","app_id":"app","id":"c1"}),
        json!({"op":"comment.mark_sent","app_id":"app","ids":["c1"]}),
        json!({"op":"comment.capture","window_id":"w1","target_rect":{"x":1.0,"y":2.0,"width":3.0,"height":4.0}}),
    ] {
        let request: CoreRequest = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(request).unwrap(), value);
    }
    let reply = json!({"op":"comment.list","items":[],"app_revision":3});
    assert_eq!(serde_json::to_value(serde_json::from_value::<CoreReply>(reply.clone()).unwrap()).unwrap(), reply);
    let shared: SharedState = serde_json::from_value(json!({
        "apps":[],"app_versions":[],"workspaces":[],"desktops":[],"windows":[]
    })).unwrap();
    let json: Value = serde_json::to_value(shared).unwrap();
    assert_eq!(json["app_comments"], json!({}));
}

#[test]
fn comment_error_catalog_has_each_operation_and_reason() {
    use kaleidoscope_contract::errors;
    let cases = [
        ("COMMENT_CREATE_APP_ID_EMPTY", errors::COMMENT_CREATE_APP_ID_EMPTY()),
        ("COMMENT_CREATE_TEXT_EMPTY", errors::COMMENT_CREATE_TEXT_EMPTY()),
        ("COMMENT_CREATE_TEXT_TOO_LONG", errors::COMMENT_CREATE_TEXT_TOO_LONG("한도")),
        ("COMMENT_CREATE_ANCHOR_INVALID", errors::COMMENT_CREATE_ANCHOR_INVALID("pointer")),
        ("COMMENT_CREATE_BODY_TOO_LARGE", errors::COMMENT_CREATE_BODY_TOO_LARGE("한도")),
        ("COMMENT_CREATE_ID_CONFLICT", errors::COMMENT_CREATE_ID_CONFLICT()),
        ("COMMENT_GET_NOT_FOUND", errors::COMMENT_GET_NOT_FOUND("c1")),
        ("COMMENT_REPLY_THREAD_NOT_FOUND", errors::COMMENT_REPLY_THREAD_NOT_FOUND("c1")),
        ("COMMENT_REPLY_TEXT_EMPTY", errors::COMMENT_REPLY_TEXT_EMPTY()),
        ("COMMENT_REPLY_TEXT_TOO_LONG", errors::COMMENT_REPLY_TEXT_TOO_LONG("한도")),
        ("COMMENT_REPLY_ID_CONFLICT", errors::COMMENT_REPLY_ID_CONFLICT()),
        ("COMMENT_RESOLVE_NOT_FOUND", errors::COMMENT_RESOLVE_NOT_FOUND("c1")),
        ("COMMENT_IMAGE_NOT_FOUND", errors::COMMENT_IMAGE_NOT_FOUND()),
        ("COMMENT_CREATE_IMAGE_TOO_LARGE", errors::COMMENT_CREATE_IMAGE_TOO_LARGE("한도")),
        ("COMMENT_CREATE_IMAGE_INVALID", errors::COMMENT_CREATE_IMAGE_INVALID()),
        ("COMMENT_CAPTURE_WINDOW_NOT_FOUND", errors::COMMENT_CAPTURE_WINDOW_NOT_FOUND()),
        ("COMMENT_CAPTURE_IMAGE_UNAVAILABLE", errors::COMMENT_CAPTURE_IMAGE_UNAVAILABLE()),
        ("COMMENT_CAPTURE_FREEZE_FAILED", errors::COMMENT_CAPTURE_FREEZE_FAILED()),
        ("COMMENT_LIST_CURSOR_INVALID", errors::COMMENT_LIST_CURSOR_INVALID()),
        ("COMMENT_CREATE_STORAGE_FAILED", errors::COMMENT_CREATE_STORAGE_FAILED("원인")),
        ("COMMENT_REPLY_STORAGE_FAILED", errors::COMMENT_REPLY_STORAGE_FAILED("원인")),
        ("COMMENT_RESOLVE_STORAGE_FAILED", errors::COMMENT_RESOLVE_STORAGE_FAILED("원인")),
        ("COMMENT_DELETE_STORAGE_FAILED", errors::COMMENT_DELETE_STORAGE_FAILED("원인")),
        ("COMMENT_MARK_READ_STORAGE_FAILED", errors::COMMENT_MARK_READ_STORAGE_FAILED("원인")),
        ("COMMENT_MARK_SENT_STORAGE_FAILED", errors::COMMENT_MARK_SENT_STORAGE_FAILED("원인")),
        ("COMMENT_MARK_SENT_NOT_FOUND", errors::COMMENT_MARK_SENT_NOT_FOUND("c1")),
        ("COMMENT_MARK_READ_NOT_FOUND", errors::COMMENT_MARK_READ_NOT_FOUND("c1")),
        ("SHELL_COMMENT_TARGET_CHANGED", errors::SHELL_COMMENT_TARGET_CHANGED()),
        ("SHELL_COMMENT_SEND_TEXT_TOO_LONG", errors::SHELL_COMMENT_SEND_TEXT_TOO_LONG("한도")),
    ];
    for (id, error) in cases {
        assert_eq!(error.id.as_deref(), Some(id));
        assert!(errors::all().any(|entry| entry.id == id));
    }
}

#[test]
fn image_and_store_origin_round_trip_without_bytes_in_summary() {
    let value = json!({
        "id":"c2", "app_id":"app", "number":2,
        "created_app_version":1, "created_definition_digest":"digest",
        "created_shell_version":"0.6.0",
        "origin":{"kind":"store","origin":{"store_url":"https://example.test","store_app_id":"app","release":1,"digest":"digest"}},
        "source_window_id":"w1", "anchor":{"kind":"point","frame_rel":{"x":0.5,"y":0.5}},
        "text":"여기", "reply_count":0,
        "image":{"width":100,"height":50,"byte_size":10,"capture_surface":"web_view","target_rect":{"x":10.0,"y":20.0,"width":0.0,"height":0.0}},
        "resolved":false, "sent_at":"2026-11-06T00:00:00Z", "unread_reply":true,
        "created_at":"2026-11-06T00:00:00Z", "updated_at":"2026-11-06T00:00:00Z", "revision":1
    });
    let summary: AppCommentSummary = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(summary).unwrap(), value);
}
