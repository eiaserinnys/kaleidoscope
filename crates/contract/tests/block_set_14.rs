use kaleidoscope_contract::{data, validate::parse_app_definition};
use serde_json::{json, Value};

fn definition(ui: Value) -> Value {
    json!({
        "id": "block-contract", "name": "블록 계약", "requires": {"blocks": 14, "modules": {}},
        "permissions": [], "state": {"language": "ko"},
        "messages": {"ko": {"title": "제목"}, "en": {"title": "Title"}},
        "locale": {"state": "language"}, "ui": ui
    })
}

fn parsed(value: &Value) -> kaleidoscope_contract::AppDefinition {
    parse_app_definition(&value.to_string()).unwrap_or_else(|e| panic!("{e:?}"))
}

fn rejects(value: &Value, fragment: &str) {
    let error = parse_app_definition(&value.to_string()).expect_err("잘못된 정의가 통과했습니다");
    assert!(
        error.details.iter().any(|detail| detail.contains(fragment)),
        "{error:?}"
    );
}

#[test]
fn nested_templates_roundtrip_and_walk_all_sources() {
    let ui = json!({"type":"section", "title":{"message":"title"},
    "actions":[{"type":"text","value":{"expr":"$data.header"}}],
    "child":{"type":"repeat", "items":{"expr":"$data.rows"}, "key":"id", "layout":"column",
        "template":{"type":"when", "value":true, "child":{"type":"dialog", "open":true,
            "title":{"message":"title"}, "on_close":{"client":"close"},
            "child":{"type":"anchor", "id":"details", "child":{"type":"repeat",
                "items":{"item":"children"}, "key":"id", "layout":"row",
                "template":{"type":"text", "value":{"parent_item":"name"}}
            }}
        }}
    }});
    let mut value = definition(ui);
    value["requires"]["modules"] = json!({"assets":1,"client":2,"http":1});
    value["assets"] = json!([{"id":"client-code","version":1}]);
    value["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1},"actions":["close"]});
    value["permissions"] = json!([{"id":"net","module":"http","label":"웹","base_url":"https://example.com","paths":["/header","/rows"]}]);
    value["sources"] = json!({"header":{"kind":"request","permission":"net","path":"/header"},"rows":{"kind":"request","permission":"net","path":"/rows"}});
    let app = parsed(&value);
    let roundtrip = serde_json::to_value(&app).unwrap();
    parsed(&roundtrip);
    let mut pointers = Vec::new();
    data::walk_blocks(&app.ui, "/ui", &mut |pointer, _| {
        pointers.push(pointer.to_owned())
    });
    assert!(pointers.iter().any(|p| p == "/ui/actions/0"));
    assert!(pointers
        .iter()
        .any(|p| p.ends_with("/child/child/child/template")));
    let live = data::live_sources(&app, &[]);
    assert!(live.contains("header") && live.contains("rows"), "{live:?}");
}

#[test]
fn rejects_missing_key_and_out_of_scope_references() {
    let mut app = definition(
        json!({"type":"repeat","items":[],"layout":"column","template":{"type":"text","value":"x"}}),
    );
    rejects(&app, "key");
    app["ui"] = json!({"type":"text","value":{"item":"name"}});
    rejects(&app, "repeat");
    app["ui"] = json!({"type":"repeat","items":[],"key":"id","layout":"column","template":{"type":"text","value":{"parent_item":"name"}}});
    rejects(&app, "parent_item");
}

#[test]
fn rejects_button_grid_inside_repeat_template() {
    let grid = json!({"type":"button_grid","columns":1,"buttons":[{"key":"a","label":"A"}],"on_press":{"set_state":"language"}});
    parsed(&definition(grid.clone()));
    let app = definition(json!({"type":"repeat","items":[],"key":"id","template":{
        "type":"stack","direction":"column","children":[grid]
    }}));
    rejects(
        &app,
        "/ui/template/children/0: repeat 안에는 button_grid를 둘 수 없습니다. button을 사용하세요",
    );
}

#[test]
fn rejects_duplicate_shortcut_and_missing_translation() {
    let mut app = definition(json!({"type":"text","value":{"message":"title"}}));
    app["shortcuts"] = json!([
        {"code":"KeyZ","modifiers":["shift"],"action":{"set_state":"language"}},
        {"code":"KeyZ","modifiers":["shift"],"action":{"set_state":"language"}}
    ]);
    rejects(&app, "중복");
    app.as_object_mut().unwrap().remove("shortcuts");
    app["messages"]["en"] = json!({});
    rejects(&app, "title");
}

#[test]
fn schema_includes_new_blocks_and_fields() {
    let schema = kaleidoscope_contract::app_definition_schema().to_string();
    for name in [
        "repeat",
        "when",
        "dialog",
        "tour",
        "anchor",
        "progress",
        "parent_item",
        "messages",
        "shortcuts",
    ] {
        assert!(schema.contains(name), "{name}");
    }
}

#[test]
fn restricted_bindings_are_rejected_in_sources_client_inputs_and_actions() {
    for binding in [
        json!({"item":"name"}),
        json!({"parent_item":"name"}),
        json!({"message":"title"}),
    ] {
        let mut app = definition(json!({"type":"text","value":"내용"}));
        app["requires"]["modules"] = json!({"http":1,"assets":1,"client":2});
        app["permissions"] = json!([{"id":"net","module":"http","label":"웹","base_url":"https://example.com","paths":["/"]}]);
        app["sources"] =
            json!({"source":{"kind":"request","permission":"net","path":binding.clone()}});
        rejects(&app, "/sources/source/path");
        app["sources"] = json!({});
        app["assets"] = json!([{"id":"client-code","version":1}]);
        app["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1},"inputs":{"x":binding.clone()}});
        rejects(&app, "/client/inputs/x");
        app["client"]["inputs"] = json!({});
        app["client"]["commands"] =
            json!({"save":[{"set_state":"language","value":binding.clone()}]});
        rejects(&app, "/client/commands/save");
        app["client"]["commands"] = json!({});
        app["ui"] = json!({"type":"repeat","items":[],"key":"id","layout":"column","template":{"type":"button","label":"저장","on_click":[{"set_state":"language","value":binding.clone()}]}});
        if binding.get("message").is_none() {
            rejects(&app, "/ui/template/on_click");
        }
    }
}

#[test]
fn new_wire_requests_roundtrip() {
    for wire in [
        json!({"op":"client.http_read","window_id":"window","permission":"net","path":"/fonts","query":{"family":"sans"}}),
        json!({"op":"client.blob_put","window_id":"window","key":"audio/song","file_id":"file"}),
        json!({"op":"client.blob_open","window_id":"window","key":"audio/song"}),
        json!({"op":"client.blob_remove","window_id":"window","key":"audio/song"}),
        json!({"op":"client.blob_list","window_id":"window","prefix":"audio/"}),
        json!({"op":"files.save_prompt","window_id":"window","suggested_name":"result.mp4","mime":"video/mp4"}),
    ] {
        let parsed: kaleidoscope_contract::CoreRequest =
            serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), wire);
    }
}

#[test]
fn v14_fields_require_new_block_set() {
    for ui in [
        json!({"type":"text","value":"x","format":"time"}),
        json!({"type":"stack","direction":"column","wrap":true,"children":[{"type":"text","value":"x"}]}),
        json!({"type":"input","value":{"state":"n"},"on_change":{"set_state":"n"},"min":0}),
        json!({"type":"button","label":"x","variant":"chip","on_click":{"set_state":"n"}}),
        json!({"type":"section","title":"x","actions":[{"type":"text","value":"x"}],"child":{"type":"text","value":"x"}}),
    ] {
        let mut app = definition(ui);
        app["requires"]["blocks"] = json!(13);
        app.as_object_mut().unwrap().remove("messages");
        app.as_object_mut().unwrap().remove("locale");
        app["state"]["n"] = json!(0);
        rejects(&app, "14판");
        app["requires"]["blocks"] = json!(14);
        parsed(&app);
    }
}

#[test]
fn v14_block_fields_roundtrip() {
    let mut app = definition(
        json!({"type":"stack","direction":"column","wrap":true,"children":[
            {"type":"anchor","id":"intro","child":{"type":"text","value":{"message":"title"},"format":"time","on_click":{"set_state":"language"},"on_double_click":{"set_state":"language"}}},
            {"type":"tour","open":true,"step":"first","steps":[{"key":"first","target":"intro","title":{"message":"title"},"body":{"message":"title"}}],"on_step":{"set_state":"language"},"on_close":{"set_state":"language"}},
            {"type":"progress","value":0.5,"max":1,"label":{"message":"title"}},
            {"type":"repeat","items":[],"key":"id","layout":"grid","grid":{"columns":"auto"},"virtual":true,"follow_pause_ms":2500,"follow_key":"a","template":
                {"type":"input","kind":"number","value":{"item":"start"},"min":0,"max":{"item":"end"},"step":0.01,"format":{"kind":"decimal","digits":2},"commit":"blur","focus":{"item":"focus"},"on_cancel":{"set_state":"language"},"on_change":{"set_state":"language"}}},
            {"type":"timeline","duration":5,"position":0,"tracks":[],"viewport":{"state":"viewport"},"controls":true,"on_viewport":{"set_state":"viewport"}}
        ]}),
    );
    app["state"]["viewport"] = json!({"start":0,"end":5});
    let definition = parsed(&app);
    let serialized = serde_json::to_value(definition).unwrap();
    parsed(&serialized);
}

#[test]
fn duplicate_anchor_and_invalid_locale_are_rejected() {
    let mut app = definition(json!({"type":"stack","direction":"column","children":[
        {"type":"anchor","id":"same","child":{"type":"text","value":"a"}},
        {"type":"anchor","id":"same","child":{"type":"text","value":"b"}}
    ]}));
    rejects(&app, "anchor id");
    app["ui"] = json!({"type":"text","value":{"message":"title"}});
    app["locale"]["state"] = json!("missing");
    rejects(&app, "missing");
}

#[test]
fn new_empty_and_false_fields_still_require_version_fourteen() {
    for ui in [
        json!({"type":"stack","direction":"column","wrap":false,"children":[{"type":"text","value":"x"}]}),
        json!({"type":"timeline","duration":1,"position":0,"tracks":[],"controls":false}),
        json!({"type":"section","title":"x","actions":[],"child":{"type":"text","value":"x"}}),
    ] {
        let mut app = definition(ui);
        app["requires"]["blocks"] = json!(13);
        app.as_object_mut().unwrap().remove("messages");
        app.as_object_mut().unwrap().remove("locale");
        rejects(&app, "14판");
    }
}

#[test]
fn repeated_item_cannot_be_used_in_save_action_values() {
    let mut app = definition(json!({"type":"repeat","items":[],"key":"id","template":{
        "type":"button","label":"저장","on_click":{"save_file":{"suggested_name":{"item":"name"},"mime":"text/plain","client":"saved"}}
    }}));
    app["requires"]["modules"] = json!({"assets":1,"client":2});
    app["assets"] = json!([{"id":"client-code","version":1}]);
    app["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1},"actions":["saved"]});
    rejects(&app, "항목 바인딩은 동작");
}

#[test]
fn localized_save_name_is_not_sent_to_core_binding_collection() {
    let mut app = definition(json!({"type":"button","label":"저장","on_click":{
        "save_file":{"suggested_name":{"message":"title"},"mime":"text/plain","client":"saved"}
    }}));
    app["requires"]["modules"] = json!({"assets":1,"client":2});
    app["assets"] = json!([{"id":"client-code","version":1}]);
    app["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1},"actions":["saved"]});
    let app = parsed(&app);
    assert!(!data::ui_bindings(&app)
        .iter()
        .any(|(pointer, _)| pointer.ends_with("/save_file/suggested_name")));
}

#[test]
fn existing_bundled_definitions_keep_their_required_versions() {
    use std::fs;
    use std::path::Path;
    for dir in ["apps", "examples"] {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(dir);
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            let app = parsed(&value);
            assert_eq!(
                app.requires.blocks,
                value["requires"]["blocks"].as_u64().unwrap() as u32,
                "{}",
                path.display()
            );
        }
    }
}

#[test]
fn slider_accepts_clock_values_at_version_fourteen() {
    let clock = json!({"position":1.0,"sampled_at":10.0,"rate":1.0,"running":true,"duration":5.0});
    let mut app = definition(
        json!({"type":"slider","value":clock,"min":0,"max":5,"on_change":{"set_state":"position"}}),
    );
    app["state"]["position"] = json!(0);
    parsed(&app);
    app["requires"]["blocks"] = json!(13);
    app.as_object_mut().unwrap().remove("messages");
    app.as_object_mut().unwrap().remove("locale");
    rejects(&app, "14판");
}

#[test]
fn client_bridge_optional_payloads_roundtrip() {
    use kaleidoscope_contract::client::{ClientBridgeReply, ClientBridgeRequest};
    let request =
        json!({"type":"ks-client-blob-put","requestId":"1","key":"audio/song","fileId":"file"});
    let parsed: ClientBridgeRequest = serde_json::from_value(request.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), request);
    let reply = json!({"type":"ks-client-reply","requestId":"1","result":"file"});
    let parsed: ClientBridgeReply = serde_json::from_value(reply.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), reply);
}

#[test]
fn shortcuts_accept_client_actions_and_collect_core_action_dependencies() {
    let mut app = definition(json!({"type":"text","value":"내용"}));
    app["requires"]["modules"] = json!({"assets":1,"client":2,"http":1});
    app["assets"] = json!([{"id":"client-code","version":1}]);
    app["client"] = json!({"runtime":"javascript","entry":{"id":"client-code","version":1},"actions":["space"]});
    app["permissions"] = json!([{"id":"net","module":"http","label":"웹","base_url":"https://example.com","paths":["/data"]}]);
    app["sources"] = json!({"content":{"kind":"request","permission":"net","path":"/data"}});
    app["shortcuts"] = json!([
        {"code":"Space","modifiers":[],"action":{"client":"space"}},
        {"code":"KeyZ","modifiers":["primary"],"action":[{"set_state":"language","value":{"expr":"$data.content"}}]}
    ]);
    let app = parsed(&app);
    assert!(data::ui_actions(&app)
        .iter()
        .any(|(pointer, _)| pointer == "/shortcuts/1/action"));
    assert!(data::live_sources(&app, &[]).contains("content"));
}
