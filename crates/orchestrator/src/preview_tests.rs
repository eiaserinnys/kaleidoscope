use super::*;
use axum::{routing::any, Router};
use kaleidoscope_contract::{
    data::HttpMethod,
    registry::{ConnectionAccept, ConnectionRequest},
    FileAccess,
};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

fn definition() -> Value {
    json!({
        "id": "preview-test",
        "name": "미리보기 시험",
        "requires": {"blocks": 4, "modules": {"connection": 1, "files": 1}},
        "permissions": [
            {"module": "connection", "id": "relay", "connection": "board", "access": "read", "label": "게시판"},
            {"module": "files", "id": "files", "access": "read", "label": "문서 폴더"}
        ],
        "state": {"filter": "done"},
        "sources": {
            "cards": {"kind": "request", "permission": "relay", "path": "/items"},
            "files": {"kind": "folder", "permission": "files"}
        },
        "ui": {
            "type": "stack", "direction": "column", "children": [
                {"type": "text", "value": {"expr": "$data.cards[status = $state.filter]"}},
                {"type": "text", "value": {"expr": "$data.files"}}
            ]
        }
    })
}

#[tokio::test]
async fn preview_uses_client_output_default_without_running_script() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let definition = json!({"id":"client-preview", "name":"클라이언트 미리보기", "requires":{"blocks":12,"modules":{"assets":1,"client":1}},
        "assets":[{"id":"script","version":1}], "permissions":[], "state":{},
        "client":{"runtime":"javascript","entry":{"id":"script","version":1},"inputs":{},"outputs":{"rows":{"default":[{"key":"one","title":"기본값"}]}},"actions":[],"commands":{},"state_keys":[],"storage_entries":[]},
        "ui":{"type":"list","items":{"client":"rows"}}});
    let value = result_value(server.preview_app_result(args(definition)).await.unwrap());
    assert!(value["values"].as_array().unwrap().iter().any(|item| {
        item["pointer"] == "/ui/items"
            && item["value"]
                .as_str()
                .is_some_and(|text| text.contains("기본값"))
    }));
    assert!(value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|note| note.as_str().unwrap().contains("클라이언트")));
}

fn result_value(result: CallToolResult) -> Value {
    let result = serde_json::to_value(result).unwrap();
    serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
}

fn market_sample_data(
    amount: Option<f64>,
    btc_price: &str,
) -> std::collections::BTreeMap<String, Value> {
    use std::collections::BTreeMap;

    let currencies = [
        ("KRW", 1350.0),
        ("EUR", 0.92),
        ("JPY", 150.0),
        ("GBP", 0.79),
        ("CNY", 7.2),
        ("CHF", 0.88),
        ("CAD", 1.38),
        ("AUD", 1.52),
    ];
    let rates = currencies
        .iter()
        .map(|(code, rate)| ((*code).to_owned(), json!(rate * amount.unwrap_or(1.0))))
        .collect::<serde_json::Map<_, _>>();
    let mut quote = json!({"base":"USD", "date":"2026-11-02", "rates":rates});
    if let Some(amount) = amount {
        quote["amount"] = json!(amount);
    }
    let series_rates = currencies
        .iter()
        .map(|(code, rate)| ((*code).to_owned(), json!(rate)))
        .collect::<serde_json::Map<_, _>>();
    let tickers = [
        ("BTCUSDT", btc_price),
        ("ETHUSDT", "50"),
        ("SOLUSDT", "10"),
        ("XRPUSDT", "0.5"),
        ("BNBUSDT", "20"),
        ("DOGEUSDT", "0.1"),
        ("ADAUSDT", "0.4"),
        ("AVAXUSDT", "30"),
    ]
    .into_iter()
    .map(|(symbol, price)| {
        json!({"symbol":symbol, "lastPrice":price, "priceChangePercent":"2.5", "highPrice":price, "lowPrice":price})
    })
    .collect::<Vec<_>>();
    let world_bank = |value: f64| {
        json!([
            {"page":1},
            [
                {"countryiso3code":"KOR", "value":value, "date":"2025"},
                {"countryiso3code":"USA", "value":value, "date":"2025"},
                {"countryiso3code":"EMU", "value":value, "date":"2025"},
                {"countryiso3code":"DEU", "value":value, "date":"2025"},
                {"countryiso3code":"JPN", "value":value, "date":"2025"},
                {"countryiso3code":"GBR", "value":value, "date":"2025"},
                {"countryiso3code":"CHN", "value":value, "date":"2025"},
                {"countryiso3code":"CHE", "value":value, "date":"2025"},
                {"countryiso3code":"CAN", "value":value, "date":"2025"},
                {"countryiso3code":"AUS", "value":value, "date":"2025"}
            ]
        ])
    };
    let candle = json!([[1790899200000_u64, "100", "110", "90", "105"]]);
    let mut data = BTreeMap::from([
        ("asset_tickers".into(), json!(tickers)),
        ("asset_candles".into(), candle.clone()),
        ("fx_asset_quote".into(), quote),
        (
            "fx_series".into(),
            json!({"base":"USD", "rates":{"2026-10-05":series_rates, "2026-11-01":series_rates}}),
        ),
        ("macro_cpi".into(), world_bank(2.0)),
        ("macro_ppp".into(), world_bank(1300.0)),
    ]);
    for asset in ["btc", "eth", "sol", "xrp", "bnb", "doge", "ada", "avax"] {
        data.insert(format!("trend_{asset}"), candle.clone());
    }
    data
}

async fn fake_origin(status: u16, body: &'static str) -> (String, JoinHandle<()>) {
    let app = Router::new().fallback(any(move || async move {
        (axum::http::StatusCode::from_u16(status).unwrap(), body)
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), server)
}

fn add_relay(state: &AppState, base_url: &str) {
    state.lock_db().unwrap().execute(
        "INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,description,updated_at) VALUES((SELECT account_id FROM mcp_principal WHERE id=1),'board','relay',?1,0,'[\"/items\"]','{}','','now')",
        [base_url],
    ).unwrap();
}

fn args(definition: Value) -> PreviewArgs {
    PreviewArgs {
        app_id: None,
        definition: Some(definition),
        state: None,
        window_id: None,
        workspace_id: None,
        data: None,
        max_chars: None,
    }
}

#[tokio::test]
async fn previews_definition_with_relay_data_using_definition_permissions() {
    let (url, server_task) = fake_origin(
        200,
        r#"[{"status":"running","title":"현재 항목"},{"status":"done","title":"완료 항목"}]"#,
    )
    .await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "ready");
    assert!(value["sources"]["cards"]["bytes"].as_u64().unwrap() > 0);
    assert_eq!(value["values"][0]["pointer"], "/ui/children/0/value");
    assert_eq!(value["values"][0]["status"], "ready");
    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("완료 항목"));
    server_task.abort();
}

#[tokio::test]
async fn preview_fetches_relay_sources_in_dependency_order() {
    let (url, server_task) = fake_origin(200, r#"[{"status":"done","title":"항목"}]"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);
    let mut input = definition();
    input["sources"]["aaa"] = json!({"kind":"request","permission":"relay","path":{"expr":"'/items/' & $data.cards[0].status"}});
    input["ui"]["children"][0]["value"] = json!({"expr":"$data.aaa[0].title"});
    let result = result_value(server.preview_app_result(args(input)).await.unwrap());
    assert_eq!(result["sources"]["cards"]["state"], "ready");
    assert_eq!(result["sources"]["aaa"]["state"], "ready");
    assert_eq!(result["values"][0]["value"], "\"항목\"");
    server_task.abort();
}

#[tokio::test]
async fn preview_accepts_device_source_samples_and_marks_unsampled_sources_idle() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut sample_args = args(definition());
    sample_args.data = Some([("files".into(), json!([{"name":"notes.md"}]))].into());

    let sample = result_value(server.preview_app_result(sample_args).await.unwrap());
    assert_eq!(sample["sources"]["files"]["state"], "ready");
    assert_eq!(sample["values"][1]["status"], "ready");
    assert!(sample["values"][1]["value"]
        .as_str()
        .unwrap()
        .contains("notes.md"));

    let idle = result_value(server.preview_app_result(args(definition())).await.unwrap());
    assert_eq!(idle["sources"]["files"]["state"], "idle");
    assert!(idle["notes"].as_array().unwrap().iter().any(|note| {
        note.as_str()
            .unwrap()
            .contains("기기에서만 받는 원천: files")
    }));
}

#[tokio::test]
async fn preview_warns_when_a_host_exceeds_the_default_screen_call_budget() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let definition = json!({
        "id": "over-budget-preview",
        "name": "예산 초과 미리보기",
        "requires": {"blocks": 4, "modules": {"http": 1}},
        "permissions": [{"module":"http", "id":"public", "label":"공개 API", "base_url":"https://api.example.test", "paths":["/first", "/second"]}],
        "state": {},
        "sources": {
            "first": {"kind":"request", "permission":"public", "path":"/first", "refresh_secs":10},
            "second": {"kind":"request", "permission":"public", "path":"/second", "refresh_secs":10}
        },
        "ui": {"type":"stack", "direction":"column", "children":[
            {"type":"text", "value":{"expr":"$data.first"}},
            {"type":"text", "value":{"expr":"$data.second"}}
        ]}
    });
    let mut preview = args(definition);
    preview.data = Some(
        [
            ("first".into(), json!({"ok":1})),
            ("second".into(), json!({"ok":2})),
        ]
        .into(),
    );

    let value = result_value(server.preview_app_result(preview).await.unwrap());
    assert!(value["warnings"].as_array().unwrap().iter().any(|warning| {
        warning.as_str().unwrap()
            == "api.example.test: 기본 화면에서 분당 12.0회 호출합니다. 묶음 요청을 찾거나 refresh_secs를 늘리십시오(기준 분당 6회)."
    }));
}

#[test]
fn market_display_bindings_match_for_legacy_and_normalized_fx_samples() {
    use kaleidoscope_contract::{data::BindingValue, validate::parse_app_definition};
    use kaleidoscope_data::CompiledApp;
    use std::collections::BTreeMap;

    fn restore_legacy_fx_formulas(value: &mut Value) {
        match value {
            Value::String(expression) => {
                let legacy_expression = expression.replace(
                    "\"asset_quote\":$lookup($data.fx_asset_quote.rates,$code)*$number($data.asset_tickers[symbol = ($state.asset & 'USDT')].lastPrice)",
                    "\"asset_quote\":$lookup($data.fx_asset_quote.rates,$code)",
                );
                let marker = "$lookup($data.fx_asset_quote.rates,";
                let mut restored = String::with_capacity(legacy_expression.len() + 64);
                let mut cursor = 0;
                while let Some(relative_start) = legacy_expression[cursor..].find(marker) {
                    let start = cursor + relative_start;
                    restored.push_str(&legacy_expression[cursor..start]);
                    let end = start + legacy_expression[start..].find(')').unwrap() + 1;
                    let lookup = &legacy_expression[start..end];
                    if legacy_expression[..start]
                        .trim_end()
                        .ends_with("\"asset_quote\":")
                    {
                        restored.push_str(lookup);
                    } else {
                        restored.push('(');
                        restored.push_str(lookup);
                        restored.push_str(" / $data.fx_asset_quote.amount)");
                    }
                    cursor = end;
                }
                restored.push_str(&legacy_expression[cursor..]);
                *expression = restored;
            }
            Value::Array(items) => {
                for item in items {
                    restore_legacy_fx_formulas(item);
                }
            }
            Value::Object(fields) => {
                for item in fields.values_mut() {
                    restore_legacy_fx_formulas(item);
                }
            }
            _ => {}
        }
    }

    let market_path =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/market.json");
    let current: Value = serde_json::from_slice(&std::fs::read(market_path).unwrap()).unwrap();
    let mut legacy = current.clone();
    legacy["sources"]["fx_asset_quote"]["query"]["amount"] = json!({
        "expr":"$string($round($number($data.asset_tickers[symbol = ($state.asset & 'USDT')].lastPrice), 2))"
    });
    restore_legacy_fx_formulas(&mut legacy);

    let legacy_definition = parse_app_definition(&legacy.to_string()).unwrap();
    let current_definition = parse_app_definition(&current.to_string()).unwrap();
    let legacy_data = market_sample_data(Some(100.0), "100");
    let current_data = market_sample_data(None, "100");
    let no_status = BTreeMap::new();
    let legacy_values: BTreeMap<String, BindingValue> = CompiledApp::compile(&legacy_definition)
        .evaluate(&legacy_definition.state, &legacy_data, &no_status);
    let current_values: BTreeMap<String, BindingValue> = CompiledApp::compile(&current_definition)
        .evaluate(&current_definition.state, &current_data, &no_status);
    assert_eq!(legacy_values, current_values);
}

#[test]
fn market_currency_table_uses_full_subcent_asset_price() {
    use kaleidoscope_contract::{data::BindingValue, validate::parse_app_definition};
    use kaleidoscope_data::CompiledApp;
    use std::collections::BTreeMap;

    let market_path =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/market.json");
    let source: Value = serde_json::from_slice(&std::fs::read(market_path).unwrap()).unwrap();
    let definition = parse_app_definition(&source.to_string()).unwrap();
    let data = market_sample_data(None, "0.123");
    let no_status = BTreeMap::new();
    let values: BTreeMap<String, BindingValue> =
        CompiledApp::compile(&definition).evaluate(&definition.state, &data, &no_status);

    let rows = values
        .iter()
        .find_map(|(pointer, binding)| match binding {
            BindingValue::Ready {
                value: Value::Array(rows),
            } if pointer.ends_with("/rows")
                && rows
                    .iter()
                    .any(|row| row["key"] == "KRW" && row.get("asset_quote").is_some()) =>
            {
                Some(rows)
            }
            _ => None,
        })
        .expect("통화 표 행 식이 계산되어야 한다");
    let krw = rows
        .iter()
        .find(|row| row["key"] == "KRW")
        .expect("KRW 표 행이 있어야 한다");
    let asset_quote = krw["asset_quote"].as_f64().unwrap();

    assert!((asset_quote - 166.05).abs() < 1e-9);
}

#[tokio::test]
async fn preview_returns_evaluated_storage_choice_binding_values() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut definition = definition();
    definition["requires"] = json!({
        "blocks":6,
        "modules":{"connection":1,"files":1,"storage":2}
    });
    definition["storage"] = json!({"entries":[{
        "id":"model",
        "key":"settings/model",
        "kind":"json",
        "schema":{"type":"string"},
        "default":"argon",
        "label":"Model",
        "presentation":"settings",
        "choices":{"expr":"$data.cards"}
    }]});
    let mut preview_args = args(definition);
    preview_args.data = Some([("cards".into(), json!(["model-argon", "model-sol"]))].into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["values"].as_array().unwrap().iter().any(|item| {
        item["pointer"] == "/storage/entries/0/choices"
            && item["status"] == "ready"
            && item["value"] == r#"["model-argon","model-sol"]"#
    }));
}

#[tokio::test]
async fn preview_notes_missing_connection_even_when_request_source_uses_sample_data() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut preview_args = args(definition());
    preview_args.data = Some([("cards".into(), json!([{"status":"done"}]))].into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|note| { note.as_str().unwrap().contains("서버에 없는 연결: board") }));
}

#[tokio::test]
async fn preview_notes_missing_connection_used_only_by_action() {
    let server = McpServer::new(AppState::in_memory("secret"));
    let mut definition = definition();
    definition["permissions"][0]["access"] = json!("readwrite");
    definition["sources"] = json!({});
    definition["ui"] = json!({
        "type": "button",
        "label": "호출",
        "on_click": [{"call": {"permission": "relay", "method": "POST", "path": "/items"}}]
    });

    let value = result_value(server.preview_app_result(args(definition)).await.unwrap());

    assert!(value["notes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|note| { note.as_str().unwrap().contains("서버에 없는 연결: board") }));
}

#[tokio::test]
async fn preview_uses_the_reported_window_state() {
    let (url, server_task) = fake_origin(
        200,
        r#"[{"status":"running","title":"현재 항목"},{"status":"done","title":"완료 항목"}]"#,
    )
    .await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    state.lock_db().unwrap().execute(
        "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES('device','기기',(SELECT account_id FROM mcp_principal WHERE id=1),'hash','now')",
        [],
    ).unwrap();
    let layout: kaleidoscope_contract::registry::DeviceLayout = serde_json::from_value(json!({
        "workspaces": [{"id":"workspace","name":"작업","created_at":"now","updated_at":"now"}],
        "desktops": [{"id":"desktop","workspace_id":"workspace","name":"Desktop","position":0,"created_at":"now","updated_at":"now"}],
        "windows": [{"id":"window-1","desktop_id":"desktop","app_id":"preview-test","app_version":1,"rect":{"x":0,"y":0,"width":800,"height":600},"z":0,"state":{"filter":"running"},"created_at":"now","updated_at":"now"}],
        "folders": [], "active_workspace_id": null, "active_desktop_ids": {}
    })).unwrap();
    state
        .apply_layout_changes(
            None,
            &registry::LayoutChanges {
                workspaces: layout.workspaces.clone(),
                desktops: layout.desktops.clone(),
                windows: layout.windows.clone(),
                ..Default::default()
            },
        )
        .unwrap();
    state.save_layout("device", &layout).unwrap();
    let server = McpServer::new(state);
    let mut preview_args = args(definition());
    preview_args.window_id = Some("window-1".into());

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("현재 항목"));
    assert!(!value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("완료 항목"));
    server_task.abort();
}

#[tokio::test]
async fn preview_clips_each_binding_value_to_max_chars() {
    let (url, server_task) = fake_origin(200, r#"[{"title":"a long value"}]"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);
    let mut definition = definition();
    definition["ui"]["children"][0]["value"]["expr"] = json!("$data.cards");
    let mut preview_args = args(definition);
    preview_args.max_chars = Some(5);

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert_eq!(
        value["values"][0]["value"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        5
    );
    assert_eq!(value["values"][0]["truncated"], true);
    server_task.abort();
}

#[tokio::test]
async fn preview_reports_failed_source_and_binding_retry_for_non_2xx() {
    let (url, server_task) = fake_origin(500, r#"{"error":"temporarily unavailable"}"#).await;
    let state = AppState::in_memory("secret");
    add_relay(&state, &url);
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "failed");
    assert!(value["sources"]["cards"]["message"]
        .as_str()
        .unwrap()
        .contains("500"));
    assert_eq!(value["values"][0]["status"], "failed");
    assert_eq!(value["values"][0]["retry"], json!(["cards"]));
    server_task.abort();
}

#[tokio::test]
async fn preview_uses_the_current_registry_definition_by_app_id() {
    let state = AppState::in_memory("secret");
    let definition = definition();
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let server = McpServer::new(state);
    let preview_args = PreviewArgs {
        app_id: Some("preview-test".into()),
        definition: None,
        state: None,
        window_id: None,
        workspace_id: None,
        data: Some(
            [(
                "cards".into(),
                json!([{"status":"done","title":"저장된 앱"}]),
            )]
            .into(),
        ),
        max_chars: None,
    };

    let value = result_value(server.preview_app_result(preview_args).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "ready");
    assert!(value["values"][0]["value"]
        .as_str()
        .unwrap()
        .contains("저장된 앱"));
}

#[tokio::test]
async fn preview_does_not_fetch_oauth_sources_on_the_server() {
    let state = AppState::in_memory("secret");
    add_relay(&state, "https://example.invalid");
    state
        .lock_db()
        .unwrap()
        .execute("UPDATE connections SET kind='oauth' WHERE name='board'", [])
        .unwrap();
    let server = McpServer::new(state);

    let value = result_value(server.preview_app_result(args(definition())).await.unwrap());

    assert_eq!(value["sources"]["cards"]["state"], "idle");
    assert!(value["notes"].as_array().unwrap().iter().any(|note| {
        note.as_str()
            .unwrap()
            .contains("기기에서만 받는 원천: cards")
    }));
}

#[tokio::test]
async fn preview_reads_saved_storage_values_and_bucket_id() {
    let state = AppState::in_memory("secret");
    let mut definition = definition();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(1);
    definition["storage"] = json!({"entries":[{"id":"title","key":"settings/title","kind":"json","schema":{"type":"string"},"default":"default","label":"제목","presentation":"hidden"}]});
    definition["sources"] = json!({});
    definition["ui"] = json!({"type":"stack","direction":"column","children":[{"type":"text","value":{"expr":"$storage.title"}},{"type":"text","value":{"expr":"$storage_meta.bucket_id"}}]});
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let account = state.mcp_account_id().unwrap();
    state
        .write_app_storage(
            &account,
            "preview-test",
            "title",
            None,
            json!("저장됨"),
            None,
        )
        .unwrap();
    let bucket = state
        .list_app_storage(&account, "preview-test", None)
        .unwrap()
        .bucket_id;
    let server = McpServer::new(state);
    let mut input = args(definition);
    input.definition = None;
    input.app_id = Some("preview-test".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장됨\"");
    assert_eq!(value["values"][1]["value"], format!("\"{bucket}\""));
}

#[tokio::test]
async fn preview_uses_window_or_explicit_workspace_storage() {
    let state = AppState::in_memory("secret");
    let mut definition = definition();
    definition["requires"]["blocks"] = json!(6);
    definition["requires"]["modules"]["storage"] = json!(1);
    definition["storage"] = json!({"entries":[{"id":"selection","key":"workspaces/{workspace_id}/selection","kind":"json","schema":{"type":"string"},"default":"기본","label":"선택","presentation":"hidden"}]});
    definition["sources"] = json!({});
    definition["ui"] = json!({"type":"text","value":{"expr":"$storage.selection"}});
    state
        .publish_app(&definition.to_string(), "agent", false, None)
        .unwrap();
    let layout: kaleidoscope_contract::registry::LayoutChanges = serde_json::from_value(json!({
        "workspaces":[{"id":"w1","name":"작업","created_at":"now","updated_at":"now"}],
        "desktops":[{"id":"d1","workspace_id":"w1","name":"Desktop","position":0,"created_at":"now","updated_at":"now"}],
        "windows":[{"id":"win1","desktop_id":"d1","app_id":"preview-test","app_version":1,"rect":{"x":0,"y":0,"width":800,"height":600},"z":0,"state":{},"created_at":"now","updated_at":"now"}]
    })).unwrap();
    state.apply_layout_changes(None, &layout).unwrap();
    let account = state.mcp_account_id().unwrap();
    state
        .write_app_storage(
            &account,
            "preview-test",
            "selection",
            Some("w1"),
            json!("저장값"),
            None,
        )
        .unwrap();
    let server = McpServer::new(state);
    let mut input = args(definition.clone());
    input.workspace_id = Some("w1".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장값\"");
    let mut input = args(definition);
    input.window_id = Some("win1".into());
    let value = result_value(server.preview_app_result(input).await.unwrap());
    assert_eq!(value["values"][0]["value"], "\"저장값\"");
}

#[tokio::test]
async fn stored_environment_reference_is_not_sent_to_the_origin() {
    let state = AppState::in_memory("secret");
    add_relay(&state, "http://127.0.0.1:1");
    state
        .lock_db()
        .unwrap()
        .execute(
            "UPDATE connections SET headers=?1 WHERE name='board'",
            [r#"{"Authorization":"Bearer ${env:KEY}"}"#],
        )
        .unwrap();
    let request = ConnectionRequest {
        app_id: "test".into(),
        method: HttpMethod::Get,
        path: "/items".into(),
        query: Default::default(),
        body: None,
        accept: ConnectionAccept::Json,
    };
    let error = state
        .relay_preview_request("board", request, FileAccess::Read)
        .await
        .unwrap_err();
    assert_eq!(error.0, StatusCode::BAD_GATEWAY);
    assert!(error.1.message.contains("환경변수 참조"));
}

#[tokio::test]
async fn relay_preserves_403_rate_limit_without_retry_time() {
    let app = Router::new().fallback(any(|| async {
        (
            StatusCode::FORBIDDEN,
            [("x-ratelimit-remaining", "0")],
            "한도",
        )
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let state = AppState::in_memory("secret");
    add_relay(&state, &format!("http://{address}"));
    let request = ConnectionRequest {
        app_id: "test".into(),
        method: HttpMethod::Get,
        path: "/items".into(),
        query: Default::default(),
        body: None,
        accept: ConnectionAccept::Json,
    };
    let (reply, _) = state
        .relay_preview_request("board", request, FileAccess::Read)
        .await
        .unwrap();
    let wire = serde_json::to_vec(&reply).unwrap();
    let received: kaleidoscope_contract::registry::ConnectionReply =
        serde_json::from_slice(&wire).unwrap();
    assert_eq!(received.rate_limit.unwrap().retry_after_secs, None);
    server.abort();
}
