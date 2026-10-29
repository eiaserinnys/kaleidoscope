use tempfile::TempDir;

use crate::logins::{LoginEntry, Logins};

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
