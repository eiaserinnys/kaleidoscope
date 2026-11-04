//! 서버와 연결 목록을 실제 수신 사건으로 판정한다.
use std::sync::atomic::Ordering;

use kaleidoscope_contract::{
    registry::{ConnectionInfo, ConnectionKind},
    LinkStatus,
};

use crate::{CoreState, Inner};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WaitFor {
    Server,
    ConnectionsSnapshot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Readiness {
    Pending(WaitFor),
    Ready,
    Failed,
}

#[derive(Clone)]
pub(crate) struct Snapshot {
    pub(crate) server: Readiness,
    pub(crate) connections: Readiness,
    pub(crate) known: Vec<ConnectionInfo>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            server: Readiness::Ready,
            connections: Readiness::Ready,
            known: Vec::new(),
        }
    }
}

impl Snapshot {
    pub(crate) fn for_connection(&self, name: &str) -> Readiness {
        match self.known.iter().find(|info| info.name == name) {
            Some(info) if info.kind == ConnectionKind::Oauth => Readiness::Ready,
            Some(_) => self.server,
            None => self.connections,
        }
    }
}

pub(crate) fn snapshot_locked(inner: &Inner, state: &CoreState) -> Snapshot {
    let has_link = inner
        .link_file
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|file| !file.revoked);
    let server = if inner.shutting_down.load(Ordering::SeqCst) {
        Readiness::Failed
    } else {
        match &state.link {
            LinkStatus::Connected { .. } => Readiness::Ready,
            LinkStatus::Offline { reason: None, .. } if has_link => {
                Readiness::Pending(WaitFor::Server)
            }
            _ => Readiness::Failed,
        }
    };
    let connections = match server {
        Readiness::Ready
            if inner.connections_snapshot_epoch.load(Ordering::SeqCst)
                != inner.layout_connection_epoch.load(Ordering::SeqCst) =>
        {
            Readiness::Pending(WaitFor::ConnectionsSnapshot)
        }
        other => other,
    };
    Snapshot {
        server,
        connections,
        known: inner.connections.lock().unwrap().clone(),
    }
}

pub(crate) fn snapshot(inner: &Inner) -> Snapshot {
    let state = inner.state.lock().unwrap();
    snapshot_locked(inner, &state)
}

pub(crate) fn wait(inner: &Inner, needed: WaitFor) -> Readiness {
    let mut sequence = inner.layout_signal.sequence();
    loop {
        let snapshot = snapshot(inner);
        let result = match needed {
            WaitFor::Server => snapshot.server,
            WaitFor::ConnectionsSnapshot => snapshot.connections,
        };
        if !matches!(result, Readiness::Pending(_)) {
            return result;
        }
        sequence = inner.layout_signal.wait_after_change(sequence);
    }
}
