use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition() -> Value {
    json!({
        "id":"stream-app","name":"스트림 시험","requires":{"blocks":4,"modules":{"connection":4}},
        "permissions":[{"module":"connection","id":"feed","connection":"example","access":"read","label":"피드"}],
        "streams":{"changes":{"permission":"feed","path":"/events","query":{"channel":"cards"}}},
        "state":{"kind":"card"},
        "sources":{
            "items":{"kind":"request","permission":"feed","path":"/items","refresh_secs":30,
                "watch":{"stream":"changes","on":[{"event":"message"},{"event":"update","where":{"kind":{"state":"kind"},"all":null}}],"coalesce_secs":3}}
        },
        "ui":{"type":"text","value":{"expr":"$data.items"}}
    })
}

fn parse(value: &Value) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    parse_app_definition(&value.to_string())
}

fn rejected(mutate: impl FnOnce(&mut Value)) {
    let mut value = definition();
    mutate(&mut value);
    assert!(parse(&value).is_err(), "검사기를 통과했습니다: {value}");
}

#[test]
fn streams_and_watch_round_trip() {
    let value = definition();
    let parsed = parse(&value).expect("스트림 정의");
    let watch = match &parsed.sources["items"] {
        kaleidoscope_contract::data::SourceDecl::Request { watch, .. } => {
            watch.as_ref().expect("watch")
        }
        other => panic!("request 원천이 아닙니다: {other:?}"),
    };
    assert_eq!(watch.stream, "changes");
    assert_eq!(watch.on.len(), 2);
    assert_eq!(watch.on[0].event, "message");
    assert_eq!(watch.coalesce_secs, Some(3));
    let where_ = watch.on[1].where_.as_ref().expect("where");
    assert!(where_.contains_key("kind"));
    assert!(where_.contains_key("all"));
    assert_eq!(parsed.streams["changes"].path, "/events");
    assert_eq!(parsed.streams["changes"].query["channel"], "cards");

    let text = serde_json::to_string(&parsed).unwrap();
    let again: kaleidoscope_contract::AppDefinition = serde_json::from_str(&text).unwrap();
    assert_eq!(again, parsed);
    let reparsed = parse(&serde_json::from_str::<Value>(&text).unwrap()).unwrap();
    assert_eq!(reparsed, parsed);
}

#[test]
fn watch_defaults_coalesce_and_where() {
    let mut value = definition();
    value["sources"]["items"]
        .as_object_mut()
        .unwrap()
        .insert("watch".into(), json!({"stream":"changes","on":[{"event":"message"}]}));
    value["streams"]["changes"]
        .as_object_mut()
        .unwrap()
        .remove("query");
    let parsed = parse(&value).expect("기본값 정의");
    let kaleidoscope_contract::data::SourceDecl::Request { watch: Some(watch), .. } =
        &parsed.sources["items"]
    else {
        panic!("watch가 없습니다");
    };
    assert_eq!(watch.coalesce_secs, None);
    assert!(watch.on[0].where_.is_none());
}

#[test]
fn unknown_stream_is_rejected() {
    rejected(|value| value["sources"]["items"]["watch"]["stream"] = json!("missing"));
}

#[test]
fn empty_on_is_rejected() {
    rejected(|value| value["sources"]["items"]["watch"]["on"] = json!([]));
}

#[test]
fn empty_event_is_rejected() {
    rejected(|value| value["sources"]["items"]["watch"]["on"][0]["event"] = json!(""));
}

#[test]
fn coalesce_below_minimum_is_rejected() {
    rejected(|value| value["sources"]["items"]["watch"]["coalesce_secs"] = json!(0));
}

#[test]
fn non_connection_permission_is_rejected() {
    rejected(|value| {
        value["permissions"] = json!([
            {"module":"connection","id":"feed","connection":"example","access":"read","label":"피드"},
            {"module":"http","id":"api","label":"API","base_url":"https://example.com","paths":["/events"]}
        ]);
        value["requires"]["modules"]["http"] = json!(1);
        value["streams"]["changes"]["permission"] = json!("api");
    });
}

#[test]
fn unused_stream_is_rejected() {
    rejected(|value| {
        value["streams"]["spare"] = json!({"permission":"feed","path":"/other"});
    });
}

#[test]
fn stream_path_must_be_a_connection_path() {
    rejected(|value| value["streams"]["changes"]["path"] = json!("events"));
}

#[test]
fn watch_requires_the_new_connection_module_version() {
    rejected(|value| value["requires"]["modules"]["connection"] = json!(3));
}

#[test]
fn watch_is_allowed_only_on_request_sources() {
    rejected(|value| {
        value["sources"]["items"] = json!({
            "kind":"store","store":"index","permission":"catalog",
            "watch":{"stream":"changes","on":[{"event":"message"}]}
        });
        value["permissions"] = json!([{"module":"store","id":"catalog","label":"목록"}]);
        value["requires"]["modules"] = json!({"store":1});
    });
}
