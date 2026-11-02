use kaleidoscope_contract::CoreRequest;
use serde_json::json;

#[test]
fn data_act_without_modifiers_roundtrips() {
    let wire = json!({"op":"data.act","window_id":"w","pointer":"/ui/on_click", "event":"pressed", "item":{"id":"a"}});
    let request: CoreRequest = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), wire);
    let old: CoreRequest =
        serde_json::from_value(json!({"op":"data.act","window_id":"w","pointer":"/ui/on_click"}))
            .unwrap();
    let serialized = serde_json::to_value(old).unwrap();
    assert_eq!(serialized["event"], json!(null));
    assert_eq!(serialized["item"], json!(null));
    assert!(serialized.get("modifiers").is_none());
}

#[test]
fn data_act_with_modifiers_roundtrips_without_changing_event_or_item() {
    let wire = json!({"op":"data.act","window_id":"w","pointer":"/ui/on_click", "event":{"value":42}, "item":{"id":"a"}, "modifiers":{"shift":true,"alt":false,"ctrl":true,"meta":false}});
    let request: CoreRequest = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), wire);
}

#[test]
fn client_action_context_roundtrips_with_and_without_modifiers() {
    use kaleidoscope_contract::client::ClientActionContext;
    for wire in [
        json!({"event":"pressed","item":{"id":"a"},"args":{"key":"value"}}),
        json!({"event":"pressed","item":{"id":"a"},"args":{"key":"value"},"modifiers":{"shift":true,"alt":false,"ctrl":true,"meta":false}}),
    ] {
        let context: ClientActionContext = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(context).unwrap(), wire);
    }
}

#[test]
fn both_typescript_contexts_offer_optional_modifiers() {
    use kaleidoscope_contract::client::ClientActionContext;
    use ts_rs::{Config, TS};
    for declaration in [
        CoreRequest::decl(&Config::new()),
        ClientActionContext::decl(&Config::new()),
    ] {
        assert!(
            declaration.contains("modifiers?: EventModifiers"),
            "{declaration}"
        );
    }
}
