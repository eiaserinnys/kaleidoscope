//! 상태 스냅샷의 생성 순서와 화면 전달 순서를 맞춘다.
use kaleidoscope_contract::{CoreEvent, ShellSnapshot};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub(crate) struct StateEvent {
    sequence: u64,
    event: Arc<CoreEvent>,
}

impl StateEvent {
    pub(crate) fn into_snapshot(self) -> ShellSnapshot {
        let event = Arc::try_unwrap(self.event).unwrap_or_else(|event| (*event).clone());
        let CoreEvent::StateChanged { snapshot } = event else {
            unreachable!()
        };
        snapshot
    }
}

#[derive(Default)]
pub(crate) struct StateEvents {
    sequence: AtomicU64,
    delivery: Mutex<Delivery>,
}

#[derive(Default)]
struct Delivery {
    newest: u64,
    active: bool,
    pending: Option<StateEvent>,
}

impl StateEvents {
    // 반드시 상태 잠금을 잡은 채 호출해 스냅샷 생성 순서를 보존한다.
    pub(crate) fn prepare(&self, snapshot: ShellSnapshot) -> StateEvent {
        StateEvent {
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed) + 1,
            event: Arc::new(CoreEvent::StateChanged { snapshot }),
        }
    }

    pub(crate) fn deliver(&self, event: &StateEvent, mut notify: impl FnMut(&CoreEvent)) {
        let mut delivery = self.delivery.lock().unwrap();
        if event.sequence <= delivery.newest {
            return;
        }
        delivery.newest = event.sequence;
        if delivery.active {
            delivery.pending = Some(event.clone());
            return;
        }
        delivery.active = true;
        let mut current = event.clone();
        loop {
            drop(delivery);
            notify(&current.event);
            delivery = self.delivery.lock().unwrap();
            match delivery.pending.take() {
                Some(next) => current = next,
                None => {
                    delivery.active = false;
                    break;
                }
            }
        }
    }
}
