//! 상태 스냅샷의 생성 순서와 화면 전달 순서를 맞춘다.
use kaleidoscope_contract::{CoreEvent, ShellSnapshot};
use std::collections::VecDeque;
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
    pending: VecDeque<PendingEvent>,
}

enum PendingEvent {
    State(StateEvent),
    Open(CoreEvent),
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
            if matches!(delivery.pending.back(), Some(PendingEvent::State(_))) {
                delivery.pending.pop_back();
            }
            delivery
                .pending
                .push_back(PendingEvent::State(event.clone()));
            return;
        }
        delivery.active = true;
        drop(delivery);
        notify(&event.event);
        self.drain(&mut notify);
    }

    pub(crate) fn deliver_open(&self, event: &CoreEvent, mut notify: impl FnMut(&CoreEvent)) {
        let mut delivery = self.delivery.lock().unwrap();
        if delivery.active {
            delivery
                .pending
                .push_back(PendingEvent::Open(event.clone()));
            return;
        }
        delivery.active = true;
        drop(delivery);
        notify(event);
        self.drain(&mut notify);
    }

    fn drain(&self, notify: &mut impl FnMut(&CoreEvent)) {
        loop {
            let mut delivery = self.delivery.lock().unwrap();
            let event = match delivery.pending.pop_front() {
                Some(event) => event,
                None => {
                    delivery.active = false;
                    return;
                }
            };
            drop(delivery);
            match event {
                PendingEvent::State(event) => notify(&event.event),
                PendingEvent::Open(event) => notify(&event),
            };
        }
    }
}
