use kaleidoscope_contract::{
    data::{BindingValue, SourceStatus},
    validate::parse_app_definition,
};
use kaleidoscope_data::{CompiledApp, SourcePlan};
use serde_json::json;
use std::collections::BTreeMap;

const READER: &str = include_str!("../../../apps/reader.json");

fn reader() -> (kaleidoscope_contract::AppDefinition, CompiledApp) {
    let definition = parse_app_definition(READER).expect("reader 앱 정의");
    assert_eq!(definition.state["active_tab"], json!(0));
    assert_eq!(definition.state["selected_repo"], json!("top"));
    assert_eq!(definition.state["selected_paper"], json!("0"));
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
    state.insert("active_tab".into(), json!(1));
    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage(
        "github_repo",
        &state,
        &data,
        &BTreeMap::new(),
        &BTreeMap::new(),
    ) else {
        panic!("저장소 계획")
    };
    assert_eq!(path, "/repos/acme/rust-tools");
    let mut trailing_repo = story.clone();
    trailing_repo["url"] = json!("https://github.com/acme/rust-tools/tree/main/");
    let trailing_data = BTreeMap::from([("stories".into(), json!({"hits":[trailing_repo]}))]);
    let SourcePlan::Request { path, .. } = app.plan_source_with_data_and_storage(
        "github_repo",
        &state,
        &trailing_data,
        &BTreeMap::new(),
        &BTreeMap::new(),
    ) else {
        panic!("저장소 하위 경로 계획")
    };
    assert_eq!(path, "/repos/acme/rust-tools");
    for source in [
        "github_search",
        "wiki_en_search",
        "wiki_ko_search",
        "papers",
    ] {
        state.insert(
            "active_tab".into(),
            json!(if source == "github_search" { 1 } else { 2 }),
        );
        let SourcePlan::Request { query, .. } = app.plan_source_with_data_and_storage(
            source,
            &state,
            &data,
            &BTreeMap::new(),
            &BTreeMap::new(),
        ) else {
            panic!("{source} 계획")
        };
        assert_eq!(
            query
                .get("q")
                .or(query.get("srsearch"))
                .or(query.get("search"))
                .unwrap(),
            "Rust tools"
        );
    }

    let mut external_story = story;
    external_story["url"] = json!("https://example.org/notes");
    let other_data = BTreeMap::from([("stories".into(), json!({"hits":[external_story]}))]);
    assert_eq!(
        app.plan_source_with_data_and_storage(
            "github_repo",
            &state,
            &other_data,
            &BTreeMap::new(),
            &BTreeMap::new()
        ),
        SourcePlan::Idle
    );

    let wiki_data = BTreeMap::from([
        (
            "wiki_en_search".into(),
            json!({"query":{"search":[{"title":"Rust","snippet":"iron oxide"},{"title":"Rust programming language","snippet":"software"}]}}),
        ),
        (
            "wiki_ko_search".into(),
            json!({"query":{"search":[{"title":"러스트 프로그래밍 언어"}]}}),
        ),
    ]);
    state.insert("active_tab".into(), json!(2));
    let SourcePlan::Request { path, query, .. } = app.plan_source_with_data_and_storage(
        "wiki_en_summary",
        &state,
        &wiki_data,
        &BTreeMap::new(),
        &BTreeMap::new(),
    ) else {
        panic!("영어 위키 요약 계획")
    };
    assert_eq!(path, "/api/rest_v1/page/summary/Rust_programming_language");
    assert_eq!(query["redirect"], "false");
    let SourcePlan::Request { path, query, .. } = app.plan_source_with_data_and_storage(
        "wiki_ko_summary",
        &state,
        &wiki_data,
        &BTreeMap::new(),
        &BTreeMap::new(),
    ) else {
        panic!("한국어 위키 요약 계획")
    };
    assert_eq!(
        path,
        "/api/rest_v1/page/summary/러스트_프로그래밍_언어"
    );
    assert_eq!(query["redirect"], "false");
}

#[test]
fn reader_prefers_submitted_query_for_related_sources() {
    let (definition, app) = reader();
    let mut state = definition.state.clone();
    state.insert("query".into(), json!("  Rust  "));
    state.insert("selected_story".into(), json!("123"));
    let data = BTreeMap::from([(
        "stories".into(),
        json!({"hits":[{"objectID":"123","title":"Why Discord is switching from Go to Rust"}]}),
    )]);

    for (source, key) in [
        ("github_search", "q"),
        ("wiki_en_search", "srsearch"),
        ("wiki_ko_search", "srsearch"),
        ("papers", "search"),
    ] {
        state.insert(
            "active_tab".into(),
            json!(if source == "github_search" { 1 } else { 2 }),
        );
        let SourcePlan::Request { query, .. } = app.plan_source_with_data_and_storage(
            source,
            &state,
            &data,
            &BTreeMap::new(),
            &BTreeMap::new(),
        ) else {
            panic!("{source} 계획")
        };
        assert_eq!(query[key], "Rust");
    }
}

#[test]
fn reader_evaluates_nested_discussion_and_all_tab_bindings() {
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
        (
            "github_repo".into(),
            json!({"id":10,"full_name":"acme/rust-tools","description":"도구","language":"Rust","stargazers_count":100,"forks_count":8,"open_issues_count":3,"topics":["rust"],"pushed_at":"2026-10-31T00:00:00Z","license":{"spdx_id":"MIT"}}),
        ),
        (
            "github_search".into(),
            json!({"items":[{"id":10,"full_name":"acme/rust-tools","description":"도구","language":"Rust","stargazers_count":100,"forks_count":8,"open_issues_count":3},{"id":20,"full_name":"other/project","description":"다른 저장소","language":"Go","stargazers_count":50,"forks_count":2,"open_issues_count":1,"pushed_at":"2026-10-30T10:30:00Z"}]}),
        ),
        (
            "wiki_en_search".into(),
            json!({"query":{"search":[{"pageid":1,"title":"Rust","snippet":"<span>Programming</span> language"}]}}),
        ),
        (
            "wiki_ko_search".into(),
            json!({"query":{"search":[{"pageid":2,"title":"러스트","snippet":"프로그래밍 언어"}]}}),
        ),
        (
            "wiki_en_summary".into(),
            json!({"title":"Rust","description":"Programming language","extract":"A language."}),
        ),
        (
            "wiki_ko_summary".into(),
            json!({"title":"러스트","extract":"언어."}),
        ),
        (
            "papers".into(),
            json!({"results":[{"title":"A paper","publication_year":2025,"cited_by_count":9,"authorships":[{"author":{"display_name":"Alice"}},{"author":{"display_name":"Bob"}}],"open_access":{"is_oa":true},"primary_location":{"source":{"display_name":"Journal"}}},{"title":"Another paper","publication_year":2024,"cited_by_count":3,"authorships":[{"author":{"display_name":"Eve"}}],"open_access":{"is_oa":false},"primary_location":{"source":{"display_name":"Other journal"}}}]}),
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
    for (pointer, value) in &values {
        assert!(
            matches!(value, BindingValue::Ready { .. }),
            "{pointer}: {value:?}"
        );
    }
    let feed_pointer = "/ui/children/2/children/1/tabs/0/child/child/entries";
    let BindingValue::Ready { value: feed } = &values[feed_pointer] else {
        panic!("중첩 피드 식 결과")
    };
    assert_eq!(feed[0]["key"], "story-body");
    assert_eq!(feed[1]["children"][0]["key"], "2", "feed: {feed:#}");
    assert!(feed[0]["body"].as_str().unwrap().contains("소개 & 본문"));
    assert!(
        feed[0]["body"].as_str().unwrap().contains("Vec<T>"),
        "feed: {feed:#}"
    );

    let BindingValue::Ready {
        value: discussion_title,
    } = &values["/ui/children/2/children/1/tabs/0/child/title"]
    else {
        panic!("토론 제목 식 결과")
    };
    assert_eq!(discussion_title, "Rust tools");
    let BindingValue::Ready { value: story_meta } =
        &values["/ui/children/2/children/1/tabs/0/child/meta"]
    else {
        panic!("이야기 메타 식 결과")
    };
    let story_meta = story_meta.as_str().unwrap();
    assert!(story_meta.contains("alice"));
    assert_eq!(story_meta, "alice · 2026-10-31 11:52");
    assert_eq!(feed[1]["meta"], "2026-10-31 10:00");
    assert_eq!(feed[1]["badges"], json!([]));

    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/items"] else {
        panic!("지표 식 결과")
    };
    assert_eq!(metrics[0]["value"].as_f64(), Some(42.0));
    assert_eq!(metrics[1]["value"].as_f64(), Some(1.0));
    assert_eq!(metrics[1]["subtext"], "전체 댓글 2개");
    assert_eq!(metrics[1]["unit"], "개");
    assert_eq!(metrics[2]["badge"], "Rust");
    assert!(metrics[2]["subtext"].as_str().unwrap().contains("포크 8"));
    assert!(metrics[3]["subtext"]
        .as_str()
        .unwrap()
        .contains("최고 인용 9"));
    let BindingValue::Ready { value: repos } =
        &values["/ui/children/2/children/1/tabs/1/child/children/0/child/rows"]
    else {
        panic!("저장소 표 식 결과")
    };
    assert_eq!(repos[0]["stars"].as_f64(), Some(100.0));
    assert_eq!(repos[0]["key"], "top");
    assert_eq!(repos[1]["repo_id"], "20");
    let BindingValue::Ready {
        value: related_titles,
    } = &values["/ui/children/2/children/1/tabs/2/child/children/1/child/fields/3/value"]
    else {
        panic!("위키 연관 항목 식 결과")
    };
    assert!(related_titles.as_str().unwrap().contains("Rust"));
    let BindingValue::Ready { value: papers } =
        &values["/ui/children/2/children/1/tabs/2/child/children/0/child/rows"]
    else {
        panic!("논문 표 식 결과")
    };
    assert_eq!(papers[0]["title"], "A paper");
    assert_eq!(papers[0]["venue"], "Alice, Bob · Journal");
    assert_eq!(papers[0]["oa"], "OA");

    let mut selected = definition.state.clone();
    selected.insert("selected_repo".into(), json!("20"));
    selected.insert("selected_paper".into(), json!("1"));
    let selected_values =
        app.evaluate_with_data_meta(&selected, &data, &empty, &empty, &empty, &statuses, None);
    for (pointer, expected) in [
        (
            "/ui/children/2/children/1/tabs/1/child/children/1/child/fields/0/value",
            "other/project",
        ),
        (
            "/ui/children/2/children/1/tabs/1/child/children/1/child/fields/6/value",
            "2026-10-30 10:30",
        ),
        (
            "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/0/value",
            "Another paper",
        ),
    ] {
        let BindingValue::Ready { value } = &selected_values[pointer] else {
            panic!("선택 상세 식 결과: {pointer}");
        };
        assert!(
            value.as_str().unwrap().contains(expected),
            "{pointer}: {value}"
        );
    }
    let no_related_data = BTreeMap::from([("stories".into(), data["stories"].clone())]);
    let empty_values = app.evaluate_with_data_meta(
        &definition.state,
        &no_related_data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );
    let BindingValue::Ready {
        value: empty_metrics,
    } = &empty_values["/ui/children/1/items"]
    else {
        panic!("빈 지표 식 결과");
    };
    assert_eq!(empty_metrics[2]["value"], "—");
    assert!(empty_metrics[2]["unit"].is_null());
    assert!(empty_metrics[2]["badge"].is_null());
    assert_eq!(empty_metrics[3]["value"], "—");
    assert!(empty_metrics[3]["unit"].is_null());
    assert!(empty_metrics[3]["badge"].is_null());
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
    depth1_children.extend(
        (0..8).map(
            |i| json!({"id":format!("d1-{i}"),"author":"d1","text":body_for(i),"children":[]}),
        ),
    );
    let depth1 =
        json!({"id":"depth-1","author":"d1","text":body_for(1),"children":depth1_children});
    let mut root_children = vec![depth1];
    root_children.extend((0..8).map(|i| {
        json!({"id":format!("root-child-{i}"),"author":"child","text":body_for(i),"children":[]})
    }));
    let mut roots =
        vec![json!({"id":"root-0","author":"root","text":body_for(0),"children":root_children})];
    roots.extend((1..30).map(|i| {
        let children = (0..8)
            .map(|j| json!({"id":format!("root-{i}-child-{j}"),"author":"child","text":body_for(i+j),"children":[]}))
            .collect::<Vec<_>>();
        json!({"id":format!("root-{i}"),"author":"root","text":body_for(i),"children":children})
    }));
    let data = BTreeMap::from([
        (
            "stories".into(),
            json!({"hits":[{"objectID":"1","title":"Story","author":"alice","num_comments":30}]}),
        ),
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
    let pointer = "/ui/children/2/children/1/tabs/0/child/child/entries";
    let BindingValue::Ready { value: feed } = &values[pointer] else {
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
fn reader_requests_only_the_active_tab_sources() {
    let (definition, app) = reader();
    let story =
        json!({"objectID":"123","title":"Rust tools","url":"https://github.com/acme/rust-tools"});
    let mut data = BTreeMap::from([("stories".into(), json!({"hits":[story]}))]);
    let tab_sources = [
        "github_repo",
        "github_search",
        "wiki_en_search",
        "wiki_ko_search",
        "papers",
        "wiki_en_summary",
        "wiki_ko_summary",
    ];
    let plan = |name: &str, tab: i64, data: &BTreeMap<String, serde_json::Value>| {
        let mut state = definition.state.clone();
        state.insert("active_tab".into(), json!(tab));
        app.plan_source_with_data_and_storage(
            name,
            &state,
            data,
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
    };

    for name in ["stories", "item"] {
        assert!(
            matches!(plan(name, 0, &data), SourcePlan::Request { .. }),
            "{name}"
        );
    }
    for name in tab_sources {
        assert_eq!(plan(name, 0, &data), SourcePlan::Idle, "tab 0: {name}");
    }

    for name in ["github_repo", "github_search"] {
        assert!(
            matches!(plan(name, 1, &data), SourcePlan::Request { .. }),
            "{name}: {:?}",
            plan(name, 1, &data)
        );
    }
    for name in [
        "wiki_en_search",
        "wiki_ko_search",
        "papers",
        "wiki_en_summary",
        "wiki_ko_summary",
    ] {
        assert_eq!(plan(name, 1, &data), SourcePlan::Idle, "tab 1: {name}");
    }

    data.insert(
        "wiki_en_search".into(),
        json!({"query":{"search":[{"title":"Rust"}]}}),
    );
    data.insert(
        "wiki_ko_search".into(),
        json!({"query":{"search":[{"title":"러스트"}]}}),
    );
    for name in ["wiki_en_search", "wiki_ko_search", "papers"] {
        assert!(
            matches!(plan(name, 2, &data), SourcePlan::Request { .. }),
            "{name}"
        );
    }
    for name in ["wiki_en_summary", "wiki_ko_summary"] {
        assert!(
            matches!(plan(name, 2, &data), SourcePlan::Request { .. }),
            "{name}"
        );
    }
    for name in ["github_repo", "github_search"] {
        assert_eq!(plan(name, 2, &data), SourcePlan::Idle, "tab 2: {name}");
    }
}

#[test]
fn reader_metrics_remain_ready_when_optional_sources_fail() {
    let (definition, app) = reader();
    let data = BTreeMap::from([(
        "stories".into(),
        json!({"hits":[{"objectID":"123","title":"Rust","url":"https://github.com/acme/rust-tools","points":10}]}),
    )]);
    let statuses = BTreeMap::from([
        (
            "github_search".into(),
            SourceStatus::Failed {
                message: "GitHub 제한".into(),
                has_value: false,
            },
        ),
        (
            "papers".into(),
            SourceStatus::Failed {
                message: "논문 검색 실패".into(),
                has_value: false,
            },
        ),
    ]);
    let empty = BTreeMap::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );
    let BindingValue::Ready { value: metrics } = &values["/ui/children/1/items"] else {
        panic!("지표 식 결과");
    };
    assert_eq!(metrics[2]["subtext"], json!("acme/rust-tools"));
    assert_eq!(metrics[3]["subtext"], json!("Rust"));
}

#[test]
fn reader_tab_details_fall_back_to_search_results_when_detail_sources_fail() {
    let (definition, app) = reader();
    let data = BTreeMap::from([
        (
            "github_search".into(),
            json!({"items":[{"id":10,"full_name":"acme/rust-tools","language":"Rust","stargazers_count":100,"forks_count":8}]}),
        ),
        (
            "wiki_en_search".into(),
            json!({"query":{"search":[{"title":"Rust","snippet":"<span>Programming</span> language"}]}}),
        ),
        (
            "wiki_ko_search".into(),
            json!({"query":{"search":[{"title":"러스트","snippet":"<b>프로그래밍</b> 언어"}]}}),
        ),
    ]);
    let statuses = BTreeMap::from([
        (
            "github_repo".into(),
            SourceStatus::Failed {
                message: "저장소 404".into(),
                has_value: false,
            },
        ),
        (
            "wiki_en_summary".into(),
            SourceStatus::Failed {
                message: "영어 요약 실패".into(),
                has_value: false,
            },
        ),
        (
            "wiki_ko_summary".into(),
            SourceStatus::Failed {
                message: "한국어 요약 실패".into(),
                has_value: false,
            },
        ),
    ]);
    let empty = BTreeMap::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );

    for (pointer, expected) in [
        (
            "/ui/children/2/children/1/tabs/1/child/children/0/child/rows",
            "acme/rust-tools",
        ),
        (
            "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/1/value",
            "Programming language",
        ),
        (
            "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/2/value",
            "프로그래밍 언어",
        ),
    ] {
        let BindingValue::Ready { value } = &values[pointer] else {
            panic!("검색 결과 폴백 바인딩: {pointer}: {:?}", values[pointer]);
        };
        assert!(value.to_string().contains(expected), "{pointer}: {value}");
    }
}

#[test]
fn reader_empty_tab_properties_hide_null_values_and_empty_description() {
    let (definition, app) = reader();
    let empty_data = BTreeMap::from([
        (
            "stories".into(),
            json!({"hits":[{"objectID":"123","title":"Rust"}]}),
        ),
        ("item".into(), json!({"children":[]})),
        ("github_search".into(), json!({"items":[]})),
        ("wiki_en_search".into(), json!({"query":{"search":[]}})),
        ("wiki_ko_search".into(), json!({"query":{"search":[]}})),
        ("papers".into(), json!({"results":[]})),
    ]);
    let empty = BTreeMap::new();
    let statuses = BTreeMap::new();
    let values = app.evaluate_with_data_meta(
        &definition.state,
        &empty_data,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );

    for pointer in [
        "/ui/children/2/children/1/tabs/1/child/children/1/child/fields/3/value",
        "/ui/children/2/children/1/tabs/1/child/children/1/child/fields/4/value",
        "/ui/children/2/children/1/tabs/1/child/children/1/child/fields/6/value",
        "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/0/value",
        "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/1/value",
        "/ui/children/2/children/1/tabs/2/child/children/1/child/fields/2/value",
    ] {
        let BindingValue::Ready { value } = &values[pointer] else {
            panic!("빈 상세 필드 바인딩: {pointer}: {:?}", values[pointer]);
        };
        assert_eq!(value, &serde_json::Value::Null, "{pointer}");
    }

    let mut described = empty_data;
    described.insert(
        "wiki_en_summary".into(),
        json!({"title":"History of YouTube","description":"","extract":"A short history."}),
    );
    let described_values = app.evaluate_with_data_meta(
        &definition.state,
        &described,
        &empty,
        &empty,
        &empty,
        &statuses,
        None,
    );
    let BindingValue::Ready { value } =
        &described_values["/ui/children/2/children/1/tabs/2/child/children/1/child/fields/1/value"]
    else {
        panic!("영어 위키 설명 바인딩")
    };
    assert_eq!(value.as_str(), Some("History of YouTube\nA short history."));
    assert!(!value.as_str().unwrap().contains(" · "));
}
