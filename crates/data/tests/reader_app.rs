use kaleidoscope_contract::{data::{BindingValue, SourceStatus}, validate::parse_app_definition};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::json;
use std::collections::BTreeMap;

const READER: &str = include_str!("../../../apps/reader.json");

fn reader() -> (kaleidoscope_contract::AppDefinition, CompiledApp) {
    let definition = parse_app_definition(READER).expect("reader 앱 정의");
    let compiled = CompiledApp::compile(&definition);
    (definition, compiled)
}

#[test]
fn reader_chains_story_selection_to_hn_github_wikipedia_and_openalex() {
    let (definition, app) = reader();
    let mut state = definition.state.clone();
    state.insert("selected_story".into(), json!("123"));
    let story = json!({"objectID":"123","title":"Show HN: Rust tools for","url":"https://github.com/acme/rust-tools","author":"alice","points":42,"num_comments":12});
    let data = BTreeMap::from([("stories".into(), json!({"hits":[story]}))]);

    let SourcePlan::Request { path, query, .. } = app.plan_source("stories", &definition.state) else { panic!("stories 계획") };
    assert_eq!(path, "/api/v1/search");
    assert_eq!(query["tags"], "front_page");
    assert_eq!(query["hitsPerPage"], "30");
    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage("item", &state, &data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("item 계획") };
    assert_eq!(path, "/api/v1/items/123");
    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage("github_repo", &state, &data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("저장소 계획") };
    assert_eq!(path, "/repos/acme/rust-tools");
    let mut trailing_repo = story.clone();
    trailing_repo["url"] = json!("https://github.com/acme/rust-tools/tree/main/");
    let trailing_data = BTreeMap::from([("stories".into(), json!({"hits":[trailing_repo]}))]);
    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage("github_repo", &state, &trailing_data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("저장소 하위 경로 계획") };
    assert_eq!(path, "/repos/acme/rust-tools");
    for source in ["github_search", "wiki_en_search", "wiki_ko_search", "papers"] {
        let SourcePlan::Request { query, .. } = app.plan_source_with_data_and_storage(source, &state, &data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("{source} 계획") };
        assert_eq!(query.get("q").or(query.get("srsearch")).or(query.get("search")).unwrap(), "Rust tools");
    }

    let mut external_story = story;
    external_story["url"] = json!("https://example.org/notes");
    let other_data = BTreeMap::from([("stories".into(), json!({"hits":[external_story]}))]);
    assert_eq!(app.plan_source_with_data_and_storage("github_repo", &state, &other_data, &BTreeMap::new(), &BTreeMap::new()), SourcePlan::Idle);

    let wiki_data = BTreeMap::from([
        ("wiki_en_search".into(), json!({"query":{"search":[{"title":"Rust programming language"}]}})),
        ("wiki_ko_search".into(), json!({"query":{"search":[{"title":"러스트 프로그래밍 언어"}]}})),
    ]);
    let SourcePlan::Request { path, query, .. } = app.plan_source_with_data_and_storage("wiki_en_summary", &state, &wiki_data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("영어 위키 요약 계획") };
    assert_eq!(path, "/api/rest_v1/page/summary/Rust_programming_language");
    assert_eq!(query["redirect"], "false");
    let SourcePlan::Request { path, query, .. } = app.plan_source_with_data_and_storage("wiki_ko_summary", &state, &wiki_data, &BTreeMap::new(), &BTreeMap::new()) else { panic!("한국어 위키 요약 계획") };
    assert_eq!(path, "/api/rest_v1/page/summary/러스트_프로그래밍_언어");
    assert_eq!(query["redirect"], "false");
}

#[test]
fn reader_evaluates_nested_discussion_and_all_tab_bindings() {
    let (definition, app) = reader();
    let data = BTreeMap::from([
        ("stories".into(), json!({"hits":[{"objectID":"123","title":"Rust tools","url":"https://github.com/acme/rust-tools","author":"alice","points":42,"num_comments":2}]})),
        ("item".into(), json!({"author":"alice","text":"<p>소개 &amp; 본문</p>","children":[{"id":1,"author":"bob","created_at":"2026-10-31T10:00:00Z","text":"첫 댓글","children":[{"id":2,"author":"eve","created_at":"2026-10-31T10:05:00Z","text":"<p>깊은 답글</p>","children":[]}]}]})),
        ("github_repo".into(), json!({"full_name":"acme/rust-tools","description":"도구","language":"Rust","stargazers_count":100,"forks_count":8,"open_issues_count":3,"topics":["rust"],"pushed_at":"2026-10-31T00:00:00Z","license":{"spdx_id":"MIT"}})),
        ("github_search".into(), json!({"items":[{"id":10,"full_name":"acme/rust-tools","description":"도구","language":"Rust","stargazers_count":100,"forks_count":8,"open_issues_count":3}]})),
        ("wiki_en_search".into(), json!({"query":{"search":[{"pageid":1,"title":"Rust","snippet":"<span>Programming</span> language"}]}})),
        ("wiki_ko_search".into(), json!({"query":{"search":[{"pageid":2,"title":"러스트","snippet":"프로그래밍 언어"}]}})),
        ("wiki_en_summary".into(), json!({"title":"Rust","description":"Programming language","extract":"A language."})),
        ("wiki_ko_summary".into(), json!({"title":"러스트","extract":"언어."})),
        ("papers".into(), json!({"results":[{"title":"A paper","publication_year":2025,"cited_by_count":9,"open_access":{"is_oa":true},"primary_location":{"source":{"display_name":"Journal"}}}]})),
    ]);
    let empty = BTreeMap::new();
    let statuses = BTreeMap::<String, SourceStatus>::new();
    let values = app.evaluate_with_data_meta(&definition.state, &data, &empty, &empty, &empty, &statuses, None);
    for (pointer, value) in &values {
        assert!(matches!(value, BindingValue::Ready { .. }), "{pointer}: {value:?}");
    }
    let feed_pointer = "/ui/children/2/children/1/tabs/0/child/children/1/entries";
    let BindingValue::Ready { value: feed } = &values[feed_pointer] else { panic!("중첩 피드 식 결과") };
    assert_eq!(feed[0]["key"], "story-body");
    assert_eq!(feed[1]["children"][0]["key"], "2", "feed: {feed:#}");
    assert!(feed[0]["body"].as_str().unwrap().contains("소개 & 본문"));

    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/items"] else { panic!("지표 식 결과") };
    assert_eq!(metrics[0]["value"].as_f64(), Some(42.0));
    assert_eq!(metrics[1]["value"].as_f64(), Some(1.0));
    assert_eq!(metrics[1]["subtext"], "전체 답글 2개");
    let BindingValue::Ready { value: repos } = &values["/ui/children/2/children/1/tabs/1/child/children/1/rows"] else { panic!("저장소 표 식 결과") };
    assert_eq!(repos[0]["stars"].as_f64(), Some(100.0));
    let BindingValue::Ready { value: wiki } = &values["/ui/children/2/children/1/tabs/2/child/children/1/items"] else { panic!("위키 목록 식 결과") };
    assert_eq!(wiki[0]["title"], "Rust");
    let BindingValue::Ready { value: papers } = &values["/ui/children/2/children/1/tabs/2/child/children/2/rows"] else { panic!("논문 표 식 결과") };
    assert_eq!(papers[0]["title"], "A paper");
    assert_eq!(papers[0]["oa"], "OA");
}
