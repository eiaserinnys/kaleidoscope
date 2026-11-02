use kaleidoscope_contract::validate::parse_app_definition;
use serde_json::{json, Value};

fn definition(ui: Value) -> Value {
    json!({
        "id":"client-test", "name":"클라이언트 시험",
        "requires":{"blocks":12,"modules":{"assets":1,"client":1}},
        "permissions":[], "state":{"value":0},
        "assets":[{"id":"script","version":1}],
        "client":{"runtime":"javascript","entry":{"id":"script","version":1},
            "inputs":{"value":{"state":"value"}},
            "outputs":{"value":{"default":0},"tracks":{"default":[]}},
            "actions":["change","seek"],"commands":{},"state_keys":[],"storage_entries":[]},
        "ui":ui
    })
}

fn accepted(value: &Value) -> bool {
    parse_app_definition(&value.to_string()).is_ok()
}

#[test]
fn client_outputs_drive_controls_and_timeline() {
    let app = definition(json!({"type":"stack","direction":"column","children":[
        {"type":"slider","value":{"client":"value"},"on_change":{"client":"change"},"min":0,"max":10},
        {"type":"canvas","surface":"preview","aspect_ratio":1.5},
        {"type":"timeline","duration":10,"position":{"client":"value"},"tracks":{"client":"tracks"},"on_seek":[{"client":"seek"}]}
    ]}));
    assert!(accepted(&app));
}

#[test]
fn client_bindings_and_actions_are_restricted_to_declared_names_and_positions() {
    let valid = definition(json!({"type":"button","label":"실행","on_click":{"client":"change"}}));
    assert!(accepted(&valid));
    let mut invalid = valid.clone();
    invalid["ui"]["on_click"] = json!([{"client":"change"},{"set_state":"value"}]);
    assert!(!accepted(&invalid));
    invalid["ui"]["on_click"] = json!({"client":"missing"});
    assert!(!accepted(&invalid));
    let mut invalid = valid.clone();
    invalid["client"]["inputs"]["value"] = json!({"client":"value"});
    assert!(!accepted(&invalid));
    let mut invalid = valid.clone();
    invalid["client"]["entry"]["version"] = json!(2);
    assert!(!accepted(&invalid));
}

#[test]
fn control_values_accept_only_state_or_declared_client_output() {
    for (mut block, slot) in [
        (
            json!({"type":"input","on_change":{"client":"change"}}),
            "value",
        ),
        (
            json!({"type":"select","on_change":{"client":"change"},"options":[]}),
            "value",
        ),
        (
            json!({"type":"toggle","label":"시험","on_change":{"client":"change"}}),
            "value",
        ),
        (
            json!({"type":"slider","on_change":{"client":"change"},"min":0,"max":10}),
            "value",
        ),
        (
            json!({"type":"color","on_change":{"client":"change"}}),
            "value",
        ),
        (json!({"type":"list","items":[]}), "selected"),
        (
            json!({"type":"table","rows":[],"columns":[{"field":"title","label":"제목"}]}),
            "selected",
        ),
    ] {
        for value in [json!({"state":"value"}), json!({"client":"value"})] {
            block[slot] = value;
            assert!(accepted(&definition(block.clone())), "{block}");
        }
        for value in [json!(5), json!({"expr":"1"}), json!({"client":"missing"})] {
            block[slot] = value;
            assert!(!accepted(&definition(block.clone())), "{block}");
        }
    }
}

#[test]
fn local_actions_accept_one_object_or_one_element_and_reject_mixed_arrays() {
    for action in [
        json!({"client":"change"}),
        json!({"pick_files":{"accept":[],"client":"change"}}),
        json!({"save_file":{"suggested_name":{"expr":"'파일'"},"mime":"text/plain","client":"change"}}),
    ] {
        let mut app = definition(json!({"type":"button","label":"시험","on_click":action}));
        assert!(accepted(&app));
        app["ui"]["on_click"] = json!([action]);
        assert!(accepted(&app));
        app["ui"]["on_click"] = json!([action, {"set_state":"value"}]);
        assert!(!accepted(&app));
    }
}

#[test]
fn literal_timeline_rejects_invalid_waveforms_and_duplicate_ids() {
    let mut app = definition(
        json!({"type":"timeline","duration":5,"position":0,"tracks":[{"id":"lyrics","items":[{"id":"line","start":1,"end":2}],"waveform":{"peaks":[0,1],"start":0,"end":5}}]}),
    );
    assert!(accepted(&app));
    app["ui"]["tracks"][0]["waveform"]["peaks"] = json!([1.1]);
    assert!(!accepted(&app));
    app["ui"]["tracks"][0]["waveform"]["peaks"] = json!([0.5]);
    app["ui"]["markers"] = json!([{"id":"line","time":1}]);
    assert!(!accepted(&app));
}

#[test]
fn local_agent_configuration_cannot_depend_on_client_only_output() {
    let mut app: Value = serde_json::from_str(include_str!("../../../apps/agent.json")).unwrap();
    app["requires"]["blocks"] = json!(12);
    app["requires"]["modules"]["assets"] = json!(1);
    app["requires"]["modules"]["client"] = json!(1);
    app["assets"] = json!([{"id":"script","version":1}]);
    app["client"] = json!({"runtime":"javascript","entry":{"id":"script","version":1},"outputs":{"agents":{"default":[]}}});
    app["ui"]["agents"] = json!({"client":"agents"});
    assert!(!accepted(&app));
}

#[test]
fn save_file_expression_is_calculated_for_object_and_array_actions() {
    let action = json!({"save_file":{"suggested_name":{"expr":"'보고서' & '.txt'"},"mime":"text/plain","client":"change"}});
    for (value, pointer) in [
        (action.clone(), "/ui/on_click/save_file/suggested_name"),
        (json!([action]), "/ui/on_click/0/save_file/suggested_name"),
    ] {
        let app = definition(json!({"type":"button","label":"저장","on_click":value}));
        let parsed = parse_app_definition(&app.to_string()).unwrap();
        assert!(kaleidoscope_contract::data::ui_bindings(&parsed)
            .iter()
            .any(|(slot, _)| slot == pointer));
    }
}

#[test]
fn client_outputs_are_accepted_in_document_tree_and_sandbox_values() {
    for block in [
        json!({"type":"markdown","value":{"client":"value"},"read_only":true}),
        json!({"type":"code","value":{"client":"value"},"read_only":true}),
        json!({"type":"html_view","value":{"client":"value"}}),
        json!({"type":"tree","items":{"client":"tracks"}}),
        json!({"type":"sandbox","value":{"client":"value"}}),
    ] {
        assert!(accepted(&definition(block.clone())), "{block}");
    }
}

#[test]
fn dynamic_button_labels_and_icons_keep_literal_validation() {
    let mut app = definition(
        json!({"type":"button","label":{"client":"value"},"icon":{"client":"value"},"on_click":{"client":"change"}}),
    );
    assert!(accepted(&app));
    app["ui"]["label"] = json!("");
    assert!(!accepted(&app));
    app["ui"]["label"] = json!("재생");
    app["ui"]["icon"] = json!("없는-아이콘");
    assert!(!accepted(&app));
    app["ui"]["icon"] = json!("play");
    assert!(accepted(&app));
}

#[test]
fn controls_support_labels_disabled_color_and_grouped_options() {
    let app = definition(json!({"type":"stack","direction":"column","children":[
        {"type":"input","label":"BPM","value":{"state":"value"},"on_change":{"client":"change"}},
        {"type":"select","label":"스타일","value":{"state":"value"},"on_change":{"client":"change"},"options":[{"name":"묶음","options":[{"value":"a","label":"항목"}]}]},
        {"type":"color","label":"배경","value":{"client":"value"},"disabled":{"client":"value"},"on_change":{"client":"change"}}
    ]}));
    assert!(accepted(&app));
    let group = json!({"name":"묶음","options":[{"value":"a","label":"항목"}]});
    assert!(serde_json::from_value::<kaleidoscope_contract::data::SelectGroup>(group).is_ok());
}

#[test]
fn new_control_fields_require_block_set_twelve() {
    for block in [
        json!({"type":"input","label":"BPM","value":{"state":"value"},"on_change":{"set_state":"value"}}),
        json!({"type":"select","label":"스타일","value":{"state":"value"},"on_change":{"set_state":"value"},"options":[]}),
        json!({"type":"select","value":{"state":"value"},"on_change":{"set_state":"value"},"options":[{"name":"기본","options":["a"]}]}),
        json!({"type":"color","value":{"state":"value"},"disabled":false,"on_change":{"set_state":"value"}}),
        json!({"type":"button","label":{"expr":"'재생'"},"on_click":{"set_state":"value"}}),
    ] {
        let mut app = definition(block.clone());
        app["requires"] = json!({"blocks":11,"modules":{}});
        app.as_object_mut().unwrap().remove("client");
        app.as_object_mut().unwrap().remove("assets");
        assert!(!accepted(&app), "{block}");
    }
}

#[test]
fn canvas_ratio_accepts_declared_binding_and_rejects_invalid_literals() {
    assert!(accepted(&definition(
        json!({"type":"canvas","surface":"preview","aspect_ratio":{"client":"value"}})
    )));
    assert!(!accepted(&definition(
        json!({"type":"canvas","surface":"preview","aspect_ratio":{"client":"missing"}})
    )));
    for ratio in [json!(0), json!(-1), json!("wide")] {
        assert!(!accepted(&definition(
            json!({"type":"canvas","surface":"preview","aspect_ratio":ratio})
        )));
    }
}
