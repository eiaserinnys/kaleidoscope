use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use kaleidoscope_contract::registry::{
    DeviceLayout, LayoutFolder, LAYOUT_DEBOUNCE_MS, LAYOUT_RETRY_SECS,
};
use kaleidoscope_contract::LinkStatus;

use crate::link;
use crate::registry_client::RegistryError;
use crate::{CoreState, Inner};

pub(crate) fn start(inner: Arc<Inner>, generation: u64, epoch: u64) {
    if !is_active(&inner, generation, epoch) {
        return;
    }
    {
        let mut reported = inner.layout_reported_epoch.lock().unwrap();
        if *reported == Some(epoch) {
            return;
        }
        *reported = Some(epoch);
    }

    thread::Builder::new()
        .name("kaleidoscope-layout-report".into())
        .spawn(move || report_layouts(inner, generation, epoch))
        .expect("layout reporting thread can be started");
}

fn report_layouts(inner: Arc<Inner>, generation: u64, epoch: u64) {
    let Some(link_file) = inner.link_file.lock().unwrap().clone() else {
        return;
    };
    let mut last_sent: Option<DeviceLayout> = None;

    loop {
        if !is_active(&inner, generation, epoch) {
            return;
        }
        let signal_sequence = inner.layout_signal.sequence();
        let layout = {
            let state = inner.state.lock().unwrap();
            device_layout(&state)
        };
        if last_sent.as_ref() != Some(&layout) {
            match inner
                .registry
                .put_layout(&link_file.server_url, &link_file.token, &layout)
            {
                Ok(()) => last_sent = Some(layout),
                Err(RegistryError::Unauthorized) => {
                    link::token_rejected(&inner, link_file);
                    return;
                }
                Err(_) => {
                    for _ in 0..LAYOUT_RETRY_SECS {
                        if !is_active(&inner, generation, epoch) {
                            return;
                        }
                        thread::sleep(Duration::from_secs(1));
                    }
                    continue;
                }
            }
        }

        let mut observed_sequence = signal_sequence;
        loop {
            if !is_active(&inner, generation, epoch) {
                return;
            }
            let next_sequence = inner
                .layout_signal
                .wait_after(observed_sequence, Duration::from_millis(LAYOUT_DEBOUNCE_MS));
            if next_sequence == observed_sequence {
                break;
            }
            observed_sequence = next_sequence;
        }
    }
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

fn device_layout(state: &CoreState) -> DeviceLayout {
    DeviceLayout {
        workspaces: state.shared.workspaces.clone(),
        desktops: state.shared.desktops.clone(),
        windows: state.shared.windows.clone(),
        folders: state
            .device
            .grants
            .iter()
            .map(|grant| LayoutFolder {
                window_id: grant.window_id.clone(),
                permission: grant.permission.clone(),
                root_name: grant.root_name.clone(),
            })
            .collect(),
        active_workspace_id: state.device.active_workspace_id.clone(),
        active_desktop_ids: state.device.active_desktop_ids.clone(),
        // 식 오류 보고는 코어 데이터 런타임 PR에서 채운다.
        data_errors: Vec::new(),
    }
}
