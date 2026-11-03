#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MenuItem<'a> {
    Command(&'a str),
    Separator,
}

fn keep_web_menu_item(name: &str) -> bool {
    matches!(
        name,
        "undo"
            | "redo"
            | "cut"
            | "copy"
            | "paste"
            | "pasteAndMatchStyle"
            | "selectAll"
            | "copyLinkLocation"
            | "copyImage"
            | "copyImageLocation"
    )
}

pub(crate) fn kept_menu_indices(items: &[MenuItem<'_>]) -> Vec<usize> {
    let mut kept = Vec::new();
    let mut separator = None;
    for (index, item) in items.iter().enumerate() {
        match item {
            MenuItem::Command(name) if keep_web_menu_item(name) => {
                if let Some(index) = separator.take() {
                    kept.push(index);
                }
                kept.push(index);
            }
            MenuItem::Separator if !kept.is_empty() && separator.is_none() => {
                separator = Some(index);
            }
            _ => {}
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::{keep_web_menu_item, kept_menu_indices, MenuItem::*};

    #[test]
    fn only_the_requested_commands_are_kept() {
        for name in [
            "undo",
            "redo",
            "cut",
            "copy",
            "paste",
            "pasteAndMatchStyle",
            "selectAll",
            "copyLinkLocation",
            "copyImage",
            "copyImageLocation",
        ] {
            assert!(keep_web_menu_item(name), "{name}");
        }
        for name in [
            "back",
            "forward",
            "reload",
            "saveAs",
            "print",
            "inspect",
            "share",
            "openLinkInNewWindow",
            "unknown",
        ] {
            assert!(!keep_web_menu_item(name), "{name}");
        }
    }

    #[test]
    fn trims_and_collapses_separators_after_filtering() {
        let items = [
            Separator,
            Command("copy"),
            Separator,
            Command("back"),
            Separator,
            Separator,
            Command("paste"),
            Separator,
            Command("inspect"),
            Separator,
        ];
        assert_eq!(kept_menu_indices(&items), vec![1, 2, 6]);
    }

    #[test]
    fn empty_menu_has_no_kept_items() {
        assert!(kept_menu_indices(&[Separator, Command("reload"), Separator]).is_empty());
        assert!(kept_menu_indices(&[]).is_empty());
    }
}
