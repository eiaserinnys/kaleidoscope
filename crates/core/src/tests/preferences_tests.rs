use super::*;
use kaleidoscope_contract::preferences::AccountPreferences;
use kaleidoscope_contract::registry::LayoutChanges;

fn prefs(revision: u64, id: &str) -> AccountPreferences {
    AccountPreferences {
        revision,
        default_message_app_id: Some(id.into()),
        asked_message_app_ids: vec![],
    }
}

#[test]
fn preferences_events_reject_stale_revisions_and_survive_layout_sync() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = open_core_with_client(dir.path(), vec![], &host, registry_client());
    mark_connected(&core);
    let initial = prefs(2, "agent");
    assert!(crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::PreferencesSnapshot {
            preferences: initial.clone()
        }
    ));
    assert_eq!(snapshot(&core).shared.preferences, Some(initial.clone()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::PreferencesChanged {
            preferences: prefs(1, "old"),
        },
    );
    assert_eq!(snapshot(&core).shared.preferences, Some(initial.clone()));
    assert!(!crate::registry_events::apply_event(&core.inner, 99, DeviceEvent::PreferencesChanged { preferences: prefs(99, "wrong-server") }));
    assert_eq!(snapshot(&core).shared.preferences, Some(initial.clone()));
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutSnapshot {
            workspaces: vec![],
            desktops: vec![],
            windows: vec![],
        },
    );
    crate::registry_events::apply_event(
        &core.inner,
        0,
        DeviceEvent::LayoutChanged {
            changes: LayoutChanges::default(),
        },
    );
    let state = core.inner.state.lock().unwrap();
    assert_eq!(state.shared.preferences, Some(initial));
    let (batch, _) = crate::layout_sync::batch(&state.shared, &state.sync);
    assert!(serde_json::to_value(batch)
        .unwrap()
        .get("preferences")
        .is_none());
}

#[test]
fn preference_commands_apply_server_reply_and_preserve_server_errors() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let client = registry_client();
    let core = open_core_with_client(dir.path(), vec![], &host, client.clone());
    let error = core.handle(CoreRequest::ShellPreferencesSetDefault { app_id: None }).unwrap_err();
    assert_eq!(error.id.as_deref(), Some("SERVER_PREFERENCES_NOT_CONNECTED"));
    mark_connected(&core);
    client.preferences_replies.lock().unwrap().push_back(Ok(prefs(1, "agent")));
    let reply = core.handle(CoreRequest::ShellPreferencesSetDefault { app_id: Some("agent".into()) }).unwrap();
    assert!(matches!(reply, CoreReply::ShellPreferencesSetDefault { preferences } if preferences == prefs(1, "agent")));
    assert_eq!(snapshot(&core).shared.preferences, Some(prefs(1, "agent")));
    let server_error = kaleidoscope_contract::errors::SERVER_PREFERENCES_APP_NOT_FOUND();
    client.preferences_replies.lock().unwrap().push_back(Err(RegistryError::Validation(server_error.clone())));
    let error = core.handle(CoreRequest::ShellPreferencesAnswer { app_id: "missing".into(), use_as_default: false }).unwrap_err();
    assert_eq!(error, server_error);
    assert_eq!(*client.preferences_requests.lock().unwrap(), vec![("default".into(), json!({"app_id":"agent"})), ("answer".into(), json!({"app_id":"missing","use_as_default":false}))]);
}
