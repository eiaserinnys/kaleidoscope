use kaleidoscope_contract::APP_AUTHORING_GUIDE;

#[test]
fn app_authoring_guide_explains_boundaries_before_reference_section() {
    let guide = APP_AUTHORING_GUIDE;
    assert_eq!(guide.lines().next(), Some("kaleidoscope 앱 제작 지침"));

    let headings = [
        "앱이란",
        "갈래 고르기",
        "할 수 있는 것",
        "할 수 없는 것",
        "확인 순서",
        "앱을 올릴 수 없는 세션",
        "참조",
    ];
    let positions: Vec<_> = headings
        .iter()
        .map(|heading| {
            guide
                .find(&format!("\n{heading}\n"))
                .map(|position| position + 1)
                .unwrap_or_else(|| panic!("안내문에 {heading} 제목이 없습니다"))
        })
        .collect();
    assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
    let capabilities = &guide[positions[2]..positions[3]];
    let limits = &guide[positions[3]..positions[4]];
    assert!(capabilities.contains("사용자가 허용한 이 PC의 프로그램"));
    assert!(limits.contains("허용한 프로그램은 일반 프로그램처럼 사용자 계정의 파일 권한"));
    // MCP instructions were observed truncating near 6,850 bytes, so keep the boundary guidance intact.
    assert!(positions[6] < 6_800, "참조 시작 바이트: {}", positions[6]);
}

#[test]
fn realtime_guide_explains_permission_and_network_boundary() {
    for phrase in ["client.realtime_permissions", "webSocketConstructor", "connection.login", "직접 WebSocket은 막혀", "arraybuffer", "onLifecycle"] {
        assert!(APP_AUTHORING_GUIDE.contains(phrase), "{phrase}");
    }
}
