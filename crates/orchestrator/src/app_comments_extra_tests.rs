use super::*;

#[tokio::test]
async fn app_comments_numbers_idempotency_and_account_scoped_writes() {
    let state = AppState::in_memory("secret");
    let account = state.mcp_account_id().unwrap();
    state
        .lock_db()
        .unwrap()
        .execute(
            "INSERT INTO accounts(id,display_name,created_at) VALUES('other','other','now')",
            [],
        )
        .unwrap();
    let owner = device(&state, "owner", &account);
    let other = device(&state, "other", "other");
    let first = "/api/device/app-comments/first";
    let second = "/api/device/app-comments/second";
    assert_eq!(
        request(&state, &owner, "POST", first, create("one"))
            .await
            .1["thread"]["number"],
        1
    );
    assert_eq!(
        request(&state, &owner, "POST", second, create("two"))
            .await
            .1["thread"]["number"],
        1
    );
    let reply_path = format!("{first}/one/replies");
    let reply = json!({"id":"reply","text":"답글"});
    let (_, initial) = request(&state, &owner, "POST", &reply_path, reply.clone()).await;
    let (_, duplicate) = request(&state, &owner, "POST", &reply_path, reply).await;
    assert_eq!(initial, duplicate);
    assert_eq!(
        request(
            &state,
            &owner,
            "POST",
            &reply_path,
            json!({"id":"reply","text":"다른 답글"})
        )
        .await
        .1["id"],
        "COMMENT_REPLY_ID_CONFLICT"
    );
    assert_eq!(
        request(
            &state,
            &other,
            "PUT",
            &format!("{first}/one/resolved"),
            json!({"resolved":true})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &state,
            &other,
            "POST",
            &format!("{first}/one/read"),
            json!(null)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &state,
            &other,
            "POST",
            &format!("{first}/sent"),
            json!({"ids":["one"]})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &state,
            &other,
            "DELETE",
            &format!("{first}/one"),
            json!(null)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&state, &owner, "GET", &format!("{first}/one"), json!(null))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &state,
            &owner,
            "DELETE",
            &format!("{first}/one"),
            json!(null)
        )
        .await
        .0,
        StatusCode::OK
    );
    let count: i64 = state
        .lock_db()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM app_comment_replies WHERE account_id=?1 AND comment_id='one'",
            [account],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(
        request(&state, &owner, "POST", first, create("three"))
            .await
            .1["thread"]["number"],
        2
    );
}
