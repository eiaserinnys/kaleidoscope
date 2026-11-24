//! 앱 판을 올리기 전에 저장소 선언과 자산 판의 바이트를 견주는 순수 판정.
//!
//! 게시 경로는 저장값까지 보고 거절하지만, 스토어 PR 검사는 아직 깔리지 않은 판을
//! 견주므로 저장값 없이 선언만 본다. 두 판정의 규칙은 같은 함수를 쓴다.

use std::collections::BTreeMap;

use crate::app_storage::{validate_storage_upgrade, StorageDecl};
use crate::assets::AssetDep;
use crate::AppDefinition;

/// 같은 자산 ID와 판의 파일 바이트. 검사 도구가 스토어가 올릴 파일을 읽어 넘긴다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetVersionBytes {
    pub id: String,
    pub version: u32,
    pub bytes: Vec<u8>,
}

/// 새 앱 정의의 저장소 선언이 이전 정의와 호환되는지 견주어, 올릴 수 없는 까닭을 돌려준다.
/// 저장값은 넘기지 않는다. 저장값이 있는 앱은 게시 경로가 따로 검사한다.
pub fn storage_upgrade_problems(previous: &AppDefinition, next: &AppDefinition) -> Vec<String> {
    let empty = || StorageDecl {
        entries: Vec::new(),
    };
    let previous = previous.storage.clone().unwrap_or_else(empty);
    let next = next.storage.clone().unwrap_or_else(empty);
    validate_storage_upgrade(&previous, &next, &[])
}

/// 같은 자산 ID와 판이 양쪽에 있는데 바이트가 다르면 그 자산을 돌려준다.
/// 한쪽에만 있는 자산은 견줄 상대가 없으므로 보지 않는다.
pub fn asset_version_conflicts(
    previous: &[AssetVersionBytes],
    next: &[AssetVersionBytes],
) -> Vec<AssetDep> {
    let previous_by_key: BTreeMap<(&str, u32), &[u8]> = previous
        .iter()
        .map(|asset| ((asset.id.as_str(), asset.version), asset.bytes.as_slice()))
        .collect();
    next.iter()
        .filter(|asset| {
            previous_by_key
                .get(&(asset.id.as_str(), asset.version))
                .is_some_and(|bytes| *bytes != asset.bytes.as_slice())
        })
        .map(|asset| AssetDep {
            id: asset.id.clone(),
            version: asset.version,
        })
        .collect()
}
