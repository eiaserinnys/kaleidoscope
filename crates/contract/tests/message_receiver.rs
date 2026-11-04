use kaleidoscope_contract::{
    app_definition_schema, builtin::BUILTIN_IDENTITIES,
    client::{ClientFrameMessage, ClientHostMessage},
    preferences::{message_receiver, AccountPreferences, MessageReceiver},
    registry::DeviceEvent, validate::parse_app_definition, AppDefinition, CoreReply, CoreRequest,
    SharedState, RECEIVE_MESSAGE_BLOCK_SET_VERSION, RECEIVE_MESSAGE_CLIENT_VERSION,
};
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"client-test", "name":"클라이언트 시험",
        "requires":{"blocks":RECEIVE_MESSAGE_BLOCK_SET_VERSION,"modules":{"assets":1,"client":RECEIVE_MESSAGE_CLIENT_VERSION}},
        "permissions":[], "state":{},
        "assets":[{"id":"script","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"script","version":1},
            "inputs":{},"outputs":{},"actions":[],"commands":{},"state_keys":[],"storage_entries":[],
            "capabilities":["receive_message"]},
        "ui":{"type":"text","value":"시험"}
    })
}

#[test]
fn receive_message_requires_both_versions() {
    let mut app = definition();
    assert!(parse_app_definition(&app.to_string()).is_ok());
    for (blocks, client) in [
        (RECEIVE_MESSAGE_BLOCK_SET_VERSION - 1, RECEIVE_MESSAGE_CLIENT_VERSION),
        (RECEIVE_MESSAGE_BLOCK_SET_VERSION, RECEIVE_MESSAGE_CLIENT_VERSION - 1),
        (RECEIVE_MESSAGE_BLOCK_SET_VERSION - 1, RECEIVE_MESSAGE_CLIENT_VERSION - 1),
    ] {
        app["requires"]["blocks"] = json!(blocks);
        app["requires"]["modules"]["client"] = json!(client);
        let error = parse_app_definition(&app.to_string()).unwrap_err();
        assert_eq!(error.id.as_deref(), Some("APP_RECEIVE_MESSAGE_REQUIRES_VERSION"));
    }
    app["requires"]["modules"].as_object_mut().unwrap().remove("client");
    assert_eq!(parse_app_definition(&app.to_string()).unwrap_err().id.as_deref(), Some("APP_RECEIVE_MESSAGE_REQUIRES_VERSION"));
    app["client"].as_object_mut().unwrap().remove("capabilities");
    app["requires"] = json!({"blocks":12,"modules":{"assets":1,"client":1}});
    assert!(parse_app_definition(&app.to_string()).is_ok());
    assert!(app_definition_schema().to_string().contains("receive_message"));
}

#[test]
fn old_shared_state_has_unreceived_preferences() {
    let state: SharedState = serde_json::from_value(json!({
        "apps":[],"app_versions":[],"workspaces":[],"desktops":[],"windows":[]
    })).unwrap();
    let serialized = serde_json::to_value(state).unwrap();
    assert_eq!(serialized.get("preferences"), Some(&Value::Null));
}

#[test]
fn preferences_requests_replies_and_events_round_trip() {
    let preferences = json!({"revision":2,"default_message_app_id":"client-test","asked_message_app_ids":["client-test"]});
    assert_eq!(serde_json::to_value(AccountPreferences::default()).unwrap(), json!({"revision":0,"default_message_app_id":null,"asked_message_app_ids":[]}));
    for request in [
        json!({"op":"shell.preferences.set_default","app_id":null}),
        json!({"op":"shell.preferences.answer","app_id":"client-test","use_as_default":true}),
    ] {
        let parsed: CoreRequest = serde_json::from_value(request.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    }
    for op in ["shell.preferences.set_default", "shell.preferences.answer"] {
        let reply = json!({"op":op,"preferences":preferences});
        let parsed: CoreReply = serde_json::from_value(reply.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), reply);
    }
    for event in ["preferences.snapshot", "preferences.changed"] {
        let value = json!({"event":event,"preferences":preferences});
        let parsed: DeviceEvent = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
}

#[test]
fn receiver_fixture_covers_conversation_and_client_precedence() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/message_receivers.json")).unwrap();
    let provider: Value = serde_json::from_str::<Value>(include_str!("../../../examples/workspace-pas-v2.json")).unwrap()["agent"].clone();
    for case in cases {
        let mut value = definition();
        value["client"]["capabilities"] = case["capabilities"].clone();
        if case["agent"] == true { value["agent"] = provider.clone(); }
        let app: AppDefinition = serde_json::from_value(value).unwrap();
        let actual = match message_receiver(&app) {
            Some(MessageReceiver::Conversation) => Some("conversation"),
            Some(MessageReceiver::Client) => Some("client"),
            None => None,
        };
        assert_eq!(actual, case["expected"].as_str(), "{case}");
    }
}

#[test]
fn message_bridge_round_trips_requests_results_and_readiness() {
    let request = json!({"type":"ks-client-message","requestId":"bridge-1","message":{"request_id":"send-1","text":"안녕"}});
    let parsed: ClientHostMessage = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    let error = serde_json::to_value(kaleidoscope_contract::errors::DESK_STATE_COMMAND_UNHANDLED()).unwrap();
    for value in [
        json!({"type":"ks-client-message-ready"}),
        json!({"type":"ks-client-message-result","requestId":"bridge-1","result":{"status":"accepted"}}),
        json!({"type":"ks-client-message-result","requestId":"bridge-1","result":{"status":"not_ready","reason":"먼저 설정하세요"}}),
        json!({"type":"ks-client-message-result","requestId":"bridge-1","error":error}),
    ] {
        let parsed: ClientFrameMessage = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
    }
}

#[test]
fn marked_builtin_receiver_is_unique_and_receives_messages() {
    let marked: Vec<_> = BUILTIN_IDENTITIES.iter().filter(|app| app.default_message_receiver).collect();
    assert_eq!(marked.len(), 1);
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps");
    for identity in marked {
        let json = std::fs::read_to_string(root.join(format!("{}.json", identity.id))).unwrap();
        let app = parse_app_definition(&json).unwrap();
        assert_eq!(message_receiver(&app), Some(MessageReceiver::Client), "{}", identity.id);
    }
}
