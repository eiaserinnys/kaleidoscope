use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use kaleidoscope_contract::{CoreEvent, CoreReply, CoreRequest, ErrorCode, UpdateStatus};
use tempfile::TempDir;

use crate::{Core, CoreConfig, Host, UpdateHost};

#[derive(Default)]
struct FakeHost {
    calls: Mutex<usize>,
    failure: Mutex<Option<String>>,
}

impl Host for FakeHost {
    fn pick_folder(&self) -> Option<PathBuf> {
        None
    }
    fn updater(&self) -> Option<&dyn UpdateHost> {
        Some(self)
    }
}

impl UpdateHost for FakeHost {
    fn install(&self) -> Result<(), String> {
        *self.calls.lock().unwrap() += 1;
        match self.failure.lock().unwrap().clone() {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
    }
}

fn core(dir: &TempDir, host: Arc<FakeHost>) -> Core {
    Core::open(
        CoreConfig {
            embedded_server: None,
            data_dir: dir.path().into(),
            seed_definitions: vec![],
            server_url: "http://127.0.0.1:4219".into(),
            device_name: "test".into(),
        },
        host,
    )
    .unwrap()
}

fn ready() -> UpdateStatus {
    UpdateStatus::Ready {
        current_version: "0.0.1".into(),
        version: "0.0.2".into(),
    }
}

#[test]
fn restart_requires_ready_and_reports_install_failure() {
    let dir = TempDir::new().unwrap();
    let host = Arc::new(FakeHost::default());
    let core = core(&dir, host.clone());
    assert_eq!(
        core.handle(CoreRequest::UpdateRestart {}).unwrap_err().code,
        ErrorCode::Unavailable
    );
    core.set_update_status(UpdateStatus::Idle {
        current_version: "0.0.1".into(),
    });
    assert_eq!(
        core.handle(CoreRequest::UpdateRestart {}).unwrap_err().code,
        ErrorCode::InvalidRequest
    );
    core.set_update_status(ready());
    assert_eq!(
        core.handle(CoreRequest::UpdateRestart {}).unwrap(),
        CoreReply::UpdateRestart {}
    );
    assert_eq!(*host.calls.lock().unwrap(), 1);
    *host.failure.lock().unwrap() = Some("설치 실패".into());
    let error = core.handle(CoreRequest::UpdateRestart {}).unwrap_err();
    assert_eq!(error.code, ErrorCode::Io);
    assert!(error.message.contains("설치 실패"));
    match core.handle(CoreRequest::StateGet {}).unwrap() {
        CoreReply::StateGet { snapshot } => assert_eq!(
            snapshot.update,
            UpdateStatus::Failed {
                current_version: "0.0.1".into(),
                version: Some("0.0.2".into()),
                reason: "설치 실패".into(),
            }
        ),
        reply => panic!("unexpected reply: {reply:?}"),
    }
}

#[test]
fn status_emits_only_when_changed() {
    let dir = TempDir::new().unwrap();
    let core = core(&dir, Arc::new(FakeHost::default()));
    let events = Arc::new(Mutex::new(Vec::new()));
    let received = events.clone();
    core.subscribe(Box::new(move |event| {
        if let CoreEvent::StateChanged { snapshot } = event {
            received.lock().unwrap().push(snapshot.update.clone());
        }
    }));
    core.set_update_status(UpdateStatus::Unavailable {});
    core.set_update_status(ready());
    core.set_update_status(ready());
    assert_eq!(*events.lock().unwrap(), vec![ready()]);
}
