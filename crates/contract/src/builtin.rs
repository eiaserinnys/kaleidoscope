//! 쉘에 포함되는 기본 앱과 자산의 식별 및 호환 정보.

pub struct BuiltinIdentity {
    pub id: &'static str,
    pub name: &'static str,
    pub version: u32,
    pub updated_at: &'static str,
    pub blocks: u32,
    pub modules: &'static [(&'static str, u32)],
    pub assets: &'static [(&'static str, u32)],
}

pub const BUNDLED_ASSET_KEYS: &[(&str, u32)] = &[
    ("builtin-weather-clear", 1),
    ("builtin-weather-partly-cloudy", 1),
    ("builtin-weather-cloudy", 1),
    ("builtin-weather-fog", 1),
    ("builtin-weather-rain", 1),
    ("builtin-weather-showers", 1),
    ("builtin-weather-snow", 1),
    ("builtin-weather-thunderstorm", 1),
];

pub const BUILTIN_IDENTITIES: &[BuiltinIdentity] = &[
    BuiltinIdentity {
        id: "profiler",
        name: "프로파일러",
        version: 1,
        updated_at: "2026-11-01T00:00:00Z",
        blocks: 9,
        modules: &[("profiler", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "agent",
        name: "에이전트",
        version: 3,
        updated_at: "2026-10-30T00:00:00Z",
        blocks: 8,
        modules: &[
            ("files", 1),
            ("local_agent", 1),
            ("storage", 1),
            ("worker", 1),
        ],
        assets: &[],
    },
    BuiltinIdentity {
        id: "slackbot",
        name: "슬랙봇",
        version: 2,
        updated_at: "2026-11-02T00:00:00Z",
        blocks: 9,
        modules: &[("storage", 2), ("worker", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "explorer",
        name: "탐색기",
        version: 3,
        updated_at: "2026-10-30T00:00:00Z",
        blocks: 5,
        modules: &[("files", 2)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "md-editor",
        name: "마크다운 편집기",
        version: 3,
        updated_at: "2026-10-30T00:00:00Z",
        blocks: 3,
        modules: &[("files", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "html-report",
        name: "시안과 리포트",
        version: 1,
        updated_at: "2026-10-31T00:00:00Z",
        blocks: 10,
        modules: &[("storage", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "web-browser",
        name: "웹 브라우저",
        version: 1,
        updated_at: "2026-10-30T00:00:00Z",
        blocks: 3,
        modules: &[("web", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "calculator",
        name: "계산기",
        version: 2,
        updated_at: "2026-10-31T00:00:00Z",
        blocks: 9,
        modules: &[],
        assets: &[],
    },
    BuiltinIdentity {
        id: "weather",
        name: "날씨",
        version: 1,
        updated_at: "2026-10-31T00:00:00Z",
        blocks: 9,
        modules: &[("assets", 1), ("http", 1)],
        assets: BUNDLED_ASSET_KEYS,
    },
    BuiltinIdentity {
        id: "market",
        name: "시세와 환율",
        version: 2,
        updated_at: "2026-11-02T00:00:00Z",
        blocks: 9,
        modules: &[("http", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "earth",
        name: "지구 상황판",
        version: 2,
        updated_at: "2026-11-02T00:00:00Z",
        blocks: 10,
        modules: &[("http", 1)],
        assets: &[],
    },
    BuiltinIdentity {
        id: "reader",
        name: "해커뉴스와 위키",
        version: 2,
        updated_at: "2026-11-01T00:00:00Z",
        blocks: 10,
        modules: &[("http", 1)],
        assets: &[],
    },
];

pub fn builtin_identity(id: &str) -> Option<&'static BuiltinIdentity> {
    BUILTIN_IDENTITIES.iter().find(|app| app.id == id)
}
pub fn is_builtin(id: &str) -> bool {
    builtin_identity(id).is_some()
}
pub fn is_bundled_asset(id: &str, version: u32) -> bool {
    BUNDLED_ASSET_KEYS.contains(&(id, version))
}
