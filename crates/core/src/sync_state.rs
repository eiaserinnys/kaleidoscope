use std::collections::BTreeMap;
use std::path::Path;

use kaleidoscope_contract::{CoreError, SharedState};
use serde::{Deserialize, Serialize};

use crate::storage::{self, LinkFile};
use crate::{CoreState, Inner};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EntityKind {
    Workspace,
    Desktop,
    Window,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) struct EntityKey {
    pub(crate) kind: EntityKind,
    pub(crate) id: String,
}

impl EntityKey {
    pub(crate) fn new(kind: EntityKind, id: &str) -> Self {
        Self {
            kind,
            id: id.to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct SyncState {
    pub(crate) device_id: Option<String>,
    pub(crate) merged: bool,
    pub(crate) pending: BTreeMap<EntityKey, u64>,
    pub(crate) next_seq: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct SyncFile {
    format: u32,
    device_id: Option<String>,
    merged: bool,
    pending: Vec<EntityKey>,
}

impl SyncState {
    pub(crate) fn mark(&mut self, kind: EntityKind, id: &str) {
        self.next_seq += 1;
        self.pending.insert(EntityKey::new(kind, id), self.next_seq);
    }

    pub(crate) fn contains(&self, kind: EntityKind, id: &str) -> bool {
        self.pending.contains_key(&EntityKey::new(kind, id))
    }

    pub(crate) fn mark_changes(&mut self, before: &SharedState, after: &SharedState) {
        macro_rules! mark_kind {
            ($field:ident, $kind:expr) => {
                for item in &before.$field {
                    if after.$field.iter().find(|x| x.id == item.id) != Some(item) {
                        self.mark($kind, &item.id);
                    }
                }
                for item in &after.$field {
                    if !before.$field.iter().any(|x| x.id == item.id) {
                        self.mark($kind, &item.id);
                    }
                }
            };
        }
        mark_kind!(workspaces, EntityKind::Workspace);
        mark_kind!(desktops, EntityKind::Desktop);
        mark_kind!(windows, EntityKind::Window);
    }

    pub(crate) fn mark_all(&mut self, shared: &SharedState) {
        for item in &shared.workspaces {
            self.mark(EntityKind::Workspace, &item.id);
        }
        for item in &shared.desktops {
            self.mark(EntityKind::Desktop, &item.id);
        }
        for item in &shared.windows {
            self.mark(EntityKind::Window, &item.id);
        }
    }
}

pub(crate) fn mark_local_changes(inner: &Inner, before: &SharedState, state: &mut CoreState) {
    if let Some(file) = inner.link_file.lock().unwrap().as_ref() {
        if state.sync.device_id.as_ref() != Some(&file.device_id) {
            state.sync = SyncState {
                device_id: Some(file.device_id.clone()),
                ..Default::default()
            };
        }
        state.sync.mark_changes(before, &state.shared);
    }
}

pub(crate) fn load(data_dir: &Path, link: Option<&LinkFile>) -> Result<SyncState, CoreError> {
    let file: SyncFile = storage::load_file(&data_dir.join("sync.json"), "sync.json")?;
    if file.format != 1 || link.map(|l| &l.device_id) != file.device_id.as_ref() || link.is_none() {
        return Ok(SyncState::default());
    }
    let mut sync = SyncState {
        device_id: file.device_id,
        merged: file.merged,
        ..Default::default()
    };
    for key in file.pending {
        sync.mark(key.kind, &key.id);
    }
    Ok(sync)
}

pub(crate) fn save(data_dir: &Path, sync: &SyncState) -> Result<(), CoreError> {
    storage::save_atomic(
        &data_dir.join("sync.json"),
        &SyncFile {
            format: 1,
            device_id: sync.device_id.clone(),
            merged: sync.merged,
            pending: sync.pending.keys().cloned().collect(),
        },
    )
}

pub(crate) fn remove(data_dir: &Path) -> Result<(), CoreError> {
    match std::fs::remove_file(data_dir.join("sync.json")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(crate::error::io_error(&error)),
    }
}
