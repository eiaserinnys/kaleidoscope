error_catalog! { ENTRIES;
    MCP_UPLOAD_APP_SERIALIZE_FAILED() {
        class: Server,
        place: "upload_app 입력 준비",
        cause: "앱 정의를 서버 요청용 JSON으로 만들지 못했다",
        message: "앱 정의를 upload_app 요청으로 바꾸지 못했습니다. 앱 정의를 확인한 뒤 다시 올리세요.",
        fix: "앱 정의를 확인하고 다시 올리세요"
    }
    MCP_GET_ASSET_NOT_FOUND(asset_id, version) {
        class: NotFound,
        place: "get_asset 자산 판 조회",
        cause: "요청한 자산 판이 없다",
        message: "자산 ID {asset_id}의 {version}판을 찾지 못했습니다. 자산 목록에서 판을 확인해 다시 조회하세요.",
        fix: "등록된 자산 ID와 판을 지정하세요"
    }
    MCP_DELETE_APP_BUILTIN(app_id) {
        class: InvalidAppDefinition,
        place: "delete_app 기본 앱 삭제 검사",
        cause: "기본 앱은 MCP 도구에서 삭제할 수 없다",
        message: "기본 앱 ID {app_id}: delete_app으로 지울 수 없습니다. 기본 앱 정의를 고치고 쉘 새 판을 내세요.",
        fix: "kaleidoscope 리포에서 기본 앱 정의를 고치고 새 쉘 판을 내세요"
    }
    MCP_DELETE_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "delete_app 앱 조회",
        cause: "삭제할 앱이 현재 계정에 없거나 이미 삭제되었다",
        message: "앱 ID {app_id}: 삭제할 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 삭제하세요.",
        fix: "현재 계정의 앱 ID를 확인하세요"
    }
    MCP_GET_APP_VERSION_NOT_FOUND(app_id, version) {
        class: NotFound,
        place: "get_app 기본 앱 판 조회",
        cause: "요청한 기본 앱 판이 현재 고정 판과 다르다",
        message: "기본 앱 ID {app_id}의 {version}판은 제공되지 않습니다. 현재 판으로 다시 조회하세요.",
        fix: "현재 기본 앱 판을 요청하세요"
    }
    MCP_GET_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "get_app 앱 판 조회",
        cause: "요청한 앱 또는 판이 없다",
        message: "앱 ID {app_id}: 요청한 앱이나 판을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 조회하세요.",
        fix: "현재 계정에 등록된 앱 ID와 판을 지정하세요"
    }
    MCP_OPEN_APP_NOT_FOUND(app_id) {
        class: Server,
        place: "open_app 앱 조회",
        cause: "열려는 앱이 현재 계정에 없다",
        message: "앱 ID {app_id}: 열 앱을 찾지 못했습니다. 앱 목록을 새로고침한 뒤 다시 여세요.",
        fix: "현재 계정에 등록된 앱 ID를 지정하세요"
    }
    MCP_GET_WORKSPACE_ID_REQUIRED() {
        class: Server,
        place: "get_workspace 작업 조회",
        cause: "요청에 workspace_id가 없고 MCP 연결에도 기본 작업이 없다",
        message: "get_workspace를 실행할 workspace_id가 없습니다. list_workspaces에서 작업 ID를 확인해 지정하세요.",
        fix: "요청에 존재하는 workspace_id를 지정하세요"
    }
    MCP_GET_WORKSPACE_NOT_FOUND(workspace_id) {
        class: Server,
        place: "get_workspace 작업 조회",
        cause: "요청한 작업이 현재 계정에 없다",
        message: "작업 ID {workspace_id}: 작업을 찾지 못했습니다. list_workspaces에서 현재 작업 ID를 확인하세요.",
        fix: "현재 계정에 있는 작업 ID를 지정하세요"
    }
    MCP_GET_SHARED_VIEW_WORKSPACE_ID_REQUIRED() {
        class: Server,
        place: "get_shared_view 작업 선택",
        cause: "요청에 workspace_id가 없고 MCP 연결에도 기본 작업이 없다",
        message: "get_shared_view를 실행할 workspace_id가 없습니다. list_workspaces에서 작업 ID를 확인해 지정하세요.",
        fix: "요청에 존재하는 workspace_id를 지정하세요"
    }
    MCP_DELETE_WORKSPACE_LAST(workspace_id) {
        class: Server,
        place: "delete_workspace 마지막 작업 검사",
        cause: "요청한 작업이 계정의 마지막 작업이다",
        message: "작업 ID {workspace_id}: 계정의 마지막 작업이라 지울 수 없습니다. 다른 작업을 만든 뒤 다시 요청하세요.",
        fix: "다른 작업을 만든 뒤 삭제하세요"
    }
    MCP_DELETE_WORKSPACE_NOT_FOUND(workspace_id) {
        class: Server,
        place: "delete_workspace 작업 조회",
        cause: "요청한 작업이 현재 계정에 없다",
        message: "작업 ID {workspace_id}: 지울 작업을 찾지 못했습니다. list_workspaces에서 작업 ID를 확인하세요.",
        fix: "현재 계정에 있는 작업 ID를 지정하세요"
    }
    MCP_REVOKE_DEVICE_NOT_FOUND(device_id) {
        class: Server,
        place: "revoke_device 기기 조회",
        cause: "연결을 끊을 기기가 현재 계정에 없다",
        message: "기기 ID {device_id}: 연결된 기기를 찾지 못했습니다. list_devices에서 기기 ID를 확인하세요.",
        fix: "list_devices에 표시된 기기 ID를 지정하세요"
    }
    MCP_DELETE_CONNECTION_NOT_FOUND(name) {
        class: Server,
        place: "delete_connection 연결 조회",
        cause: "삭제할 연결이 등록되어 있지 않다",
        message: "연결 {name}: 등록된 연결을 찾지 못했습니다. list_connections에서 이름을 확인하세요.",
        fix: "list_connections에 표시된 연결 이름을 지정하세요"
    }
}
