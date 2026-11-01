use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use kaleidoscope_contract::registry::{LayoutChanges, LAYOUT_RETRY_SECS};
use kaleidoscope_contract::{LinkStatus, SharedState};

use crate::registry_client::RegistryError;
use crate::sync_state::{EntityKey, EntityKind, SyncState};
use crate::{layout_apply, link, registry_events, Inner};

pub(crate) fn start(inner: Arc<Inner>, generation: u64, epoch: u64) {
    if !is_active(&inner, generation, epoch) {
        return;
    }
    {
        let mut started = inner.layout_synced_epoch.lock().unwrap();
        if *started == Some(epoch) {
            return;
        }
        *started = Some(epoch);
    }
    thread::Builder::new()
        .name("kaleidoscope-layout-sync".into())
        .spawn(move || run(inner, generation, epoch))
        .expect("동기화 스레드를 시작할 수 없습니다");
}

fn is_active(inner: &Inner, generation: u64, epoch: u64) -> bool {
    inner.generation.load(Ordering::SeqCst) == generation
        && inner.layout_connection_epoch.load(Ordering::SeqCst) == epoch
        && matches!(
            inner.state.lock().unwrap().link,
            LinkStatus::Connected { .. }
        )
        && inner.link_file.lock().unwrap().is_some()
}

pub(crate) fn batch(shared: &SharedState, sync: &SyncState) -> (LayoutChanges, BTreeMap<EntityKey, u64>) {
    let mut changes = LayoutChanges::default();
    for key in sync.pending.keys() {
        match key.kind {
            EntityKind::Workspace => {
                match shared.workspaces.iter().find(|v| v.id == key.id) {
                    Some(value) => changes.workspaces.push(value.clone()),
                    None => changes.deleted_workspaces.push(key.id.clone()),
                }
            }
            EntityKind::Desktop => match shared.desktops.iter().find(|v| v.id == key.id) {
                Some(value) => changes.desktops.push(value.clone()),
                None => changes.deleted_desktops.push(key.id.clone()),
            },
            EntityKind::Window => match shared.windows.iter().find(|v| v.id == key.id) {
                Some(value) => changes.windows.push(value.clone()),
                None => changes.deleted_windows.push(key.id.clone()),
            },
        }
    }
    (changes, sync.pending.clone())
}

fn run(inner: Arc<Inner>, generation: u64, epoch: u64) {
    let Some(file) = inner.link_file.lock().unwrap().clone() else {
        return;
    };
    loop {
        if !is_active(&inner, generation, epoch) {
            return;
        }
        let sequence = inner.layout_signal.sequence();
        let (changes, sent) = {
            let state = inner.state.lock().unwrap();
            batch(&state.shared, &state.sync)
        };
        if sent.is_empty() {
            inner
                .layout_signal
                .wait_after(sequence, Duration::from_secs(1));
            continue;
        }
        let reply = inner
            .registry
            .push_layout_changes(&file.server_url, &file.token, &changes);
        if !is_active(&inner, generation, epoch) {
            return;
        }
        match reply {
            Err(RegistryError::Unauthorized) => {
                link::token_rejected(&inner, file);
                return;
            }
            Err(RegistryError::Failure(_)) | Err(RegistryError::NotFound) => {
                for _ in 0..LAYOUT_RETRY_SECS {
                    if !is_active(&inner, generation, epoch) {
                        return;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
            result => {
                let valid = result.is_ok();
                if !valid {
                    inner.conversation_snapshot_epoch.store(0, Ordering::SeqCst);
                }
                if let Err(RegistryError::Validation(error)) = &result {
                    eprintln!("배치 동기화 요청이 거부되었습니다: {}", error.message);
                }
                let applied = registry_events::apply_layout_change(&inner, |state| {
                    if inner.generation.load(Ordering::SeqCst) != generation
                        || inner.layout_connection_epoch.load(Ordering::SeqCst) != epoch
                        || !matches!(state.link, LinkStatus::Connected { .. })
                    {
                        return (false, false);
                    }
                    let before = crate::conversation_reconcile::workspace_names(state);
                    for (key, sent_seq) in &sent {
                        if !valid || state.sync.pending.get(key) == Some(sent_seq) {
                            state.sync.pending.remove(key);
                        }
                    }
                    if let Ok(reply) = result {
                        layout_apply::apply_changes(state, reply);
                    }
                    let workspace_changed =
                        before != crate::conversation_reconcile::workspace_names(state);
                    let waited = valid
                        && state.sync.pending.is_empty()
                        && inner
                            .conversation_workspace_sync_waiting
                            .swap(false, Ordering::SeqCst);
                    (workspace_changed, waited)
                });
                match applied {
                    Ok(((workspace_changed, waited), event)) => {
                        if let Some(event) = event {
                            inner.emit(&event);
                        }
                        if workspace_changed {
                            crate::conversation_reconcile::workspace_changed(&inner);
                        } else if waited {
                            crate::conversation_reconcile::schedule(&inner);
                        }
                    }
                    Err(error) => {
                        eprintln!("배치 동기화 상태를 저장할 수 없습니다: {}", error.message);
                        thread::sleep(Duration::from_secs(LAYOUT_RETRY_SECS));
                    }
                }
            }
        }
    }
}
