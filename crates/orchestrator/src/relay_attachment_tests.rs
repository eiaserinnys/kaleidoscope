use super::*;

#[tokio::test]
async fn user_event_records_attachments_and_removes_local_path_lines() {
    let state = AppState::in_memory("secret");
    let mut projection = Projection::default();
    let path = "/x/2026-10-29T16-35-31.519Z-회의 사진-86f9263434e44472a4e39c890085f270.png";
    process(
        &state,
        "w",
        "처음 지시",
        "user_message",
        &json!({
            "text": format!("사진을 봐 줘\n[첨부 파일 로컬 경로: {path}]"),
            "attachments": [path],
            "caller_info": {"source":"browser"}
        }),
        &mut projection,
    )
    .unwrap();
    process(
            &state,
            "w",
            "처음 지시",
            "intervention_sent",
            &json!({
                "text": "",
                "attachments": ["/x/2026-10-29T16-35-31.519Z-노트-86f9263434e44472a4e39c890085f270.txt"],
                "caller_info": {"source":"kaleidoscope"}
            }),
            &mut projection,
        )
        .unwrap();
    let jpeg_path = "/x/2026-10-29T16-35-31.519Z-사진-86f9263434e44472a4e39c890085f270.jpg";
    process(
        &state,
        "w",
        "처음 지시",
        "user_message",
        &json!({
            "text": "",
            "attachments": [jpeg_path],
            "caller_info": {"source":"browser"}
        }),
        &mut projection,
    )
    .unwrap();
    let no_extension_path = "/x/2026-10-29T16-35-31.519Z-.env-86f9263434e44472a4e39c890085f270";
    process(
        &state,
        "w",
        "처음 지시",
        "user_message",
        &json!({
            "text": "",
            "attachments": [no_extension_path],
            "caller_info": {"source":"browser"}
        }),
        &mut projection,
    )
    .unwrap();

    let history = state.history("w").unwrap();
    assert_eq!(history.len(), 4);
    assert_eq!(history[0].text, "사진을 봐 줘");
    assert_eq!(history[0].attachments[0].name, "회의 사진.png");
    assert_eq!(history[0].attachments[0].mime, "image/png");
    assert_eq!(history[1].text, "");
    assert_eq!(history[1].attachments[0].name, "노트.txt");
    assert_eq!(history[1].attachments[0].mime, "text/plain");
    assert_eq!(history[2].attachments[0].name, "사진.jpg");
    assert_eq!(history[2].attachments[0].mime, "image/jpeg");
    assert_eq!(history[3].attachments[0].name, ".env");
    assert_eq!(
        attachment_name("/x/2026-10-29T16-35-31.519Z-보고서.v1-86f9263434e44472a4e39c890085f270"),
        "보고서.v1"
    );
    assert_eq!(
        attachment_name(
            "/x/2026-10-29T16-35-31.519Z-보고서.v1-86f9263434e44472a4e39c890085f270.txt"
        ),
        "보고서.v1.txt"
    );
    assert_eq!(
        attachment_name(
            "/x/2026-10-29T16-35-31.519Z-보고서-11111111111111111111111111111111.v1-86f9263434e44472a4e39c890085f270"
        ),
        "보고서-11111111111111111111111111111111.v1"
    );

    let response = crate::agent::get_agent(State(state), axum::extract::Path("w".into())).await;
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let reply: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(reply["items"][0]["attachments"][0]["name"], "회의 사진.png");
    assert_eq!(reply["items"][0]["attachments"][0]["mime"], "image/png");
}
