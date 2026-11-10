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
                .map_err(|_| {
                    kaleidoscope_contract::errors::SERVER_DEVICE_CONNECTION_STATE_LOCK_FAILED()
                })?
                .entry(device_id.clone())
                .or_default() += 1;
            self.0
                .device_support
                .lock()
                .map_err(|_| {
                    kaleidoscope_contract::errors::SERVER_DEVICE_SUPPORT_STATE_LOCK_FAILED()
                })?
                .insert(device_id.clone(), supported.clone());
            if registry_version >= registry::LAYOUT_SYNC_REGISTRY_VERSION {
                self.0
                    .layout_sync_devices
                    .lock()
                    .map_err(|_| {
                        kaleidoscope_contract::errors::SERVER_LAYOUT_SYNC_DEVICE_STATE_LOCK_FAILED()
                    })?
                    .insert(device_id.clone());
            } else {
                self.0
                    .layout_sync_devices
                    .lock()
                    .map_err(|_| {
                        kaleidoscope_contract::errors::SERVER_LAYOUT_SYNC_DEVICE_STATE_LOCK_FAILED()
                    })?
                    .remove(&device_id);
            }
        }
        let snapshot = DeviceEvent::AppsSnapshot {
            apps: apps
                .into_iter()
                .filter(|app| renders_definition_on(supported.as_ref(), &app.version.definition))
                .map(|app| app_for_client(app, supported.as_ref()))
                .collect(),
            deleted: self.deleted_app_ids()?,
        };
        let supports_storage = registry_version >= registry::STORAGE_REGISTRY_VERSION
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
                .map_err(|_| {
                    kaleidoscope_contract::errors::SERVER_STORAGE_DEVICE_STATE_LOCK_FAILED()
                })?
                .insert(device_id.clone());
        } else {
            self.0
                .storage_devices
                .lock()
                .map_err(|_| {
                    kaleidoscope_contract::errors::SERVER_STORAGE_DEVICE_STATE_LOCK_FAILED()
                })?
                .remove(&device_id);
        }
        let supports_app_values =
            supports_storage && registry_version >= registry::APP_VALUES_REGISTRY_VERSION;
        {
            let mut devices = self.0.app_value_devices.lock().map_err(|_| {
                kaleidoscope_contract::errors::SERVER_APP_VALUE_DEVICE_STATE_LOCK_FAILED()
            })?;
            if supports_app_values {
                devices.insert(device_id.clone());
            } else {
                devices.remove(&device_id);
            }
        }
        {
            let mut devices = self.0.collection_devices.lock().map_err(|_| {
                kaleidoscope_contract::errors::SERVER_COLLECTION_DEVICE_STATE_LOCK_FAILED()
            })?;
            if registry_version >= registry::COLLECTION_REGISTRY_VERSION
                && supported.as_ref().is_some_and(|supported| {
                    supported
                        .modules
                        .get("storage")
                        .is_some_and(|version| *version >= 3)
                })
            {
                devices.insert(device_id.clone());
            } else {
                devices.remove(&device_id);
            }
        }
        let mut initial_events = vec![snapshot];
        if registry_version >= registry::PREFERENCES_REGISTRY_VERSION {
            initial_events.push(DeviceEvent::PreferencesSnapshot {
                preferences: self.read_preferences(&self.device_account_id(&device_id)?)?,
            });
        }
        if registry_version >= registry::APP_COMMENTS_REGISTRY_VERSION {
            initial_events.push(DeviceEvent::AppCommentsSnapshot {
                apps: self.comment_metas(&self.device_account_id(&device_id)?)?,
            });
        }
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
        if supports_app_values {
            let account = self.device_account_id(&device_id)?;
            for id in kaleidoscope_contract::builtin::BUILTIN_IDENTITIES
                .iter()
                .map(|app| app.id)
            {
                let values = self.list_app_values(&account, id)?;
                initial_events.push(DeviceEvent::AppValuesSnapshot {
                    app_id: id.into(),
                    bucket_id: values.bucket_id,
                    items: values.items,
                });
            }
        }
        let state = self.clone();
        let interval = tokio::time::interval(Duration::from_secs(registry::PING_INTERVAL_SECS));
        self.0
            .window_control_versions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(device_id.clone())
            .or_default()
            .push(registry_version);
        let guard = ConnectionGuard {
            state: state.clone(),
            device_id: device_id.clone(),
            registry_version,
        };
        let first = stream::iter(initial_events.into_iter().filter_map(move |mut event| {
            if !project_layout_event(registry_version, &mut event) {
                return None;
            }
            Some(Ok(Event::default().data(
                serde_json::to_string(&event).unwrap(),
            )))
        }));
        let rest = stream::unfold(
            (rx, interval, state, device_id, Some(guard)),
            move |(mut rx, mut interval, state, device_id, guard)| async move {
                loop {
                    tokio::select! {
                        received=rx.recv()=>match received {
                            Ok(event)=>if !(matches!(event.event, DeviceEvent::WindowControl { .. }) && registry_version < 12) && !(matches!(event.event, DeviceEvent::StoreUpdateRequested { .. }) && registry_version < kaleidoscope_contract::STORE_UPDATE_REGISTRY_VERSION) && !(matches!(event.event, DeviceEvent::PreferencesChanged { .. } | DeviceEvent::PreferencesSnapshot { .. }) && registry_version < registry::PREFERENCES_REGISTRY_VERSION) && !(matches!(event.event, DeviceEvent::AppCommentsChanged { .. } | DeviceEvent::AppCommentsSnapshot { .. }) && registry_version < registry::APP_COMMENTS_REGISTRY_VERSION) { if let Some(mut event) = state.event_for_broadcast(&device_id, event) { if !project_layout_event(registry_version, &mut event) { continue; } return Some((Ok(Event::default().data(serde_json::to_string(&event).unwrap())),(rx,interval,state,device_id,guard))); } },
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

/// 연결의 레지스트리 판에 맞춰 배치 이벤트의 데스크톱 배경과 바로가기를 투영한다.
///
/// 옛 판 연결에는 그 판이 모르는 엔티티를 싣지 않는다. 새 필드만 있던 `LayoutChanged`는 그 연결에
/// 보낼 것이 없으므로 false를 돌려준다. 초기 이벤트와 방송 이벤트가 모두 직렬화 직전에 이 함수를 탄다.
fn project_layout_event(registry_version: u32, event: &mut DeviceEvent) -> bool {
    match event {
        DeviceEvent::LayoutSnapshot {
            desktop_shortcuts,
            desktop_wallpapers,
            ..
        } => {
            super::layouts::project_layout(
                registry_version,
                desktop_wallpapers,
                &mut Vec::new(),
                desktop_shortcuts,
                &mut Vec::new(),
            );
            true
        }
        DeviceEvent::LayoutChanged { changes } => {
            let has_entities = !changes.desktop_wallpapers.is_empty()
                || !changes.deleted_desktop_wallpapers.is_empty()
                || !changes.desktop_shortcuts.is_empty()
                || !changes.deleted_desktop_shortcuts.is_empty();
            super::layouts::project_layout(
                registry_version,
                &mut changes.desktop_wallpapers,
                &mut changes.deleted_desktop_wallpapers,
                &mut changes.desktop_shortcuts,
                &mut changes.deleted_desktop_shortcuts,
            );
            !(has_entities && changes.is_empty())
        }
        _ => true,
    }
}

struct ConnectionGuard {
    state: AppState,
    device_id: String,
    registry_version: u32,
}
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.state.0.connections.lock() {
            let mut versions = self
                .state
                .0
                .window_control_versions
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(entries) = versions.get_mut(&self.device_id) {
                if let Some(index) = entries.iter().position(|v| *v == self.registry_version) {
                    entries.remove(index);
                }
                if entries.is_empty() {
                    versions.remove(&self.device_id);
                }
            }
            drop(versions);
            if let Some(count) = map.get_mut(&self.device_id) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(&self.device_id);
                    self.state.delete_device_shared_views(&self.device_id);
                    self.state
                        .window_control_device_disconnected(&self.device_id);
                    self.state
                        .store_update_device_disconnected(&self.device_id);
                    if let Ok(mut support) = self.state.0.device_support.lock() {
                        support.remove(&self.device_id);
                    }
                    if let Ok(mut syncing) = self.state.0.layout_sync_devices.lock() {
                        syncing.remove(&self.device_id);
                    }
                    if let Ok(mut storage) = self.state.0.storage_devices.lock() {
                        storage.remove(&self.device_id);
                    }
                    if let Ok(mut devices) = self.state.0.app_value_devices.lock() {
                        devices.remove(&self.device_id);
                    }
                    if let Ok(mut devices) = self.state.0.collection_devices.lock() {
                        devices.remove(&self.device_id);
                    }
                }
            }
        }
    }
}
