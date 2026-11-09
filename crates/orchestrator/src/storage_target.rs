//! 선언된 저장 항목이 실제 저장 행의 어느 버킷·키·소유 범위를 가리키는지 한 번만 결정한다.
use super::*;
use kaleidoscope_contract::app_storage as contract;

/// 저장 행의 소유 범위. 계정 공용(`Account`)이면 소유 작업 공간이 없고,
/// `Workspace`면 그 작업 공간을 소유자로 기록한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum StorageScope {
    Account,
    Workspace(String),
}

impl StorageScope {
    pub(super) fn workspace_id(&self) -> Option<&str> {
        match self {
            StorageScope::Account => None,
            StorageScope::Workspace(workspace_id) => Some(workspace_id),
        }
    }
}

/// 저장소 명령 하나가 다루는 실제 행. 선언 검사와 권한 검사 뒤에 만들어 SQL 계층으로 넘긴다.
#[derive(Debug, Clone)]
pub(super) struct StorageTarget {
    pub(super) account_id: String,
    pub(super) app_id: String,
    pub(super) bucket_id: String,
    pub(super) key: String,
    pub(super) scope: StorageScope,
    pub(super) kind: contract::StorageKind,
}

/// 선언 항목과 요청 작업 공간, 문서 이름으로 실제 저장 대상을 정한다.
/// 소유 범위는 선언 키의 `{workspace_id}` 자리로만 판정하며, 키 문자열에 우연히 들어간
/// 작업 공간 ID는 소유 근거로 쓰지 않는다.
pub(super) fn resolve_storage_target(
    account_id: &str,
    app_id: &str,
    entry: &contract::StorageEntryDecl,
    request_workspace: Option<&str>,
    doc: Option<&str>,
) -> Result<StorageTarget, CoreError> {
    let prefix = super::app_storage::resolve_key(entry, request_workspace)?;
    let key = match doc {
        Some(doc) => collection_key(&prefix, doc)?,
        None => prefix,
    };
    let scope = match request_workspace {
        Some(workspace_id) if entry.key.contains("{workspace_id}") => {
            StorageScope::Workspace(workspace_id.to_string())
        }
        _ => StorageScope::Account,
    };
    Ok(StorageTarget {
        account_id: account_id.to_string(),
        app_id: app_id.to_string(),
        bucket_id: super::app_storage::bucket_id(account_id, app_id),
        key,
        scope,
        kind: entry.kind,
    })
}

/// 선언 키의 `{workspace_id}` 자리에 놓인 실제 값을 돌려준다. 자리 표시가 없으면 `None`.
pub(super) fn declared_workspace(entry: &contract::StorageEntryDecl, key: &str) -> Option<String> {
    let index = entry
        .key
        .split('/')
        .position(|segment| segment == "{workspace_id}")?;
    key.split('/').nth(index).map(str::to_string)
}

/// 모음 prefix와 문서 이름으로 실제 문서 키를 만든다.
pub(super) fn collection_key(prefix: &str, doc: &str) -> Result<String, CoreError> {
    if !contract::valid_collection_doc(doc) {
        return Err(kaleidoscope_contract::errors::STORAGE_DOCUMENT_NAME_INVALID(doc));
    }
    let key = format!("{prefix}/{doc}");
    if contract::collection_key_matches(prefix, &key) {
        Ok(key)
    } else {
        Err(kaleidoscope_contract::errors::STORAGE_DOCUMENT_KEY_INVALID(
            doc,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        key: &str,
        collection: bool,
        kind: contract::StorageKind,
    ) -> contract::StorageEntryDecl {
        let kind = match kind {
            contract::StorageKind::Json => "json",
            contract::StorageKind::Md => "md",
        };
        serde_json::from_value(json!({
            "id": "entry",
            "key": key,
            "collection": collection,
            "kind": kind,
            "default": "",
            "label": "항목",
            "presentation": "hidden"
        }))
        .unwrap()
    }

    #[test]
    fn judgment_table_resolves_bucket_key_and_scope() {
        let json_kind = contract::StorageKind::Json;
        let md_kind = contract::StorageKind::Md;
        let account = "account";
        let app = "app";
        let bucket = super::super::app_storage::bucket_id(account, app);

        let single = resolve_storage_target(
            account,
            app,
            &entry("settings/title", false, json_kind),
            Some("workspace-a"),
            None,
        )
        .unwrap();
        assert_eq!(single.key, "settings/title");
        assert_eq!(single.scope, StorageScope::Account);
        assert_eq!(single.bucket_id, bucket);
        assert_eq!(single.kind, json_kind);

        let global_doc = resolve_storage_target(
            account,
            app,
            &entry("documents", true, md_kind),
            Some("workspace-a"),
            Some("메모.md"),
        )
        .unwrap();
        assert_eq!(global_doc.key, "documents/메모.md");
        assert_eq!(global_doc.scope, StorageScope::Account);

        let workspace_doc = resolve_storage_target(
            account,
            app,
            &entry("workspaces/{workspace_id}/documents", true, md_kind),
            Some("workspace-a"),
            Some("메모.md"),
        )
        .unwrap();
        assert_eq!(
            workspace_doc.key,
            "workspaces/workspace-a/documents/메모.md"
        );
        assert_eq!(
            workspace_doc.scope,
            StorageScope::Workspace("workspace-a".into())
        );

        let literal = resolve_storage_target(
            account,
            app,
            &entry("workspaces/workspace-a/note", false, md_kind),
            Some("workspace-a"),
            None,
        )
        .unwrap();
        assert_eq!(literal.key, "workspaces/workspace-a/note");
        assert_eq!(literal.scope, StorageScope::Account);

        let missing = resolve_storage_target(
            account,
            app,
            &entry("workspaces/{workspace_id}/value", false, json_kind),
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(missing.id.as_deref(), Some("STORAGE_WORKSPACE_REQUIRED"));
    }
}
