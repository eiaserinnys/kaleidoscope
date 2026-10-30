//! 같이 보기의 전송 내용은 서버와 코어에서 같은 규칙으로 만든다.
use kaleidoscope_contract::registry::{SHARE_BLOCK_END, SHARE_BLOCK_START};
use serde::{Deserialize, Serialize};
use similar::TextDiff;
use std::collections::BTreeMap;

const INTRO: &str = "디렉터가 kaleidoscope 쉘에서 「같이 보기」로 켠 창에 지금 보이는 내용입니다. 쉘이 디렉터의 말 뒤에 붙였고 디렉터가 쓴 글이 아닙니다. 지난번 말 뒤로 달라진 것만 담았습니다. 지금 모습 전체는 MCP get_shared_view로 읽을 수 있습니다. 이미지나 웹 화면이 보이는 창은 모습이 바뀌었을 때 「같이 보기 - 앱 이름.png」 첨부로 함께 옵니다.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SentView {
    pub app_name: String,
    pub text: String,
}
#[derive(Debug, Clone)]
pub struct View {
    pub window_id: String,
    pub app_name: String,
    pub text: String,
}

pub fn build_share_block(
    views: &[View],
    sent: &BTreeMap<String, SentView>,
) -> Option<(String, BTreeMap<String, SentView>)> {
    if views.is_empty() && sent.is_empty() {
        return None;
    }
    let mut next = BTreeMap::new();
    let mut entries = Vec::new();
    for view in views {
        next.insert(
            view.window_id.clone(),
            SentView {
                app_name: view.app_name.clone(),
                text: view.text.clone(),
            },
        );
        let (status, content) = match sent.get(&view.window_id) {
            None => ("새로 같이 봄", Some(view.text.clone())),
            Some(old) if old.text == view.text => ("그대로", None),
            Some(old) => {
                let diff = TextDiff::from_lines(&old.text, &view.text)
                    .unified_diff()
                    .context_radius(1)
                    .to_string();
                if diff.len() > view.text.len() {
                    ("바뀜(전체)", Some(view.text.clone()))
                } else {
                    ("바뀜", Some(diff))
                }
            }
        };
        let short = view.window_id.get(..8).unwrap_or(&view.window_id);
        entries.push((
            view.app_name.clone(),
            view.window_id.clone(),
            format!(
                "## {} (창 {}): {}{}",
                view.app_name,
                short,
                status,
                content.map(|s| format!("\n{s}")).unwrap_or_default()
            ),
        ));
    }
    for (id, previous) in sent {
        if !next.contains_key(id) {
            let short = id.get(..8).unwrap_or(id);
            entries.push((
                previous.app_name.clone(),
                id.clone(),
                format!("## {} (창 {}): 같이 보기 끝", previous.app_name, short),
            ));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    Some((
        format!(
            "{SHARE_BLOCK_START}\n{INTRO}\n\n{}\n{SHARE_BLOCK_END}",
            entries
                .into_iter()
                .map(|(_, _, entry)| entry)
                .collect::<Vec<_>>()
                .join("\n\n")
        ),
        next,
    ))
}
