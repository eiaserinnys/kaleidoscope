//! 앱 정의 저장소 선언과 계정 × 앱 저장소 wire 계약 (계약 11판).

use std::collections::{BTreeMap, HashSet};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use ts_rs::TS;

use crate::{data, JsonValue};

/// JSON 저장 항목 하나의 UTF-8 직렬화 바이트 상한.
pub const STORAGE_JSON_MAX_BYTES: usize = 1024 * 1024;
/// Markdown 저장 항목 하나의 원문 UTF-8 바이트 상한.
pub const STORAGE_MD_MAX_BYTES: usize = 1024 * 1024;
/// 저장소 명령 HTTP 본문의 상한. JSON escape 여유를 포함한다.
pub const STORAGE_COMMAND_BODY_MAX_BYTES: usize = 8 * 1024 * 1024;

/// 앱 정의가 저장소에 선언하는 항목 모음.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageDecl {
    pub entries: Vec<StorageEntryDecl>,
}

/// 앱 정의의 저장 항목. JSON 항목은 제한된 JSON Schema와 JSON 기본값을, md 항목은 문자열 기본값을 가진다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageEntryDecl {
    pub id: String,
    /// 계정 × 앱 bucket 안의 키. 유일한 치환자는 `{workspace_id}`다.
    pub key: String,
    pub kind: StorageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schema: Option<StorageValueSchema>,
    /// JSON 값 또는 UTF-8 Markdown 문자열.
    pub default: JsonValue,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub description: Option<String>,
    pub presentation: StoragePresentation,
    #[serde(
        default,
        deserialize_with = "deserialize_choices_binding",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub choices: Option<data::Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent_context: Option<bool>,
}

/// 설정 선택지 하나. 문자열은 값과 라벨을 겸하고 객체는 별도 라벨을 제공한다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum StorageChoice {
    Value(String),
    Labeled(StorageChoiceObject),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageChoiceObject {
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub label: Option<String>,
}

fn deserialize_choices_binding<'de, D>(deserializer: D) -> Result<Option<data::Binding>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    let binding = if value.is_array() {
        data::Binding::Literal(value)
    } else {
        serde_json::from_value(value).map_err(serde::de::Error::custom)?
    };
    Ok(Some(binding))
}

/// storage 값 검사가 지원하는 JSON Schema 부분집합. 알 수 없는 키는 serde가 거부한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageValueSchema {
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub value_type: StorageSchemaType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub properties: Option<BTreeMap<String, StorageValueSchema>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub required: Option<Vec<String>>,
    #[serde(
        default,
        rename = "additionalProperties",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(rename = "additionalProperties", optional)]
    pub additional_properties: Option<AdditionalProperties>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub items: Option<Box<StorageValueSchema>>,
    #[serde(default, rename = "enum", skip_serializing_if = "Option::is_none")]
    #[ts(rename = "enum", optional)]
    pub enum_values: Option<Vec<JsonValue>>,
    #[serde(
        default,
        rename = "uniqueItems",
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(rename = "uniqueItems", optional)]
    pub unique_items: Option<bool>,
    #[serde(default, rename = "minLength", skip_serializing_if = "Option::is_none")]
    #[ts(rename = "minLength", optional, type = "number")]
    pub min_length: Option<u64>,
}

/// 추가 객체 필드를 금지하거나 각 값에 적용할 스키마를 지정한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum AdditionalProperties {
    Boolean(bool),
    Schema(Box<StorageValueSchema>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
#[ts(export, export_to = "contract.ts")]
pub enum StorageSchemaType {
    One(JsonValueType),
    Many(Vec<JsonValueType>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "contract.ts")]
pub enum JsonValueType {
    Object,
    Array,
    String,
    Number,
    Integer,
    Boolean,
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StorageKind {
    Json,
    Md,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StoragePresentation {
    Settings,
    Hidden,
}

/// `expected_revision`이 빠지거나 null이면 저장 행이 없을 때만 만든다는 뜻이다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(transparent)]
#[ts(type = "string | null")]
pub struct ExpectedRevision(pub Option<String>);

/// 저장소 항목 하나의 메타데이터. 이벤트와 목록 응답에는 본문을 넣지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageItemMeta {
    pub entry_id: String,
    pub key: String,
    pub kind: StorageKind,
    pub revision: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageListReply {
    pub bucket_id: String,
    pub items: Vec<StorageItemMeta>,
}

/// `content`는 JSON kind에서 임의 JSON, md kind에서 문자열이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageReadReply {
    pub kind: StorageKind,
    pub content: JsonValue,
    pub revision: Option<String>,
    pub exists: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageWriteRequest {
    pub content: JsonValue,
    #[serde(default)]
    #[ts(optional, as = "Option<ExpectedRevision>")]
    pub expected_revision: ExpectedRevision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageResetRequest {
    #[serde(default)]
    #[ts(optional, as = "Option<ExpectedRevision>")]
    pub expected_revision: ExpectedRevision,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageWriteReply {
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageResetReply {
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageConflict {
    pub current_revision: Option<String>,
}

/// 기본 앱이 선언을 가진 채 서버에 저장하는 원시 값의 메타데이터.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct AppValueMeta {
    pub key: String,
    pub kind: StorageKind,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct AppValueList {
    pub bucket_id: String,
    pub items: Vec<AppValueMeta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct AppValueRead {
    pub bucket_id: String,
    pub exists: bool,
    pub kind: Option<StorageKind>,
    pub content: Option<JsonValue>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "contract.ts")]
pub struct AppValueWrite {
    pub kind: StorageKind,
    pub content: JsonValue,
    #[serde(default)]
    #[ts(optional, as = "Option<ExpectedRevision>")]
    pub expected_revision: ExpectedRevision,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_id: Option<String>,
}

/// 저장소 상태가 연결되었을 때 보내는 메타데이터 snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageSnapshot {
    pub bucket_id: String,
    pub items: Vec<StorageItemMeta>,
}

/// 항목이 바뀌었을 때 보내는 메타데이터. 저장 본문은 이벤트에 실리지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "contract.ts")]
pub struct StorageChanged {
    pub bucket_id: String,
    pub item: StorageItemMeta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "contract.ts")]
pub enum StorageUpdate {
    Snapshot { snapshot: StorageSnapshot },
    Changed { changed: StorageChanged },
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredStorageEntry {
    pub entry_id: String,
    pub key: String,
    pub kind: StorageKind,
    pub content: JsonValue,
}

/// storage 선언과 기본값의 의미 검사를 한다. 서버 publish와 코어 앱 가져오기가 같이 쓴다.
pub fn validate_storage_decl(storage: &StorageDecl) -> Vec<String> {
    let mut errors = Vec::new();
    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for (index, entry) in storage.entries.iter().enumerate() {
        let at = format!("/storage/entries/{index}");
        if !data::valid_source_name(&entry.id) {
            errors.push(format!(
                "{at}/id는 소문자로 시작하고 소문자, 숫자, _만 써야 합니다: {}",
                entry.id
            ));
        }
        if !ids.insert(entry.id.as_str()) {
            errors.push(format!("{at}/id가 겹칩니다: {}", entry.id));
        }
        if !valid_storage_key(&entry.key) {
            errors.push(format!("{at}/key가 올바르지 않습니다: {}", entry.key));
        }
        if !keys.insert(entry.key.as_str()) {
            errors.push(format!("{at}/key가 겹칩니다: {}", entry.key));
        }
        if entry.label.trim().is_empty() {
            errors.push(format!("{at}/label이 비어 있습니다"));
        }
        if let Some(description) = &entry.description {
            if description.trim().is_empty()
                || description.contains('\n')
                || description.contains('\r')
                || description.chars().count() > 120
            {
                errors.push(format!(
                    "{at}/description은 공백이 아닌 한 줄 120자 이하여야 합니다"
                ));
            }
        }
        match entry.kind {
            StorageKind::Json => match &entry.schema {
                Some(schema) => {
                    if let Err(error) = validate_json_schema(schema, &at) {
                        errors.push(error);
                    } else if let Err(error) = validate_storage_content(entry, &entry.default) {
                        errors.push(error);
                    }
                }
                None => errors.push(format!("{at}/schema는 json 항목에 필요합니다")),
            },
            StorageKind::Md => {
                if entry.schema.is_some() {
                    errors.push(format!("{at}/schema는 md 항목에 둘 수 없습니다"));
                }
                if let Err(error) = validate_storage_content(entry, &entry.default) {
                    errors.push(format!("{at}/default: {error}"));
                }
            }
        }
        if entry.agent_context == Some(true) && entry.kind != StorageKind::Json {
            errors.push(format!(
                "{at}/agent_context는 json 항목에서만 쓸 수 있습니다"
            ));
        }
        if entry.kind == StorageKind::Json && entry.presentation == StoragePresentation::Settings {
            if entry
                .schema
                .as_ref()
                .is_some_and(|schema| !settings_schema_supported(schema))
            {
                errors.push(format!(
                    "{at}/schema는 설정 화면에서 지원하지 않는 모양입니다. 이 항목은 presentation을 hidden으로 선언해야 합니다"
                ));
            }
        }
        if let Some(choices) = &entry.choices {
            let choices_allowed = entry.kind == StorageKind::Json
                && entry.presentation == StoragePresentation::Settings
                && entry
                    .schema
                    .as_ref()
                    .is_some_and(settings_choices_schema_supported);
            if !choices_allowed {
                errors.push(format!(
                    "{at}/choices는 설정 JSON의 string, nullable string, 또는 string 배열 항목에서만 쓸 수 있습니다"
                ));
            }
            if let data::Binding::Literal(value) = choices {
                if !valid_literal_choices(value) {
                    errors.push(format!(
                        "{at}/choices 리터럴은 문자열 또는 value/label 객체로 된 선택지여야 합니다"
                    ));
                }
            }
        }
    }
    errors
}

fn settings_schema_supported(schema: &StorageValueSchema) -> bool {
    match &schema.value_type {
        StorageSchemaType::One(
            JsonValueType::Boolean
            | JsonValueType::String
            | JsonValueType::Number
            | JsonValueType::Integer,
        ) => true,
        StorageSchemaType::Many(types) => {
            types.len() == 2
                && types.iter().any(|kind| *kind == JsonValueType::Null)
                && types
                    .iter()
                    .filter(|kind| **kind != JsonValueType::Null)
                    .count()
                    == 1
                && types.iter().any(|kind| {
                    matches!(
                        kind,
                        JsonValueType::Boolean
                            | JsonValueType::String
                            | JsonValueType::Number
                            | JsonValueType::Integer
                    )
                })
        }
        StorageSchemaType::One(JsonValueType::Array) => {
            schema.items.as_deref().is_some_and(|items| {
                matches!(
                    items.value_type,
                    StorageSchemaType::One(JsonValueType::String)
                )
            })
        }
        StorageSchemaType::One(_) => false,
    }
}

fn settings_choices_schema_supported(schema: &StorageValueSchema) -> bool {
    match &schema.value_type {
        StorageSchemaType::One(JsonValueType::String) => true,
        StorageSchemaType::Many(types) => {
            types.len() == 2
                && types.contains(&JsonValueType::String)
                && types.contains(&JsonValueType::Null)
        }
        StorageSchemaType::One(JsonValueType::Array) => {
            schema.items.as_deref().is_some_and(|items| {
                matches!(
                    items.value_type,
                    StorageSchemaType::One(JsonValueType::String)
                )
            })
        }
        StorageSchemaType::One(_) => false,
    }
}

fn valid_literal_choices(value: &Value) -> bool {
    let valid_choice =
        |value: &Value| serde_json::from_value::<StorageChoice>(value.clone()).is_ok();
    match value {
        Value::Null => true,
        Value::Array(choices) => choices.iter().all(valid_choice),
        choice => valid_choice(choice),
    }
}

/// 저장 요청의 값을 선언된 kind/schema에 맞춰 검사한다.
pub fn validate_storage_content(entry: &StorageEntryDecl, content: &Value) -> Result<(), String> {
    match entry.kind {
        StorageKind::Json => {
            let schema = entry
                .schema
                .as_ref()
                .ok_or_else(|| "json 항목에 schema가 없습니다".to_string())?;
            validate_json_value(schema, content, "/content")?;
            let bytes = serde_json::to_vec(&canonicalize(content.clone()))
                .map_err(|error| format!("JSON content를 직렬화하지 못했습니다: {error}"))?;
            if bytes.len() > STORAGE_JSON_MAX_BYTES {
                Err(format!(
                    "json 항목이 {STORAGE_JSON_MAX_BYTES}바이트를 넘습니다"
                ))
            } else {
                Ok(())
            }
        }
        StorageKind::Md if content.is_string() => {
            if content
                .as_str()
                .is_some_and(|text| text.len() > STORAGE_MD_MAX_BYTES)
            {
                Err(format!(
                    "md 항목이 {STORAGE_MD_MAX_BYTES} UTF-8 바이트를 넘습니다"
                ))
            } else {
                Ok(())
            }
        }
        StorageKind::Md => Err("md 항목의 content는 문자열이어야 합니다".into()),
    }
}

/// revision 정본. md는 원문 UTF-8, json은 키 정렬한 compact JSON의 SHA-256이다.
pub fn storage_revision(kind: StorageKind, content: &Value) -> Result<String, String> {
    let bytes = match kind {
        StorageKind::Md => content
            .as_str()
            .ok_or_else(|| "md revision에는 문자열이 필요합니다".to_string())?
            .as_bytes()
            .to_vec(),
        StorageKind::Json => serde_json::to_vec(&canonicalize(content.clone()))
            .map_err(|error| format!("JSON revision을 직렬화하지 못했습니다: {error}"))?,
    };
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// 기존 선언과 저장 행이 새 앱 판과 호환되는지 각각 검사한다.
pub fn validate_storage_upgrade(
    previous: &StorageDecl,
    next: &StorageDecl,
    stored_values: &[StoredStorageEntry],
) -> Vec<String> {
    let old_by_id: BTreeMap<&str, &StorageEntryDecl> = previous
        .entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect();
    let new_by_id: BTreeMap<&str, &StorageEntryDecl> = next
        .entries
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect();
    let mut errors = Vec::new();

    // 선언끼리 비교하고 실제 작업별 키와는 따로 검사한다.
    for (entry_id, old) in &old_by_id {
        let Some(new) = new_by_id.get(entry_id) else {
            continue;
        };
        if old.key != new.key {
            errors.push(format!("저장 항목의 key 틀을 바꿀 수 없습니다: {entry_id}"));
        }
        if old.kind != new.kind {
            errors.push(format!("저장 항목의 kind를 바꿀 수 없습니다: {entry_id}"));
        }
        let old_type = old.schema.as_ref().map(|schema| &schema.value_type);
        let new_type = new.schema.as_ref().map(|schema| &schema.value_type);
        if old_type != new_type {
            errors.push(format!(
                "저장 항목의 JSON type을 바꿀 수 없습니다: {entry_id}"
            ));
        }
    }

    // 작업 자리표시는 한 세그먼트로 푼 실제 저장 키를 새 선언과 비교한다.
    for stored in stored_values {
        if !old_by_id.contains_key(stored.entry_id.as_str()) {
            errors.push(format!("저장값 {}에 이전 선언이 없습니다", stored.entry_id));
            continue;
        }
        let Some(new) = new_by_id.get(stored.entry_id.as_str()) else {
            errors.push(format!(
                "저장값이 있는 항목을 제거할 수 없습니다: {}",
                stored.entry_id
            ));
            continue;
        };
        if !storage_key_matches(&new.key, &stored.key) {
            errors.push(format!(
                "저장값의 key가 새 선언과 맞지 않습니다: {}",
                stored.entry_id
            ));
        }
        if stored.kind != new.kind {
            errors.push(format!(
                "저장값의 kind가 새 선언과 맞지 않습니다: {}",
                stored.entry_id
            ));
            continue;
        }
        if let Err(error) = validate_storage_content(new, &stored.content) {
            errors.push(format!(
                "새 선언이 기존 저장값 {}과 호환되지 않습니다: {error}",
                stored.entry_id
            ));
        }
    }
    errors
}

pub fn valid_storage_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 512 {
        return false;
    }
    let mut workspace_placeholders = 0;
    for segment in key.split('/') {
        if segment.is_empty() || segment == ".." {
            return false;
        }
        if segment == "{workspace_id}" {
            workspace_placeholders += 1;
            continue;
        }
        if segment.contains('{') || segment.contains('}') {
            return false;
        }
        if segment.len() > 64
            || !segment.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
            })
        {
            return false;
        }
    }
    workspace_placeholders <= 1
}

/// 선언의 키 틀이 실제 저장 키와 맞는지 검사한다. `{workspace_id}`는 정확히 한 경로 세그먼트다.
/// 서버와 코어가 같은 규칙으로 저장 행을 확인할 때 쓴다.
pub fn storage_key_matches(template: &str, concrete: &str) -> bool {
    if !valid_storage_key(template) || !valid_concrete_storage_key(concrete) {
        return false;
    }
    let template_segments: Vec<_> = template.split('/').collect();
    let concrete_segments: Vec<_> = concrete.split('/').collect();
    template_segments.len() == concrete_segments.len()
        && template_segments.iter().zip(concrete_segments).all(
            |(template_segment, concrete_segment)| {
                if *template_segment == "{workspace_id}" {
                    valid_storage_segment(concrete_segment)
                } else {
                    *template_segment == concrete_segment
                }
            },
        )
}

pub fn valid_concrete_storage_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 512 && key.split('/').all(valid_storage_segment)
}

fn valid_storage_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != ".."
        && segment.len() <= 64
        && segment.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn validate_json_schema(schema: &StorageValueSchema, at: &str) -> Result<(), String> {
    let types = match &schema.value_type {
        StorageSchemaType::One(kind) => vec![*kind],
        StorageSchemaType::Many(kinds) => kinds.clone(),
    };
    if types.is_empty() {
        return Err(format!("{at}/schema/type 배열은 하나 이상이어야 합니다"));
    }
    let mut seen = HashSet::new();
    if types.iter().any(|kind| !seen.insert(*kind)) {
        return Err(format!("{at}/schema/type에 겹치는 형식이 있습니다"));
    }
    if schema.properties.is_some()
        || schema.required.is_some()
        || schema.additional_properties.is_some()
    {
        if !types.contains(&JsonValueType::Object) {
            return Err(format!(
                "{at}/schema의 object 키워드는 type에 object가 있어야 합니다"
            ));
        }
    }
    if schema.items.is_some() || schema.unique_items.is_some() {
        if !types.contains(&JsonValueType::Array) {
            return Err(format!(
                "{at}/schema의 array 키워드는 type에 array가 있어야 합니다"
            ));
        }
    }
    if schema.min_length.is_some() && !types.contains(&JsonValueType::String) {
        return Err(format!(
            "{at}/schema/minLength는 type에 string이 있어야 합니다"
        ));
    }
    if schema.enum_values.as_ref().is_some_and(Vec::is_empty) {
        return Err(format!("{at}/schema/enum은 하나 이상의 값을 가져야 합니다"));
    }
    if let Some(properties) = &schema.properties {
        for (name, child) in properties {
            validate_json_schema(child, &format!("{at}/schema/properties/{name}"))?;
        }
    }
    if let Some(required) = &schema.required {
        let mut seen = HashSet::new();
        if required.iter().any(|name| !seen.insert(name)) {
            return Err(format!("{at}/schema/required 값이 겹칩니다"));
        }
        if let Some(properties) = &schema.properties {
            if let Some(missing) = required.iter().find(|name| !properties.contains_key(*name)) {
                return Err(format!(
                    "{at}/schema/required가 선언되지 않은 property를 가리킵니다: {missing}"
                ));
            }
        } else if !required.is_empty() {
            return Err(format!("{at}/schema/required에는 properties가 필요합니다"));
        }
    }
    match &schema.additional_properties {
        Some(AdditionalProperties::Boolean(true)) => {
            return Err(format!(
                "{at}/schema/additionalProperties는 false 또는 값 스키마여야 합니다"
            ));
        }
        Some(AdditionalProperties::Schema(child)) => {
            validate_json_schema(child, &format!("{at}/schema/additionalProperties"))?;
        }
        _ => {}
    }
    if let Some(items) = &schema.items {
        validate_json_schema(items, &format!("{at}/schema/items"))?;
    }
    Ok(())
}

fn validate_json_value(schema: &StorageValueSchema, value: &Value, at: &str) -> Result<(), String> {
    let types = match &schema.value_type {
        StorageSchemaType::One(kind) => vec![*kind],
        StorageSchemaType::Many(kinds) => kinds.clone(),
    };
    if !types.iter().any(|kind| matches_json_type(*kind, value)) {
        return Err(format!("{at}: 선언된 JSON 형식과 다릅니다"));
    }
    if let Some(enum_values) = &schema.enum_values {
        if !enum_values.contains(value) {
            return Err(format!("{at}: enum에 없는 값입니다"));
        }
    }
    if let (Some(min_length), Some(text)) = (schema.min_length, value.as_str()) {
        if text.chars().count() < min_length as usize {
            return Err(format!("{at}: 문자열이 minLength보다 짧습니다"));
        }
    }
    if let Some(object) = value.as_object() {
        if let Some(required) = &schema.required {
            if let Some(missing) = required.iter().find(|name| !object.contains_key(*name)) {
                return Err(format!("{at}: 필수 필드 {missing}가 없습니다"));
            }
        }
        for (name, field_value) in object {
            if let Some(field_schema) = schema
                .properties
                .as_ref()
                .and_then(|properties| properties.get(name))
            {
                validate_json_value(field_schema, field_value, &format!("{at}/{name}"))?;
            } else if let Some(AdditionalProperties::Schema(child)) = &schema.additional_properties
            {
                validate_json_value(child, field_value, &format!("{at}/{name}"))?;
            } else {
                return Err(format!("{at}: 허용되지 않은 필드입니다: {name}"));
            }
        }
    }
    if let Some(items) = value.as_array() {
        if let Some(item_schema) = &schema.items {
            for (index, item) in items.iter().enumerate() {
                validate_json_value(item_schema, item, &format!("{at}/{index}"))?;
            }
        }
        if schema.unique_items == Some(true) {
            for index in 0..items.len() {
                if items[..index].contains(&items[index]) {
                    return Err(format!("{at}: 중복 항목이 있습니다"));
                }
            }
        }
    }
    Ok(())
}

fn matches_json_type(kind: JsonValueType, value: &Value) -> bool {
    match kind {
        JsonValueType::Object => value.is_object(),
        JsonValueType::Array => value.is_array(),
        JsonValueType::String => value.is_string(),
        JsonValueType::Number => value.is_number(),
        JsonValueType::Integer => value.as_i64().is_some() || value.as_u64().is_some(),
        JsonValueType::Boolean => value.is_boolean(),
        JsonValueType::Null => value.is_null(),
    }
}

fn canonicalize(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonicalize).collect()),
        Value::Object(items) => {
            let sorted: BTreeMap<String, Value> = items.into_iter().collect();
            let mut result = Map::new();
            for (key, value) in sorted {
                result.insert(key, canonicalize(value));
            }
            Value::Object(result)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_storage_accepts_large_values_up_to_one_mebibyte() {
        let entry: StorageEntryDecl = serde_json::from_value(json!({
            "id":"document", "key":"document", "kind":"json", "label":"문서", "presentation":"hidden",
            "schema":{"type":"string"}, "default":""
        })).unwrap();
        assert!(validate_storage_content(&entry, &json!("x".repeat(128 * 1024))).is_ok());
        assert!(
            validate_storage_content(&entry, &json!("x".repeat(STORAGE_JSON_MAX_BYTES))).is_err()
        );
    }

    #[test]
    fn json_revision_sorts_keys_and_markdown_revision_keeps_raw_bytes() {
        let first = json!({"b": 2, "a": {"z": 0, "c": 1}});
        let second: Value = serde_json::from_str(r#"{"a":{"c":1,"z":0},"b":2}"#).unwrap();
        assert_eq!(
            storage_revision(StorageKind::Json, &first).unwrap(),
            storage_revision(StorageKind::Json, &second).unwrap()
        );
        assert_ne!(
            storage_revision(StorageKind::Md, &json!("a\nb")).unwrap(),
            storage_revision(StorageKind::Md, &json!("a\r\nb")).unwrap()
        );
    }

    #[test]
    fn storage_schema_rejects_unknown_keys_and_checks_defaults() {
        let invalid =
            serde_json::from_value::<StorageValueSchema>(json!({"type":"string", "pattern":".*"}));
        assert!(invalid.is_err());
    }

    #[test]
    fn storage_schema_rejects_keywords_for_the_wrong_json_type_and_open_objects() {
        let invalid_object = serde_json::from_value::<StorageValueSchema>(json!({
            "type":"string",
            "properties":{"name":{"type":"string"}}
        }))
        .unwrap();
        assert!(validate_json_schema(&invalid_object, "/schema").is_err());

        let open_object = serde_json::from_value::<StorageValueSchema>(json!({
            "type":"object",
            "properties":{"name":{"type":"string"}},
            "additionalProperties":true
        }))
        .unwrap();
        assert!(validate_json_schema(&open_object, "/schema").is_err());
    }

    #[test]
    fn storage_schema_validates_additional_property_values() {
        let schema: StorageValueSchema = serde_json::from_value(json!({
            "type":"object",
            "properties":{"fixed":{"type":"string"}},
            "additionalProperties":{"type":"object","additionalProperties":{"type":"string"}}
        }))
        .unwrap();
        assert!(validate_json_schema(&schema, "/schema").is_ok());
        assert!(validate_json_value(
            &schema,
            &json!({"fixed":"ok","env":{"A":"one","B":"two"}}),
            "/content"
        )
        .is_ok());
        assert!(validate_json_value(&schema, &json!({"env":{"A":2}}), "/content").is_err());
        assert!(!settings_schema_supported(&schema));
        let entry: StorageEntryDecl = serde_json::from_value(json!({
            "id":"map", "key":"settings/map", "kind":"json", "label":"Map",
            "presentation":"settings", "schema": schema, "default":{}
        }))
        .unwrap();
        assert!(!validate_storage_decl(&StorageDecl {
            entries: vec![entry]
        })
        .is_empty());
        for extra in [json!(false), Value::Null] {
            let mut value = json!({"type":"object","properties":{"fixed":{"type":"string"}}});
            if !extra.is_null() {
                value["additionalProperties"] = extra;
            }
            let fixed: StorageValueSchema = serde_json::from_value(value).unwrap();
            assert!(validate_json_schema(&fixed, "/schema").is_ok());
            assert!(validate_json_value(&fixed, &json!({"fixed":"ok"}), "/content").is_ok());
            assert!(validate_json_value(&fixed, &json!({"other":"no"}), "/content").is_err());
        }
        let open: StorageValueSchema =
            serde_json::from_value(json!({"type":"object","additionalProperties":true})).unwrap();
        assert!(validate_json_schema(&open, "/schema").is_err());
    }

    #[test]
    fn storage_keys_allow_one_workspace_placeholder_and_reject_bad_segments() {
        assert!(valid_storage_key("workspaces/{workspace_id}/thread"));
        for key in [
            "workspaces/{workspace_id}/{workspace_id}/thread",
            "workspaces/{desktop_id}/thread",
            "settings//profile",
            "settings/../profile",
        ] {
            assert!(!valid_storage_key(key), "{key}");
        }
    }
}
