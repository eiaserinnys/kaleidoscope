use super::*;

impl AppState {
    pub(super) fn stream(
        &self,
        device_id: String,
    ) -> Result<
        impl Stream<Item = Result<Event, std::convert::Infallible>> + Send + 'static,
        CoreError,
    > {
        let rx = self.0.events.subscribe();
        let snapshot = DeviceEvent::AppsSnapshot {
            apps: self.current_apps()?,
        };
        self.touch_device(&device_id)?;
        *self
            .0
            .connections
            .lock()
            .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
            .entry(device_id.clone())
            .or_default() += 1;
        let state = self.clone();
        let interval = tokio::time::interval(Duration::from_secs(registry::PING_INTERVAL_SECS));
        let guard = ConnectionGuard {
            state: state.clone(),
            device_id: device_id.clone(),
        };
        let first = stream::once(async move {
            Ok(Event::default().data(serde_json::to_string(&snapshot).unwrap()))
        });
        let rest = stream::unfold(
            (rx, interval, state, device_id, Some(guard)),
            |(mut rx, mut interval, state, device_id, guard)| async move {
                loop {
                    tokio::select! {
                        received=rx.recv()=>match received {
                            Ok(event)=>if let Some(event) = state.event_for_device(&device_id, event) { return Some((Ok(Event::default().data(serde_json::to_string(&event).unwrap())),(rx,interval,state,device_id,guard))); },
                            Err(broadcast::error::RecvError::Closed)|Err(broadcast::error::RecvError::Lagged(_))=>{drop(guard);return None}
                        },
                        _=interval.tick()=>{
                            if state.is_revoked(&device_id){drop(guard);return None}
                            else {return Some((Ok(Event::default().comment("ping")),(rx,interval,state,device_id,guard)))}
                        }
                    }
                }
            },
        );
        Ok(first.chain(rest))
    }
}

struct ConnectionGuard {
    state: AppState,
    device_id: String,
}
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.0.connections.lock() {
            if let Some(count) = map.get_mut(&self.device_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(&self.device_id);
                }
            }
        }
    }
}
