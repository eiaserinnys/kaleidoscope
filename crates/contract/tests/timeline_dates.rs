use kaleidoscope_contract::{data, validate::parse_app_definition, BLOCK_SET_VERSION};
use serde_json::{json, Value};

fn definition(ui: Value) -> Value {
    json!({"id":"timeline-dates-test", "name":"일정", "requires":{"blocks":BLOCK_SET_VERSION,"modules":{}},
        "permissions":[], "state":{"holidays":["2026-11-05"]}, "ui":ui})
}

fn parse(ui: Value) -> Result<kaleidoscope_contract::AppDefinition, kaleidoscope_contract::CoreError> {
    parse_app_definition(&definition(ui).to_string())
}

#[test]
fn dates_accepts_inclusive_and_undated_items_and_collects_off_days() {
    let ui = json!({"type":"timeline", "scale":"dates", "lanes":"each", "today":false,
        "off_days":{"state":"holidays"}, "tracks":[{"id":"a", "meta":"셋", "items":[
            {"id":"one", "start":"2026-11-05", "end":"2026-11-05", "muted":true},
            {"id":"none"}]}], "markers":[{"id":"m", "time":"2026-11-07"}],
        "viewport":{"start":"2026-11-01", "end":"2026-11-30"}});
    let app = parse(ui).unwrap();
    let encoded = serde_json::to_value(&app).unwrap();
    assert_eq!(encoded["ui"]["tracks"][0]["items"][0]["end"], "2026-11-05");
    let paths: Vec<_> = data::all_ui_bindings(&app).into_iter().map(|(pointer, _)| pointer).collect();
    assert!(paths.iter().any(|path| path == "/ui/off_days"), "{paths:?}");
}

#[test]
fn scale_specific_fields_and_bad_dates_are_rejected() {
    let cases = [
        (json!({"type":"timeline", "tracks":[]}), "APP_TIMELINE_FIELD_REQUIRED"),
        (json!({"type":"timeline", "duration":5, "position":0, "tracks":[], "today":true}), "APP_TIMELINE_SECONDS_FIELD_FORBIDDEN"),
        (json!({"type":"timeline", "duration":5, "position":0, "tracks":[], "lanes":"pack"}), "APP_TIMELINE_SECONDS_FIELD_FORBIDDEN"),
        (json!({"type":"timeline", "scale":"dates", "duration":5, "tracks":[]}), "APP_TIMELINE_DATES_FIELD_FORBIDDEN"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[{"id":"a", "waveform":{"peaks":[]}, "items":[]}]}), "APP_TIMELINE_DATES_FIELD_FORBIDDEN"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[{"id":"a", "items":[{"id":"x","start":"2026-02-30","end":"2026-03-01"}]}]}), "APP_TIMELINE_ITEM_DATE_INVALID"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[{"id":"a", "items":[{"id":"x","start":"2026-03-02"}]}]}), "APP_TIMELINE_ITEM_DATE_PAIR_INCOMPLETE"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[{"id":"a", "items":[{"id":"x","start":"2026-03-02","end":"2026-03-01"}]}]}), "APP_TIMELINE_ITEM_DATE_REVERSED"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[], "off_days":["2026-02-30"]}), "APP_TIMELINE_OFF_DAY_INVALID"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[], "markers":[{"id":"x","time":"2026-02-30"}]}), "APP_TIMELINE_MARKER_DATE_INVALID"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[], "viewport":{"start":"2026-02-30","end":"2026-03-01"}}), "APP_TIMELINE_VIEWPORT_DATE_INVALID"),
        (json!({"type":"timeline", "scale":"dates", "tracks":[], "viewport":{"start":"2026-03-02","end":"2026-03-01"}}), "APP_TIMELINE_VIEWPORT_DATE_REVERSED"),
        (json!({"type":"timeline", "duration":5, "position":0, "tracks":[{"id":"a","items":[{"id":"x","start":"2026-01-01","end":"2026-01-02"}]}]}), "APP_TIMELINE_ITEM_SECONDS_INVALID"),
        (json!({"type":"timeline", "duration":5, "position":0, "tracks":[], "markers":[{"id":"x","time":"2026-01-01"}]}), "APP_TIMELINE_MARKER_SECONDS_INVALID"),
    ];
    for (ui, code) in cases {
        let error = parse(ui.clone()).expect_err("invalid timeline accepted");
        assert_eq!(error.id.as_deref(), Some(code), "{ui}: {error:?}");
    }
}

#[test]
fn dates_fields_require_new_block_set() {
    let mut value = definition(json!({"type":"timeline","scale":"dates","tracks":[]}));
    value["requires"]["blocks"] = json!(BLOCK_SET_VERSION - 1);
    let error = parse_app_definition(&value.to_string()).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("APP_TIMELINE_VERSION_REQUIRED"));
}
