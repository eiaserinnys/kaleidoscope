//! 쉘에 포함되는 기본 앱과 자산의 식별 및 호환 정보.

use crate::assets::AssetFormat;

pub struct BuiltinIdentity {
    /// 기본 메시지 수신 앱의 초기 후보인지 표시한다.
    pub default_message_receiver: bool,
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
    ("builtin-agent-client", 1),
    ("builtin-agent-client", 2),
    ("builtin-agent-client", 3),
    ("builtin-agent-client", 4),
    ("builtin-icon-profiler", 1),
    ("builtin-icon-agent", 1),
    ("builtin-icon-explorer", 1),
    ("builtin-icon-md-editor", 1),
    ("builtin-icon-html-report", 1),
    ("builtin-icon-web-browser", 1),
    ("builtin-icon-calculator", 1),
    ("builtin-icon-weather", 1),
    ("builtin-icon-store", 1),
    ("builtin-agent-client", 5),
    ("builtin-agent-client", 6),
    ("builtin-agent-client", 7),
    ("builtin-agent-client", 8),
    ("builtin-agent-client", 9),
    ("builtin-agent-client", 10),
    ("builtin-agent-client", 11),
    ("builtin-icon-profiler", 2),
    ("builtin-icon-agent", 2),
    ("builtin-icon-explorer", 2),
    ("builtin-icon-md-editor", 2),
    ("builtin-icon-html-report", 2),
    ("builtin-icon-web-browser", 2),
    ("builtin-icon-calculator", 2),
    ("builtin-icon-weather", 2),
    ("builtin-icon-store", 2),
];

// BUNDLED_ASSET_KEYS와 같은 순서. 코어의 번들 매니페스트 대조 시험이 형식을 확인한다.
const BUNDLED_ASSET_FORMATS: &[AssetFormat] = &[
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Javascript,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
    AssetFormat::Svg,
];

pub fn bundled_asset_format(id: &str, version: u32) -> Option<AssetFormat> {
    BUNDLED_ASSET_KEYS
        .iter()
        .position(|key| *key == (id, version))
        .and_then(|index| BUNDLED_ASSET_FORMATS.get(index).copied())
}

pub const WEATHER_ASSET_KEYS: &[(&str, u32)] = &[
    ("builtin-weather-clear", 1),
    ("builtin-weather-partly-cloudy", 1),
    ("builtin-weather-cloudy", 1),
    ("builtin-weather-fog", 1),
    ("builtin-weather-rain", 1),
    ("builtin-weather-showers", 1),
    ("builtin-weather-snow", 1),
    ("builtin-weather-thunderstorm", 1),
    ("builtin-icon-weather", 2),
];
pub const AGENT_ASSET_KEYS: &[(&str, u32)] = &[
    ("builtin-agent-client", 11),
    ("builtin-icon-agent", 2),
];

pub const RETIRED_BUILTIN_APP_IDS: &[&str] = &["md-viewer", "slackbot"];
pub const STORE_MOVED_BUILTIN_APP_IDS: &[&str] = &["market", "earth", "reader"];

pub const BUILTIN_IDENTITIES: &[BuiltinIdentity] = &[
    BuiltinIdentity {
        default_message_receiver: false,
        id: "profiler",
        name: "프로파일러",
        version: 7,
        updated_at: "2026-11-08T15:00:00Z",
        blocks: crate::SINGLE_WINDOW_BLOCK_SET_VERSION,
        modules: &[("assets", 1), ("profiler", 1)],
        assets: &[("builtin-icon-profiler", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: true,
        id: "agent",
        name: "에이전트",
        version: 18,
        updated_at: "2026-11-14T00:00:00Z",
        blocks: crate::LIST_DISABLED_BLOCK_SET_VERSION,
        modules: &[("assets", 1), ("client", crate::RECEIVE_MESSAGE_CLIENT_VERSION), ("files", 1), ("process", 1), ("storage", 1), ("worker", 1)],
        assets: AGENT_ASSET_KEYS,
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "explorer",
        name: "탐색기",
        version: 5,
        updated_at: "2026-11-05T03:14:31Z",
        blocks: 26,
        modules: &[("assets", 1), ("files", 2)],
        assets: &[("builtin-icon-explorer", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "md-editor",
        name: "마크다운 편집기",
        version: 6,
        updated_at: "2026-11-05T03:14:31Z",
        blocks: 26,
        modules: &[("assets", 1), ("files", 3), ("storage", 3)],
        assets: &[("builtin-icon-md-editor", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "html-report",
        name: "시안과 리포트",
        version: 4,
        updated_at: "2026-11-05T03:14:31Z",
        blocks: 26,
        modules: &[("assets", 1), ("storage", 3)],
        assets: &[("builtin-icon-html-report", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "web-browser",
        name: "웹 브라우저",
        version: 3,
        updated_at: "2026-11-05T03:14:31Z",
        blocks: 26,
        modules: &[("assets", 1), ("web", 1)],
        assets: &[("builtin-icon-web-browser", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "calculator",
        name: "계산기",
        version: 4,
        updated_at: "2026-11-05T03:14:31Z",
        blocks: 26,
        modules: &[("assets", 1)],
        assets: &[("builtin-icon-calculator", 2)],
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "weather",
        name: "날씨",
        version: 5,
        updated_at: "2026-11-08T15:00:00Z",
        blocks: crate::SINGLE_WINDOW_BLOCK_SET_VERSION,
        modules: &[("assets", 1), ("http", 1)],
        assets: WEATHER_ASSET_KEYS,
    },
    BuiltinIdentity {
        default_message_receiver: false,
        id: "store",
        name: "앱스토어",
        version: 10,
        updated_at: "2026-11-12T00:00:00Z",
        blocks: crate::APP_ICON_MEDIA_BLOCK_SET_VERSION,
        modules: &[("assets", 1), ("storage", 2), ("store", 4), ("shell", 2)],
        assets: &[("builtin-icon-store", 2)],
    },
];

pub fn builtin_identity(id: &str) -> Option<&'static BuiltinIdentity> {
    BUILTIN_IDENTITIES.iter().find(|app| app.id == id)
}
pub fn is_builtin(id: &str) -> bool {
    builtin_identity(id).is_some()
}
pub fn is_retired_builtin(id: &str) -> bool {
    RETIRED_BUILTIN_APP_IDS.contains(&id)
}
pub fn is_store_moved_builtin(id: &str) -> bool {
    STORE_MOVED_BUILTIN_APP_IDS.contains(&id)
}
pub fn is_bundled_asset(id: &str, version: u32) -> bool {
    BUNDLED_ASSET_KEYS.contains(&(id, version))
}
