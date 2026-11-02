//! 창과 블록의 가시성에 따른 원천 사용 여부.
use super::*;
use kaleidoscope_contract::data;

pub(super) fn visible(state: &crate::CoreState, window_id: &str, shell_visible: bool) -> bool {
    if !shell_visible {
        return false;
    }
    let shared = &state.shared;
    let Some(window) = shared.windows.iter().find(|w| w.id == window_id) else {
        return false;
    };
    if window.minimized {
        return false;
    }
    let workspace = shared
        .workspaces
        .iter()
        .find(|w| Some(&w.id) == state.device.active_workspace_id.as_ref())
        .or_else(|| shared.workspaces.first());
    let Some(workspace) = workspace else {
        return false;
    };
    let active = state.device.active_desktop_ids.get(&workspace.id);
    let desktops: Vec<_> = shared
        .desktops
        .iter()
        .filter(|d| d.workspace_id == workspace.id)
        .collect();
    let desktop = desktops
        .iter()
        .find(|d| Some(&d.id) == active)
        .copied()
        .or_else(|| desktops.into_iter().min_by_key(|d| d.position));
    if desktop.is_none_or(|d| d.id != window.desktop_id) {
        return false;
    }
    !shared
        .windows
        .iter()
        .any(|w| w.desktop_id == window.desktop_id && !w.minimized && w.maximized && w.z > window.z)
}

fn dynamic(expr: &str, variable: &str) -> bool {
    expr.match_indices(variable).any(|(index, _)| {
        expr.as_bytes()
            .get(index + variable.len())
            .is_none_or(|b| *b != b'.' && !b.is_ascii_alphanumeric() && *b != b'_')
    })
}

pub(super) fn live_sources(runtime: &Runtime) -> BTreeSet<String> {
    let mut live = BTreeSet::new();
    for (pointer, expr) in data::all_exprs(&runtime.definition) {
        if pointer.starts_with("/sources/") || pointer.starts_with("/agent/") {
            continue;
        }
        if runtime.dormant.iter().any(|prefix| {
            pointer == *prefix
                || pointer
                    .strip_prefix(prefix)
                    .is_some_and(|tail| tail.starts_with('/'))
        }) {
            continue;
        }
        let refs = data::data_refs(expr)
            .into_iter()
            .chain(data::data_meta_refs(expr))
            .collect::<Vec<_>>();
        if dynamic(expr, "$data")
            || dynamic(expr, "$data_meta")
            || (pointer.starts_with("/client/") && !refs.is_empty())
        {
            return runtime.definition.sources.keys().cloned().collect();
        }
        live.extend(refs);
    }
    let mut pending: Vec<_> = live.iter().cloned().collect();
    while let Some(name) = pending.pop() {
        for dep in runtime.compiled.source_dependencies(&name) {
            if live.insert(dep.clone()) {
                pending.push(dep.clone());
            }
        }
    }
    live
}

pub(super) fn source_live(runtime: &Runtime, name: &str) -> bool {
    runtime.attached > 0 && runtime.visible && live_sources(runtime).contains(name)
}

pub(super) fn deps_ready(runtime: &Runtime, name: &str) -> bool {
    runtime
        .compiled
        .source_dependencies(name)
        .iter()
        .all(|dep| runtime.data.contains_key(dep))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 쉬는_동작의_식과_살아있는_동작의_식은_각자_판정한다() {
        let definition = kaleidoscope_contract::validate::parse_app_definition(&json!({
            "id":"liveness-test", "name":"원천 시험", "requires":{"blocks":4,"modules":{"files":1}},
            "permissions":[{"module":"files","id":"file","label":"폴더","access":"read"}],
            "state":{"choice":""},
            "sources":{
                "upstream":{"kind":"file","permission":"file","path":"up.json"},
                "hidden":{"kind":"file","permission":"file","path":{"expr":"$data.upstream.path"}},
                "visible":{"kind":"file","permission":"file","path":"visible.json"}
            },
            "ui":{"type":"stack","direction":"column","children":[
                {"type":"button","label":"숨김","on_click":[{"set_state":"choice","value":{"expr":"$data.hidden.name"}}]},
                {"type":"button","label":"표시","on_click":[{"set_state":"choice","value":{"expr":"$data.visible.name"}}]}
            ]}
        }).to_string()).unwrap();
        let mut runtime = Runtime::new(1, definition, BTreeMap::new(), true, Default::default());
        runtime.dormant = vec!["/ui/children/0".into()];
        assert_eq!(live_sources(&runtime), BTreeSet::from(["visible".into()]));
        runtime.dormant.clear();
        assert_eq!(
            live_sources(&runtime),
            BTreeSet::from(["visible".into(), "hidden".into(), "upstream".into()])
        );
    }
}
