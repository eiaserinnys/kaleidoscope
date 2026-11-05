//! 창과 독립된 앱 배지 계산.
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use kaleidoscope_contract::AppDefinition;
use kaleidoscope_data::CompiledApp;

use crate::Inner;

#[derive(Default)]
pub(crate) struct Runtime {
    compiled: BTreeMap<String, (u32, AppDefinition, CompiledApp)>,
    warned: HashSet<(String, u32)>,
}

pub(crate) fn refresh(inner: &Arc<Inner>) {
    let mut state = inner.state.lock().unwrap();
    let mut runtime = inner.app_badges.lock().unwrap();
    let mut badges = BTreeMap::new();
    let mut active = HashSet::new();
    for app in &state.shared.apps {
        let Some(definition) = crate::app_commands::definition_for(&state.shared, &app.id, app.current_version) else { continue };
        let Some(badge) = definition.badge.as_ref() else { continue };
        active.insert(app.id.clone());
        let replace = runtime.compiled.get(&app.id).is_none_or(|(version, previous, _)| *version != app.current_version || previous != &definition);
        if replace {
            runtime.compiled.insert(app.id.clone(), (app.current_version, definition.clone(), CompiledApp::compile(&definition)));
        }
        let apps = crate::data_runtime::apps_for(&state, &definition);
        let result = runtime.compiled[&app.id].2.evaluate_badge(badge, apps.as_deref());
        let count = result.as_ref().ok().and_then(kaleidoscope_data::badge_count);
        if let Some(count) = count {
            if count > 0 { badges.insert(app.id.clone(), count); }
        } else if runtime.warned.insert((app.id.clone(), app.current_version)) {
            eprintln!("앱 배지 식의 결과가 0 이상의 정수가 아닙니다: app={}, version={}, result={:?}", app.id, app.current_version, result);
        }
    }
    runtime.compiled.retain(|id, _| active.contains(id));
    if state.app_badges == badges { return; }
    state.app_badges = badges;
    let event = inner.state_event_locked(&state);
    drop(runtime);
    drop(state);
    inner.emit_state(&event);
}
