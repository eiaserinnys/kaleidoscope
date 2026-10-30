use super::*;

impl AppState {
    #[cfg(test)]
    pub(super) fn stream(
        &self,
        device_id: String,
        supported: Option<kaleidoscope_contract::Supported>,
    ) -> Result<
        impl Stream<Item = Result<Event, std::convert::Infallible>> + Send + 'static,
        CoreError,
    > {
        self.stream_with_registry(device_id, supported, 0)
    }

    pub(super) fn stream_with_registry(
        &self,
        device_id: String,
        supported: Option<kaleidoscope_contract::Supported>,
        registry_version: u32,
    ) -> Result<
        impl Stream<Item = Result<Event, std::convert::Infallible>> + Send + 'static,
        CoreError,
    > {
        let rx = self.0.events.subscribe();
        let apps = self.current_apps()?;
        self.touch_device(&device_id)?;
        {
            *self
                .0
                .connections
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                .entry(device_id.clone())
                .or_default() += 1;
            self.0
                .device_support
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                .insert(device_id.clone(), supported.clone());
            if registry_version >= registry::LAYOUT_SYNC_REGISTRY_VERSION {
                self.0
                    .layout_sync_devices
                    .lock()
                    .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                    .insert(device_id.clone());
            } else {
                self.0
                    .layout_sync_devices
                    .lock()
                    .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                    .remove(&device_id);
            }
        }
        let snapshot = DeviceEvent::AppsSnapshot {
            apps: apps
                .into_iter()
                .filter(|app| renders_on(supported.as_ref(), &app.version.definition.requires))
                .collect(),
        };
        let supports_storage = registry_version >= registry::REGISTRY_VERSION
            && supported.as_ref().is_some_and(|supported| {
                supported
                    .modules
                    .get("storage")
                    .is_some_and(|version| *version >= 1)
            });
        if supports_storage {
            self.0
                .storage_devices
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                .insert(device_id.clone());
        } else {
            self.0
                .storage_devices
                .lock()
                .map_err(|_| server_error("연결 상태를 읽을 수 없습니다."))?
                .remove(&device_id);
        }
        let mut initial_events = vec![snapshot];
        if supported.as_ref().is_some_and(|supported| {
            supported
                .modules
                .get("connection")
                .is_some_and(|version| *version >= 1)
        }) {
            initial_events.push(DeviceEvent::ConnectionsSnapshot {
                connections: self.connection_snapshot_for_device(&device_id)?,
            });
        }
        if registry_version >= registry::LAYOUT_SYNC_REGISTRY_VERSION {
            initial_events.push(self.layout_snapshot(&device_id)?);
        }
        if supports_storage {
            initial_events
                .extend(self.storage_snapshot_events(&self.device_account_id(&device_id)?)?);
        }
        let state = self.clone();
        let interval = tokio::time::interval(Duration::from_secs(registry::PING_INTERVAL_SECS));
        let guard = ConnectionGuard {
            state: state.clone(),
            device_id: device_id.clone(),
        };
        let first = stream::iter(
            initial_events
                .into_iter()
                .map(|event| Ok(Event::default().data(serde_json::to_string(&event).unwrap()))),
        );
        let rest = stream::unfold(
            (rx, interval, state, device_id, Some(guard)),
            |(mut rx, mut interval, state, device_id, guard)| async move {
                loop {
                    tokio::select! {
                        received=rx.recv()=>match received {
                            Ok(event)=>if let Some(event) = state.event_for_broadcast(&device_id, event) { return Some((Ok(Event::default().data(serde_json::to_string(&event).unwrap())),(rx,interval,state,device_id,guard))); },
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
                    self.state.delete_device_shared_views(&self.device_id);
                    if let Ok(mut support) = self.state.0.device_support.lock() {
                        support.remove(&self.device_id);
                    }
                    if let Ok(mut syncing) = self.state.0.layout_sync_devices.lock() {
                        syncing.remove(&self.device_id);
                    }
                    if let Ok(mut storage) = self.state.0.storage_devices.lock() {
                        storage.remove(&self.device_id);
                    }
                }
            }
        }
    }
}
