use kaleidoscope_contract::{
    registry::{DeviceEvent, REGISTRY_VERSION},
    ActWindowArgs, CoreEvent, CoreReply, CoreRequest, ReadWindowArgs, WindowAction,
    WindowControlResult, WindowControlToolOutput, CONTRACT_VERSION,
};
use serde_json::{json, Value};

fn roundtrip<T: serde::de::DeserializeOwned + serde::Serialize>(value: Value) {
    let decoded: T = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), value);
}

#[test]
fn six_actions_roundtrip_and_reject_unknown_fields() {
    for action in [
        json!({"kind":"click","target":1}),
        json!({"kind":"click","target":1,"gesture":"double_click"}),
        json!({"kind":"type","target":2,"text":"안녕","mode":"append"}),
        json!({"kind":"select","target":3,"choice":{"by":"value","value":42}}),
        json!({"kind":"scroll","direction":"down","amount":100}),
        json!({"kind":"key","target":4,"key":"Shift+Tab"}),
        json!({"kind":"point","x":1.5,"y":2.0,"gesture":"double_click"}),
    ] {
        roundtrip::<WindowAction>(action.clone());
        let mut bad = action;
        bad["extra"] = json!(true);
        assert!(serde_json::from_value::<WindowAction>(bad).is_err());
    }
    roundtrip::<WindowAction>(
        json!({"kind":"select","target":1,"choice":{"by":"label","value":"옵션"}}),
    );
}

#[test]
fn public_arguments_and_results_roundtrip() {
    roundtrip::<ReadWindowArgs>(json!({"window_id":"window"}));
    roundtrip::<ActWindowArgs>(
        json!({"window_id":"window","view_id":"v1","action":{"kind":"click","target":1},"image":true}),
    );
    assert!(
        serde_json::from_value::<ReadWindowArgs>(json!({"window_id":"window","extra":1})).is_err()
    );
    assert!(serde_json::from_value::<ActWindowArgs>(
        json!({"window_id":"window","action":{"kind":"click","target":1}})
    )
    .is_err());
    let ok = json!({"status":"ok","value":{"after":{"view_id":"v1","app_name":"앱","window_title":"창","text":"내용","settled":true,"geometry":{"css_width":1.0,"css_height":2.0,"pixel_width":1,"pixel_height":2},"image_base64":"AA=="}}});
    roundtrip::<WindowControlResult>(ok);
    let error = kaleidoscope_contract::errors::SHARE_CONTROL_RESPONSE_UNEXPECTED();
    roundtrip::<WindowControlResult>(json!({"status":"error","error":error,"applied":false}));
    roundtrip::<WindowControlToolOutput>(
        json!({"window_id":"window","device_name":"기기","app_name":"앱","window_title":"창","view_id":"v1","mode":"full","text":"내용","settled":true}),
    );
}

#[test]
fn wire_variants_and_versions() {
    let request = json!({"request_id":"r","window_id":"w","expires_at":"2026-11-04T00:00:00Z","operation":{"kind":"read","image":false}});
    roundtrip::<DeviceEvent>(json!({"event":"window.control","request":request}));
    roundtrip::<CoreEvent>(json!({"event":"window.control","request":request}));
    let response = json!({"request_id":"r","window_id":"w","result":{"status":"error","error":kaleidoscope_contract::errors::SHARE_CONTROL_RESPONSE_UNEXPECTED(),"applied":false}});
    roundtrip::<CoreRequest>(json!({"op":"window.control.respond","response":response}));
    roundtrip::<CoreRequest>(
        json!({"op":"window.control.capture","request_id":"r","window_id":"w","bounds":{"x":0,"y":0,"width":100,"height":100}}),
    );
    roundtrip::<CoreRequest>(
        json!({"op":"web.control","request_id":"r","window_id":"w","operation":{"kind":"read","image":false}}),
    );
    roundtrip::<CoreReply>(json!({"op":"window.control.respond"}));
    roundtrip::<CoreReply>(
        json!({"op":"window.control.capture","image_base64":"AA==","geometry":{"css_width":1.0,"css_height":2.0,"pixel_width":1,"pixel_height":2}}),
    );
    roundtrip::<CoreReply>(json!({"op":"web.control","result":response["result"]}));
    assert_eq!(CONTRACT_VERSION, 31);
    assert_eq!(REGISTRY_VERSION, 12);
}

#[test]
fn public_schema_contains_scroll_bounds() {
    let schema = serde_json::to_value(schemars::schema_for!(ActWindowArgs)).unwrap();
    let text = schema.to_string();
    assert!(text.contains("\"minimum\":1"));
    assert!(text.contains("\"maximum\":10000"));
}

#[test]
fn control_errors_are_registered_by_place_and_cause() {
    let registered: std::collections::HashSet<_> = kaleidoscope_contract::errors::all()
        .map(|entry| entry.id)
        .collect();
    for id in [
        "MCP_WINDOW_CONTROL_TARGET_UNAVAILABLE",
        "MCP_WINDOW_CONTROL_DEVICE_OFFLINE",
        "MCP_WINDOW_CONTROL_DEVICE_VERSION_UNSUPPORTED",
        "MCP_WINDOW_CONTROL_VIEW_UNKNOWN",
        "MCP_WINDOW_CONTROL_BUSY",
        "MCP_WINDOW_CONTROL_TIMEOUT",
        "MCP_WINDOW_CONTROL_REPLY_OWNER_MISMATCH",
        "MCP_WINDOW_CONTROL_REPLY_EXPIRED",
        "MCP_WINDOW_CONTROL_REPLY_BODY_INVALID",
        "MCP_WINDOW_CONTROL_REPLY_TOO_LARGE",
        "SHARE_CONTROL_WINDOW_NOT_FOUND",
        "SHARE_CONTROL_NOT_SHARED",
        "SHARE_CONTROL_DESKTOP_INACTIVE",
        "SHARE_CONTROL_REQUEST_EXPIRED",
        "SHARE_CONTROL_RESPONSE_UNEXPECTED",
        "SHARE_CONTROL_IMAGE_UNAVAILABLE",
        "SHELL_WINDOW_CONTROL_REFERENCE_STALE",
        "SHELL_WINDOW_CONTROL_TARGET_HIDDEN",
        "SHELL_WINDOW_CONTROL_CONSENT_BLOCKED",
        "SHELL_WINDOW_CONTROL_TARGET_DISABLED",
        "SHELL_WINDOW_CONTROL_TARGET_READONLY",
        "SHELL_WINDOW_CONTROL_ACTION_UNSUPPORTED",
        "SHELL_WINDOW_CONTROL_KEY_INVALID",
        "SHELL_WINDOW_CONTROL_FOCUS_TARGET_MISSING",
        "SHELL_WINDOW_CONTROL_OPTION_NOT_FOUND",
        "SHELL_WINDOW_CONTROL_OPTION_AMBIGUOUS",
        "SHELL_WINDOW_CONTROL_POINT_OUTSIDE",
        "SHELL_WINDOW_CONTROL_GEOMETRY_CHANGED",
        "SHELL_WINDOW_CONTROL_FRAME_TIMEOUT",
        "WEB_CONTROL_PLATFORM_UNSUPPORTED",
        "WEB_CONTROL_AX_READ_FAILED",
        "WEB_CONTROL_INPUT_FAILED",
        "WEB_CONTROL_NODE_RESOLVE_FAILED",
    ] {
        assert!(registered.contains(id), "누락된 오류 코드: {id}");
    }
    assert!(!registered.contains("WEB_CONTROL_PROTOCOL_FAILED"));
}
