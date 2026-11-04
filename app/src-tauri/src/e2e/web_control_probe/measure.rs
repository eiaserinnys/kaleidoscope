use super::*;

fn tree(view: &Webview) -> Result<Value, String> {
    cdp(view, ProbeCall::AccessibilityTree)
}
fn node_id(tree: &Value, role: &str, name: &str) -> Result<i64, String> {
    tree["nodes"]
        .as_array()
        .ok_or("AX nodes 없음")?
        .iter()
        .find(|n| n["role"]["value"] == role && n["name"]["value"] == name)
        .and_then(|n| n["backendDOMNodeId"].as_i64())
        .ok_or_else(|| format!("AX 요소 또는 backendNodeId 없음: {role} {name}"))
}
fn count(tree: &Value, prefix: &str) -> Result<u64, String> {
    tree["nodes"]
        .as_array()
        .ok_or("AX nodes 없음")?
        .iter()
        .filter_map(|n| n["name"]["value"].as_str())
        .find_map(|name| name.strip_prefix(prefix).and_then(|n| n.parse().ok()))
        .ok_or_else(|| format!("AX 카운터 없음: {prefix}"))
}
fn input_value(tree: &Value) -> Result<String, String> {
    tree["nodes"]
        .as_array()
        .ok_or("AX nodes 없음")?
        .iter()
        .find(|n| n["role"]["value"] == "textbox" && n["name"]["value"] == "Probe input")
        .and_then(|n| n["value"]["value"].as_str())
        .map(str::to_owned)
        .ok_or("AX 입력 값 없음".into())
}
fn center(model: &Value) -> Result<(f64, f64), String> {
    let points = model["model"]["content"]
        .as_array()
        .ok_or("상자 content 없음")?;
    if points.len() != 8 {
        return Err("상자 좌표가 8개가 아님".into());
    }
    let values = points
        .iter()
        .map(|p| p.as_f64().ok_or("상자 좌표가 숫자가 아님".to_owned()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((
        (values[0] + values[2] + values[4] + values[6]) / 4.,
        (values[1] + values[3] + values[5] + values[7]) / 4.,
    ))
}
pub(super) fn measure_ax(view: &Webview) -> Result<Value, String> {
    cdp(view, ProbeCall::EnableAccessibility)?;
    let ax = tree(view)?;
    let mut nodes = Vec::new();
    let mut passed = true;
    for (role, name) in [
        ("button", "Probe button"),
        ("textbox", "Probe input"),
        ("link", "Probe link"),
    ] {
        match node_id(&ax, role, name) {
            Ok(id) => {
                let model = cdp(view, ProbeCall::BoxModel(id))?;
                let (x, y) = center(&model)?;
                nodes.push(json!({"role":role,"name":name,"backend_node_id":id,"box":model,"center":[x,y]}));
            }
            Err(error) => {
                passed = false;
                nodes.push(json!({"role":role,"name":name,"error":error}));
            }
        }
    }
    Ok(outcome(passed, json!({"tree":ax,"nodes":nodes})))
}
pub(super) fn measure_click(view: &Webview) -> Result<Value, String> {
    let before = tree(view)?;
    let id = node_id(&before, "button", "Probe button")?;
    let model = cdp(view, ProbeCall::BoxModel(id))?;
    let (x, y) = center(&model)?;
    let previous = count(&before, "click-count ")?;
    cdp(
        view,
        ProbeCall::Mouse {
            pressed: true,
            x,
            y,
        },
    )?;
    cdp(
        view,
        ProbeCall::Mouse {
            pressed: false,
            x,
            y,
        },
    )?;
    let after = tree(view)?;
    let current = count(&after, "click-count ")?;
    Ok(outcome(
        current == previous + 1,
        json!({"before":previous,"after":current,"center":[x,y]}),
    ))
}
pub(super) fn measure_type(view: &Webview, text: &str) -> Result<Value, String> {
    let before = tree(view)?;
    let id = node_id(&before, "textbox", "Probe input")?;
    let previous_count = count(&before, "input-count ")?;
    let previous_value = input_value(&before).unwrap_or_default();
    cdp(view, ProbeCall::Focus(id))?;
    cdp(view, ProbeCall::InsertText(text.into()))?;
    let after = tree(view)?;
    let current_count = count(&after, "input-count ")?;
    let current_value = input_value(&after)?;
    Ok(outcome(
        current_count == previous_count + 1
            && current_value != previous_value
            && current_value.contains(text),
        json!({"before_count":previous_count,"after_count":current_count,"before_value":previous_value,"after_value":current_value,"inserted":text}),
    ))
}
pub(super) fn measure_key(view: &Webview) -> Result<Value, String> {
    let before = tree(view)?;
    let id = node_id(&before, "textbox", "Probe input")?;
    let previous = count(&before, "enter-count ")?;
    cdp(view, ProbeCall::Focus(id))?;
    cdp(view, ProbeCall::Enter { down: true })?;
    cdp(view, ProbeCall::Enter { down: false })?;
    let after = tree(view)?;
    let current = count(&after, "enter-count ")?;
    Ok(outcome(
        current == previous + 1,
        json!({"before":previous,"after":current}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ax_selects_roles_names_values_and_rejects_missing_elements() {
        let ax = json!({"nodes":[
            {"role":{"value":"button"},"name":{"value":"Probe button"},"backendDOMNodeId":42},
            {"role":{"value":"textbox"},"name":{"value":"Probe input"},"value":{"value":"draft"},"backendDOMNodeId":43},
            {"role":{"value":"StaticText"},"name":{"value":"input-count 2"}}
        ]});
        assert_eq!(node_id(&ax, "button", "Probe button").unwrap(), 42);
        assert!(node_id(&ax, "link", "Probe link").is_err());
        assert_eq!(count(&ax, "input-count ").unwrap(), 2);
        assert!(count(&ax, "enter-count ").is_err());
        assert_eq!(input_value(&ax).unwrap(), "draft");
    }

    #[test]
    fn box_center_requires_four_numeric_points() {
        assert_eq!(
            center(&json!({"model":{"content":[10,20,30,20,30,40,10,40]}})).unwrap(),
            (20., 30.)
        );
        assert!(center(&json!({"model":{"content":[10,20]}})).is_err());
        assert!(center(&json!({"model":{"content":[10,20,30,20,30,40,10,"wrong"]}})).is_err());
    }
}
