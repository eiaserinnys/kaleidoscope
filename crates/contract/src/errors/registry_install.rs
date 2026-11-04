error_catalog! { ENTRIES;
    REGISTRYINSTALL_EXPECTED_VERSION_CONFLICT() { class: Conflict, place: "기대 판 대조", cause: "현재 앱 판이 기대한 판과 다르다", message: "설치하려는 앱이 그동안 바뀌었습니다. 현재 상태를 확인하고 다시 시도하세요.", fix: "현재 상태를 확인하고 다시 시도하세요" }
    REGISTRYINSTALL_ORIGIN_CONFLICT() { class: Conflict, place: "설치 출처 대조", cause: "같은 ID의 앱이 다른 출처에 속한다", message: "같은 ID의 앱이 다른 출처에 있어 덮어쓸 수 없습니다. 기존 앱을 확인하세요.", fix: "기존 앱을 확인하세요" }
    REGISTRYINSTALL_LOCAL_MODIFIED() { class: Conflict, place: "설치 수정 여부 확인", cause: "설치 후 앱이 수정되었다", message: "설치 후 수정한 앱이라 업데이트를 보류했습니다. 수정본을 보관한 뒤 삭제하고 다시 설치하세요.", fix: "수정본을 보관한 뒤 삭제하고 다시 설치하세요" }
    REGISTRYINSTALL_RELEASE_DIGEST_CONFLICT() { class: Conflict, place: "설치 판 해시 대조", cause: "같은 스토어 판의 해시가 다르다", message: "이미 설치한 스토어 판의 내용이 바뀌어 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요" }
    REGISTRYINSTALL_RELEASE_DOWNGRADE() { class: Conflict, place: "설치 판 순서 확인", cause: "기존 스토어 판보다 낮다", message: "설치하려는 스토어 판이 현재 판보다 낮습니다. 현재 판보다 높은 판을 선택하세요.", fix: "현재 판보다 높은 판을 선택하세요" }
    REGISTRYINSTALL_DIGEST_MISMATCH() { class: InvalidRequest, place: "설치 승인 해시 대조", cause: "manifest 해시와 승인 해시 또는 출처 해시가 다르다", message: "설치 묶음이 허용한 내용과 달라 설치하지 않았습니다. 다시 설치를 시작하세요.", fix: "다시 설치를 시작하세요" }
    REGISTRYINSTALL_DECLARATION_MISMATCH() { class: InvalidAppDefinition, place: "설치 선언 대조", cause: "앱 정의와 manifest 선언이 다르다", message: "앱 정의와 manifest 선언이 달라 설치하지 않았습니다. 게시자에게 알리세요.", fix: "게시자에게 알리세요" }
    REGISTRYINSTALL_DATABASE_FAILED() { class: Server, place: "설치 데이터 저장", cause: "레지스트리 데이터베이스에 저장하지 못했다", message: "앱 설치 정보를 저장하지 못했습니다. 서버 로그를 확인한 뒤 다시 시도하세요.", fix: "서버 로그를 확인한 뒤 다시 시도하세요" }
}
