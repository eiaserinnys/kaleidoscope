use kaleidoscope_contract::{data, validate::parse_app_definition, Block};
use serde_json::{json, Value};
const N: u32 = kaleidoscope_contract::TABLE_GRID_BLOCK_SET_VERSION;

fn definition(ui: Value, blocks: u32) -> Value {
    json!({"id":"matrix", "name":"일정", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"columns":[],"chosen":null}, "ui":ui})
}

fn grid() -> Value {
    json!({"type":"table", "rows":[], "columns":[
        {"field":"label","label":"항목"},
        {"field":"a","label":"월요일","format":"content","max_lines":3}
    ], "selection":"cell", "row_header":"label", "selected":{"state":"chosen"},
        "on_select":{"set_state":"chosen"}})
}

#[test]
fn 기존_열_배열과_새_열_바인딩의_wire와_순회() {
    let old = json!({"type":"table", "rows":[], "columns":[{"field":"name","label":"이름"}]});
    let parsed = parse_app_definition(&definition(old.clone(), 4).to_string()).unwrap();
    let wire = serde_json::to_value(parsed.ui).unwrap();
    assert_eq!(wire["columns"][0]["field"], old["columns"][0]["field"]);
    assert_eq!(wire["columns"][0]["label"], old["columns"][0]["label"]);

    let mut bound = grid();
    bound["columns"] = json!({"state":"columns"});
    let parsed = parse_app_definition(&definition(bound.clone(), N).to_string()).unwrap();
    assert!(data::all_ui_bindings(&parsed).iter().any(|(path, _)| path == "/ui/columns"));
    assert_eq!(serde_json::to_value(&parsed.ui).unwrap()["columns"], bound["columns"]);
    for value in [json!({"state":"columns"}), json!({"expr":"[]"}), json!({"client":"columns"})] {
        let mut table = bound.clone();
        table["columns"] = value;
        let mut app = parsed.clone();
        app.ui = serde_json::from_value::<Block>(table).unwrap();
        assert!(data::all_ui_bindings(&app).iter().any(|(path, _)| path == "/ui/columns"));
    }
}

#[test]
fn 잘못된_열_배열과_리터럴은_거부한다() {
    for columns in [json!([{"field":"a"}]), json!({"unexpected":true}), json!("열")] {
        let mut table = grid();
        table["columns"] = columns;
        assert!(serde_json::from_value::<Block>(table).is_err());
    }
}

#[test]
fn 새_기능은_새_판을_요구하고_잘못된_조합을_거부한다() {
    assert!(parse_app_definition(&definition(grid(), N - 1).to_string()).is_err());
    assert!(parse_app_definition(&definition(grid(), N).to_string()).is_ok());
    let mut cases = Vec::new();
    let mut missing_selected = grid(); missing_selected.as_object_mut().unwrap().remove("selected"); cases.push(missing_selected);
    let mut missing_action = grid(); missing_action.as_object_mut().unwrap().remove("on_select"); cases.push(missing_action);
    let mut sorted = grid(); sorted["sort"] = json!({"field":"label"}); cases.push(sorted);
    let mut wrong_header = grid(); wrong_header["row_header"] = json!("a"); cases.push(wrong_header);
    let mut no_data = grid(); no_data["columns"] = json!([{"field":"label","label":"항목"}]); cases.push(no_data);
    let mut bad_lines = grid(); bad_lines["columns"][1]["max_lines"] = json!(4); cases.push(bad_lines);
    let mut zero_lines = grid(); zero_lines["columns"][1]["max_lines"] = json!(0); cases.push(zero_lines);
    let mut wrong_lines = grid(); wrong_lines["columns"][0]["max_lines"] = json!(2); cases.push(wrong_lines);
    let mut duplicate = grid(); duplicate["columns"][1]["field"] = json!("label"); cases.push(duplicate);
    let mut row_header_in_rows = grid(); row_header_in_rows["selection"] = json!("row"); cases.push(row_header_in_rows);
    for table in cases {
        assert!(parse_app_definition(&definition(table.clone(), N).to_string()).is_err(), "{table}");
    }
}

#[test]
fn 동적_열의_알려진_초기값을_검사한다() {
    let mut table = grid();
    table["columns"] = json!({"state":"columns"});
    let mut app = definition(table, N);
    for value in [json!([{ "field":"label" }]), json!([{ "field":"label", "label":"항목" }])] {
        app["state"]["columns"] = value;
        assert!(parse_app_definition(&app.to_string()).is_err());
    }
    app["state"]["columns"] = json!([]);
    assert!(parse_app_definition(&app.to_string()).is_ok());
}

#[test]
fn 새_열과_칸_필드는_각각_새_판을_요구한다() {
    let old = json!({"type":"table", "rows":[], "columns":[{"field":"name","label":"이름"}]});
    let mut bound = old.clone(); bound["columns"] = json!({"state":"columns"});
    let mut content = old.clone(); content["columns"][0]["format"] = json!("content");
    let mut lines = content.clone(); lines["columns"][0]["max_lines"] = json!(2);
    let mut cell = old.clone(); cell["selection"] = json!("cell"); cell["selected"] = json!({"state":"chosen"}); cell["on_select"] = json!({"set_state":"chosen"});
    for table in [bound, content, lines, cell] {
        assert!(parse_app_definition(&definition(table.clone(), N - 1).to_string()).is_err(), "{table}");
        assert!(parse_app_definition(&definition(table.clone(), N).to_string()).is_ok(), "{table}");
    }
    let schema = kaleidoscope_contract::app_definition_schema();
    let encoded = schema.to_string();
    for name in ["TableColumns", "TableSelection", "row_header", "max_lines", "content"] {
        assert!(encoded.contains(name), "missing {name}");
    }
}
