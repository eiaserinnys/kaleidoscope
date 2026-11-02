//! 오류 코드는 `{영역}_{동작}_{원인}`으로 짓고, 장소와 원인의 쌍마다 하나를 등록한다.
//! 이미 나간 코드는 뜻을 바꾸거나 다시 쓰지 않으며, 폐지한 코드는 `retired`에 남긴다.
//! 공용 검사 함수가 만든 오류는 그 검사가 장소이고, 어느 명령에서 불렀는지는 문구에 쓴다.
//! 문구에는 대상과 값, 실패한 이유, 사용자가 할 일을 담는다. 상류 상태 코드와 호스트는
//! `details`에 넣고, 토큰과 URL 쿼리 키는 가린다.

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

pub mod agent;
pub mod app;
pub mod asset;
pub mod conn;
pub mod conv;
pub mod data;
pub mod desk;
pub mod file;
pub mod mcp;
pub mod media;
pub mod retired;
pub mod server;
pub mod share;
pub mod shell;
pub mod storage;
pub mod web;
pub mod worker;

pub use app::{
    APP_DEFINITION_CHECK_FAILED, APP_DEFINITION_FORMAT_INVALID, APP_DEFINITION_JSON_INVALID,
    APP_DEFINITION_REQUIRES_NEWER_SHELL,
};
pub use file::{
    FILE_ACCESS_FOLDER_NOT_CHOSEN, FILE_ACCESS_PERMISSION_UNDECLARED,
    FILE_WRITE_READ_ONLY_PERMISSION,
};
pub use server::SERVER_CALL_NOT_CONNECTED;
pub use shell::SHELL_CALL_UNEXPECTED_FAILURE;
pub use storage::STORAGE_WRITE_SCHEMA_MISMATCH;

pub const AREAS: &[(&str, &[ErrorEntry])] = &[
    ("APP", app::ENTRIES),
    ("DESK", desk::ENTRIES),
    ("FILE", file::ENTRIES),
    ("STORAGE", storage::ENTRIES),
    ("DATA", data::ENTRIES),
    ("CONN", conn::ENTRIES),
    ("CONV", conv::ENTRIES),
    ("AGENT", agent::ENTRIES),
    ("MEDIA", media::ENTRIES),
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
