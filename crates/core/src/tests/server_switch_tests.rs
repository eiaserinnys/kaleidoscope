use super::*;
use crate::EmbeddedServerInfo;
use kaleidoscope_contract::ServerMode;

#[test]
fn expired_or_missing_pairing_returns_to_embedded_without_restart() {
    for poll in [Ok(PairPollReply::Pending {}), Err(RegistryError::NotFound)] {
        let temp = TempDir::new().unwrap();
        let client = registry_client();
        *client.pair_start.lock().unwrap() = Some(Ok(PairStartReply {
            device_code: "pair".into(),
            user_code: "123456".into(),
            expires_at: "2000-01-01T00:00:00Z".into(),
            interval_secs: 1,
        }));
        client.pair_polls.lock().unwrap().push_back(poll);
        let core = Core::open_with_client(
            CoreConfig {
                data_dir: temp.path().into(),
                seed_definitions: vec![],
                server_url: "https://remote.test".into(),
                device_name: "시험".into(),
                embedded_server: Some(EmbeddedServerInfo {
                    server_url: "http://local.test".into(),
                    device_id: "local-device".into(),
                    token: "local-token".into(),
                }),
            },
            Arc::new(FakeHost::default()),
            client,
        )
        .unwrap();
        core.handle(CoreRequest::LinkStart { server_url: None })
            .unwrap();
        wait_until(|| {
            matches!(
                snapshot(&core).link,
                LinkStatus::Connected {
                    mode: ServerMode::Embedded,
                    ..
                } | LinkStatus::Offline {
                    mode: ServerMode::Embedded,
                    ..
                }
            )
        });
        let file = crate::storage::load_link(temp.path()).unwrap().unwrap();
        assert_eq!(file.mode, ServerMode::Embedded);
        assert_eq!(file.token, "local-token");
        core.shutdown();
    }
}
