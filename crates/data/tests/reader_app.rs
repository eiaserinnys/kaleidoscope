use kaleidoscope_contract::{
    data::{walk_blocks, BindingValue, SourceStatus},
    migrate_window_state,
    validate::parse_app_definition,
    AppDefinition, Block, PermissionDecl,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::json;
use std::collections::BTreeMap;

const READER: &str = include_str!("../../../apps/reader.json");

fn reader() -> (AppDefinition, CompiledApp) {
    let definition = parse_app_definition(READER).expect("reader 앱 정의");
    let compiled = CompiledApp::compile(&definition);
    (definition, compiled)
}

#[test]
fn reader_is_hacker_news_only() {
    let (definition, _) = reader();

    let permission_ids = definition
        .permissions
        .iter()
        .map(|permission| match permission {
            PermissionDecl::Http { id, .. } => id.as_str(),
            other => panic!("예상하지 않은 권한: {other:?}"),
        })
        .collect::<Vec<_>>();
    assert_eq!(permission_ids, ["hn"]);
    assert_eq!(definition.sources.keys().map(String::as_str).collect::<Vec<_>>(), ["item", "stories"]);
    assert_eq!(
        definition.state.keys().map(String::as_str).collect::<Vec<_>>(),
        ["feed_kind", "query", "search_input", "selected_story"]
    );
    assert_eq!(definition.name, "해커뉴스");

    let mut types = Vec::new();
    let mut search_on_change = None;
    walk_blocks(&definition.ui, "/ui", &mut |_, block| {
        match block {
            Block::Tabs { .. } => types.push(true),
            Block::Metrics { .. } => panic!("요약 타일이 남아 있음"),
            Block::Input { on_change, .. } => {
                search_on_change = Some(serde_json::to_value(on_change).expect("검색 입력 동작"));
            }
            _ => {}
        }
    });
    assert!(types.is_empty());
    assert_eq!(
        search_on_change,
        Some(json!([
            {"set_state":"search_input"},
            {"set_state":"query","value":{"expr":"$event = '' ? '' : $state.query"}},
            {"set_state":"selected_story","value":{"expr":"$event = '' ? 'top' : $state.selected_story"}}
        ]))
    );
}

#[test]
fn reader_chains_story_selection_to_item() {
    let (definition, app) = reader();
    let mut state = definition.state.clone();
    state.insert("selected_story".into(), json!("123"));
    let story = json!({"objectID":"123","title":"Show HN: Rust tools for","author":"alice","points":42,"num_comments":12});
    let data = BTreeMap::from([("stories".into(), json!({"hits":[story]}))]);

    let SourcePlan::Request { path, query, .. } = app.plan_source("stories", &definition.state)
    else {
        panic!("stories 계획")
    };
    assert_eq!(path, "/api/v1/search");
    assert_eq!(query["tags"], "front_page");
    assert_eq!(query["hitsPerPage"], "30");

    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage(
        "item",
        &state,
        &data,
        &BTreeMap::new(),
        &BTreeMap::new(),
    ) else {
        panic!("item 계획")
    };
    assert_eq!(path, "/api/v1/items/123");
}

#[test]
fn reader_submitted_query_goes_to_stories() {
    let (definition, app) = reader();
    let mut state = definition.state.clone();
    state.insert("query".into(), json!("Rust"));

    let SourcePlan::Request { query, .. } = app.plan_source("stories", &state) else {
        panic!("stories 검색 계획")
    };
    assert_eq!(query["tags"], "story");
    assert_eq!(query["query"], "Rust");
}

#[test]
fn reader_evaluates_nested_discussion_bindings() {
    let (definition, app) = reader();
    let data = BTreeMap::from([
        (
            "stories".into(),
            json!({"hits":[{"objectID":"123","title":"Rust tools","author":"alice","created_at":"2026-10-31T11:52:00Z","points":42,"num_comments":2}]}),
        ),
        (
            "item".into(),
            json!({"author":"alice","text":"<p>소개 &amp; 본문</p><code>inline</code><pre><code>Vec&lt;T&gt;</code></pre>","children":[{"id":1,"author":"bob","created_at":"2026-10-31T10:00:00Z","text":"첫 댓글","children":[{"id":2,"author":"eve","created_at":"2026-10-31T10:05:00Z","text":"<p>깊은 답글</p>","children":[]}]}]}),
        ),
    ]);
    let empty = BTreeMap::new();
    let statuses = BTreeMap::<String, SourceStatus>::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );

    let BindingValue::Ready { value: feed } =
        &values["/ui/children/1/children/1/child/entries"]
    else {
        panic!("중첩 피드 식 결과")
    };
    assert_eq!(feed[0]["key"], "story-body");
    assert_eq!(feed[1]["children"][0]["key"], "2", "feed: {feed:#}");
    assert!(feed[0]["body"].as_str().unwrap().contains("소개 & 본문"));
    assert!(feed[0]["body"].as_str().unwrap().contains("Vec<T>"), "feed: {feed:#}");
    assert_eq!(feed[0]["name"], "본문");
    assert!(feed[0].get("meta").is_none());
    assert_eq!(feed[0]["badges"], json!([]));
    assert_eq!(feed[1]["meta"], "2026-10-31 10:00");
    assert_eq!(feed[1]["badges"], json!([]));

    let BindingValue::Ready { value: discussion_title } =
        &values["/ui/children/1/children/1/title"]
    else {
        panic!("토론 제목 식 결과")
    };
    assert_eq!(discussion_title, "Rust tools");
    let BindingValue::Ready { value: story_meta } =
        &values["/ui/children/1/children/1/meta"]
    else {
        panic!("이야기 메타 식 결과")
    };
    assert_eq!(story_meta.as_str(), Some("alice 2026-10-31 11:52"));
}

#[test]
fn reader_empty_search_leaves_section_header_blank() {
    let (definition, app) = reader();
    let mut state = definition.state.clone();
    state.insert("query".into(), json!("zzqqxxnoresultszz"));
    let data = BTreeMap::from([("stories".into(), json!({"hits":[]}))]);
    let empty = BTreeMap::new();
    let statuses = BTreeMap::<String, SourceStatus>::new();
    let values = app.evaluate_with_data_meta(
        &state,
        &data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );

    for pointer in ["/ui/children/1/children/1/title", "/ui/children/1/children/1/meta"] {
        let BindingValue::Ready { value } = &values[pointer] else {
            panic!("빈 검색 머리 바인딩 결과: {pointer}: {:?}", values[pointer]);
        };
        assert!(value.is_null(), "{pointer}: {value}");
    }
}

#[test]
fn reader_limits_roots_and_replies_while_including_depth_four() {
    let (definition, app) = reader();
    let html_body = format!("<p>{}</p>", "답글 &amp; 본문 ".repeat(20));
    let entity_body = format!("{} &amp; 본문", "답글 ".repeat(20));
    let plain_body = "답글 본문 ".repeat(20);
    let body_for = |index: usize| match index % 5 {
        0 | 1 => html_body.as_str(),
        2 => entity_body.as_str(),
        _ => plain_body.as_str(),
    };
    let depth4 = json!({"id":"depth-4","author":"d4","text":body_for(4),"children":[]});
    let depth3 = json!({"id":"depth-3","author":"d3","text":body_for(3),"children":[depth4]});
    let depth2 = json!({"id":"depth-2","author":"d2","text":body_for(2),"children":[depth3]});
    let mut depth1_children = vec![depth2];
    depth1_children.extend((0..8).map(|i| {
        json!({"id":format!("d1-{i}"),"author":"d1","text":body_for(i),"children":[]})
    }));
    let depth1 = json!({"id":"depth-1","author":"d1","text":body_for(1),"children":depth1_children});
    let mut root_children = vec![depth1];
    root_children.extend((0..8).map(|i| {
        json!({"id":format!("root-child-{i}"),"author":"child","text":body_for(i),"children":[]})
    }));
    let mut roots = vec![json!({"id":"root-0","author":"root","text":body_for(0),"children":root_children})];
    roots.extend((1..30).map(|i| {
        let children = (0..8)
            .map(|j| json!({"id":format!("root-{i}-child-{j}"),"author":"child","text":body_for(i+j),"children":[]}))
            .collect::<Vec<_>>();
        json!({"id":format!("root-{i}"),"author":"root","text":body_for(i),"children":children})
    }));
    let data = BTreeMap::from([
        ("stories".into(), json!({"hits":[{"objectID":"1","title":"Story","author":"alice","num_comments":30}]})),
        ("item".into(), json!({"children":roots})),
    ]);
    let empty = BTreeMap::new();
    let statuses = BTreeMap::<String, SourceStatus>::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );
    let BindingValue::Ready { value: feed } =
        &values["/ui/children/1/children/1/child/entries"]
    else {
        panic!("중첩 댓글 제한 결과")
    };
    assert_eq!(feed.as_array().unwrap().len(), 25);
    assert_eq!(feed[0]["key"], "root-0");
    assert_eq!(feed[0]["children"].as_array().unwrap().len(), 8);
    assert_eq!(feed[0]["badges"], json!([]));
    assert_eq!(feed[1]["children"].as_array().unwrap().len(), 8);
    assert!(feed[0]["body"].as_str().unwrap().contains("답글 & 본문"));
    assert_eq!(
        feed[0]["children"][0]["children"][0]["children"][0]["children"][0]["key"],
        "depth-4"
    );
}

#[test]
fn reader_window_from_v2_keeps_feed_and_selection() {
    let (definition, _) = reader();
    let old = BTreeMap::from([
        ("feed_kind".into(), json!("show_hn")),
        ("search_input".into(), json!("Rust")),
        ("query".into(), json!("Rust systems")),
        ("selected_story".into(), json!("123")),
        ("active_tab".into(), json!(2)),
        ("selected_repo".into(), json!("5")),
        ("selected_paper".into(), json!("1")),
    ]);
    let migrated = migrate_window_state(&definition, &old);

    assert_eq!(migrated["feed_kind"], "show_hn");
    assert_eq!(migrated["search_input"], "Rust");
    assert_eq!(migrated["query"], "Rust systems");
    assert_eq!(migrated["selected_story"], "123");
    assert!(!migrated.contains_key("active_tab"));
    assert!(!migrated.contains_key("selected_repo"));
    assert!(!migrated.contains_key("selected_paper"));
}
