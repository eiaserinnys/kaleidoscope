use serde_json::json;
use tempfile::TempDir;

use crate::connections::LoginStore;
use crate::logins::{scopes_cover, LoginEntry, Logins};

#[test]
fn logins_persist_client_redirect_and_tokens_between_core_restarts() {
    let dir = TempDir::new().unwrap();
    let logins = Logins::open(dir.path()).unwrap();
    logins
        .store(
            "company",
            LoginEntry {
                issuer: "https://auth.example".into(),
                client_id: Some("public-client".into()),
                redirect_port: Some(43127),
                scopes: None,
                access_token: Some("access-token".into()),
                refresh_token: Some("refresh-token".into()),
                expires_at: Some(1_900_000_000),
            },
        )
        .unwrap();

    let restarted = Logins::open(dir.path()).unwrap();
    assert_eq!(
        restarted.entry("company").unwrap(),
        logins.entry("company").unwrap()
    );
    assert!(dir.path().join("logins.json").is_file());
}

#[test]
fn records_without_scopes_do_not_serve_scoped_connections_and_stay() {
    let dir = TempDir::new().unwrap();
    std::fs::write(
        dir.path().join("logins.json"),
        json!({
            "scoped": {"issuer":"https://auth.example","client_id":"client","redirect_port":40000,
                       "access_token":"old-access","refresh_token":"old-refresh","expires_at":1_900_000_000},
            "plain": {"issuer":"https://auth.example","client_id":"client","redirect_port":40001,
                      "access_token":"plain-access","refresh_token":null,"expires_at":1_900_000_000}
        })
        .to_string(),
    )
    .unwrap();

    let logins = Logins::open(dir.path()).unwrap();
    assert_eq!(logins.token("scoped", Some("read")), None);
    assert_eq!(
        logins.token("plain", None),
        Some("plain-access".to_string())
    );

    let reopened = Logins::open(dir.path()).unwrap();
    let scoped = reopened.entry("scoped").unwrap();
    assert_eq!(scoped.access_token.as_deref(), Some("old-access"));
    assert_eq!(scoped.refresh_token.as_deref(), Some("old-refresh"));
    assert!(reopened.entry("plain").is_some());
}

#[test]
fn scopes_cover_compares_word_sets_in_any_order() {
    assert!(scopes_cover(Some("read"), Some("read")));
    assert!(scopes_cover(Some("write read"), Some("read write")));
    assert!(scopes_cover(Some("read   write"), Some("write read")));
    assert!(scopes_cover(Some("read write admin"), Some("read")));
    assert!(!scopes_cover(Some("read"), Some("read write")));
    assert!(!scopes_cover(None, Some("read")));
    assert!(scopes_cover(None, None));
    assert!(scopes_cover(None, Some("")));
    assert!(scopes_cover(Some("read"), Some("   ")));
}
