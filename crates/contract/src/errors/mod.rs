//! 오류 코드는 `{영역}_{동작}_{원인}`으로 짓고, 장소와 원인의 쌍마다 하나를 등록한다.
//! 이미 나간 코드는 뜻을 바꾸거나 다시 쓰지 않으며, 폐지한 코드는 `retired`에 남긴다.
//! 공용 검사 함수가 만든 오류는 그 검사가 장소이고, 어느 명령에서 불렀는지는 문구에 쓴다.
//! 문구에는 대상과 값, 실패한 이유, 사용자가 할 일을 담는다. 상류 상태 코드와 호스트는
//! `details`에 넣고, 토큰과 URL 쿼리 키는 가린다.
//! 대부분의 화면은 `details`를 그리지 않으므로, 사용자가 고치는 데 필요한 값은 문구에 넣는다.

#![allow(ambiguous_glob_reexports, unused_imports)]

#[derive(Clone, Copy, Debug)]
pub struct ErrorEntry {
    pub id: &'static str,
    pub args: &'static [&'static str],
    pub class: crate::ErrorCode,
    pub place: &'static str,
    pub cause: &'static str,
    pub message: &'static str,
    pub fix: &'static str,
}

macro_rules! error_catalog {
    ($table:ident; $( $id:ident($($arg:ident),* $(,)?) {
        class: $class:ident,
        place: $place:literal,
        cause: $cause:literal,
        message: $message:literal,
        fix: $fix:literal $(,)?
    } )*) => {
        $(
            #[allow(non_snake_case)]
            pub fn $id($($arg: impl ::std::fmt::Display),*) -> crate::CoreError {
                crate::CoreError::registered(
                    stringify!($id),
                    crate::ErrorCode::$class,
                    format!($message, $($arg = $arg),*),
                )
            }
        )*
        pub const $table: &[super::ErrorEntry] = &[
            $(super::ErrorEntry {
                id: stringify!($id),
                args: &[$(stringify!($arg)),*],
                class: crate::ErrorCode::$class,
                place: $place,
                cause: $cause,
                message: $message,
                fix: $fix,
            }),*
        ];
    };
}

pub mod app;
pub mod asset;
pub mod conn;
pub mod conv;
pub mod data;
pub mod desk;
pub mod file;
pub mod mcp;
pub mod media;
pub mod process;
pub mod realtime;
pub mod registry_install;
pub mod retired;
pub mod server;
pub mod share;
pub mod shell;
pub mod storage;
pub mod web;
pub mod worker;

pub use app::*;
pub use asset::*;
pub use conn::*;
pub use conv::*;
pub use data::*;
pub use desk::*;
pub use file::*;
pub use mcp::*;
pub use media::*;
pub use process::*;
pub use realtime::*;
pub use registry_install::*;
pub use server::*;
pub use share::*;
pub use shell::*;
pub use storage::*;
pub use web::*;
pub use worker::*;

const fn connection_entries() -> [ErrorEntry; conn::ENTRIES.len() + realtime::ENTRIES.len()] {
    let mut entries = [conn::ENTRIES[0]; conn::ENTRIES.len() + realtime::ENTRIES.len()];
    let mut index = 0;
    while index < conn::ENTRIES.len() {
        entries[index] = conn::ENTRIES[index];
        index += 1;
    }
    let mut realtime_index = 0;
    while realtime_index < realtime::ENTRIES.len() {
        entries[index] = realtime::ENTRIES[realtime_index];
        index += 1;
        realtime_index += 1;
    }
    entries
}

const CONNECTION_ENTRIES: [ErrorEntry; conn::ENTRIES.len() + realtime::ENTRIES.len()] =
    connection_entries();

pub const AREAS: &[(&str, &[ErrorEntry])] = &[
    ("APP", app::ENTRIES),
    ("DESK", desk::ENTRIES),
    ("FILE", file::ENTRIES),
    ("STORAGE", storage::ENTRIES),
    ("DATA", data::ENTRIES),
    ("CONN", &CONNECTION_ENTRIES),
    ("CONV", conv::ENTRIES),
    ("MEDIA", media::ENTRIES),
    ("PROCESS", process::ENTRIES),
    ("REGISTRYINSTALL", registry_install::ENTRIES),
    ("WEB", web::ENTRIES),
    ("WORKER", worker::ENTRIES),
    ("ASSET", asset::ENTRIES),
    ("SHARE", share::ENTRIES),
    ("SERVER", server::ENTRIES),
    ("MCP", mcp::ENTRIES),
    ("SHELL", shell::ENTRIES),
];

pub fn all() -> impl Iterator<Item = &'static ErrorEntry> {
    AREAS.iter().flat_map(|(_, entries)| entries.iter())
}
