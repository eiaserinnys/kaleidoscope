use kaleidoscope_contract::validate::parse_app_definition;
use kaleidoscope_contract::{data::ICON_NAMES, EXTENDED_ICON_BLOCK_SET_VERSION};
use serde_json::{json, Value};

const EXTENDED: &[&str] = &[
    "scissors",
    "flip-horizontal-2",
    "gauge",
    "repeat",
    "list-video",
    "music-2",
    "images",
    "timer",
    "audio-lines",
    "scissors-line-dashed",
    "fast-forward",
    "repeat-2",
    "list-music",
];

fn definition(blocks: u32, ui: Value) -> Value {
    json!({"id":"extended-icon-test", "name":"아이콘 시험", "requires":{"blocks":blocks,"modules":{}},
        "permissions":[], "state":{"choice":null}, "ui":ui})
}

fn parse(blocks: u32, ui: Value) -> Result<(), String> {
    parse_app_definition(&definition(blocks, ui).to_string())
        .map(|_| ())
        .map_err(|error| error.id.unwrap_or_default())
}

#[test]
fn extended_icons_require_block_set_53() {
    assert_eq!(EXTENDED_ICON_BLOCK_SET_VERSION, 53);
    for name in EXTENDED {
        for (ui, code) in [
            (
                json!({"type":"list", "items":[{"key":"a", "title":"도구", "icon":name}]}),
                "APP_LIST_ICON_VERSION_LOW",
            ),
            (
                json!({"type":"button", "label":"실행", "icon":name, "on_click":{"set_state":"choice"}}),
                "APP_BUTTON_ICON_VERSION_LOW",
            ),
            (
                json!({"type":"button_grid", "columns":1,
                    "buttons":[{"key":"a", "label":"실행", "icon":name}], "on_press":{"set_state":"choice"}}),
                "APP_BUTTON_GRID_ICON_VERSION_LOW",
            ),
        ] {
            assert_eq!(parse(EXTENDED_ICON_BLOCK_SET_VERSION - 1, ui.clone()), Err(code.into()), "{name}");
            assert!(parse(EXTENDED_ICON_BLOCK_SET_VERSION, ui).is_ok(), "{name}");
        }
    }
}

#[test]
fn extended_icons_are_known_shell_names() {
    for name in EXTENDED {
        assert!(ICON_NAMES.contains(name), "{name}");
    }
    let list = json!({"type":"list", "items":[{"key":"a", "title":"도구", "icon":"audio-lines"}]});
    assert!(parse_app_definition(&definition(EXTENDED_ICON_BLOCK_SET_VERSION, list).to_string()).is_ok());
}

#[test]
fn earlier_icons_keep_their_versions() {
    for name in ["crop", "music"] {
        let list = json!({"type":"list", "items":[{"key":"a", "title":"도구", "icon":name}]});
        assert_eq!(parse(45, list.clone()), Err("APP_LIST_ICON_VERSION_LOW".into()), "{name}");
        assert!(parse(46, list).is_ok(), "{name}");
        let button = json!({"type":"button", "label":"실행", "icon":name, "on_click":{"set_state":"choice"}});
        assert!(parse(46, button).is_ok(), "{name}");
    }
    let unknown = json!({"type":"list", "items":[{"key":"a", "title":"도구", "icon":"not-an-icon"}]});
    assert_eq!(parse(52, unknown), Err("APP_LIST_ICON_NAME_INVALID".into()));
}
