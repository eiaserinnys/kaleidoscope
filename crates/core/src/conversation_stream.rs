//! 창들이 함께 쓰는 대화별 SSE. 저장 cursor만 재접속에 쓴다.
use crate::{connections::LoginStore, conversation_http::Client, Inner};
use kaleidoscope_contract::{
    conversation::{ConversationEvent, ConversationItem},
    CoreEvent, ErrorCode,
};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::Duration;

#[derive(Default)]
pub(crate) struct Streams(Mutex<HashMap<String, Stream>>);
struct Stream {
    windows: HashSet<String>,
    client: Client,
    thread: String,
    cursor: String,
    seen: HashSet<String>,
    running: bool,
}

pub(crate) fn watch(
    inner: &Arc<Inner>,
    key: String,
    window: &str,
    client: Client,
    thread: &str,
    cursor: &str,
    items: &[ConversationItem],
) {
    let mut streams = inner.conversation_streams.0.lock().unwrap();
    let entry = streams.entry(key.clone()).or_insert_with(|| Stream {
        windows: HashSet::new(),
        client,
        thread: thread.into(),
        cursor: cursor.into(),
        seen: HashSet::new(),
        running: false,
    });
    entry.windows.insert(window.into());
    entry.seen.extend(items.iter().map(|item| item.id.clone()));
    if !entry.running {
        entry.running = true;
        spawn(Arc::downgrade(inner), key);
    }
}

pub(crate) fn state_changed(inner: &Arc<Inner>) {
    let windows: HashSet<_> = inner
        .state
        .lock()
        .unwrap()
        .shared
        .windows
        .iter()
        .map(|window| window.id.clone())
        .collect();
    inner
        .conversation_streams
        .0
        .lock()
        .unwrap()
        .retain(|_, stream| {
            stream.windows.retain(|window| windows.contains(window));
            !stream.windows.is_empty()
        });
}

pub(crate) fn login_succeeded(inner: &Arc<Inner>, connection: &str) {
    let mut streams = inner.conversation_streams.0.lock().unwrap();
    for (key, entry) in streams.iter_mut() {
        if entry.client.info.name == connection && !entry.running {
            entry.running = true;
            spawn(Arc::downgrade(inner), key.clone());
        }
    }
}

fn spawn(inner: Weak<Inner>, key: String) {
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(_) => return,
        };
        let mut delay = 2;
        loop {
            let Some(inner) = inner.upgrade() else { return };
            let (client, thread, cursor) = {
                let streams = inner.conversation_streams.0.lock().unwrap();
                let Some(stream) = streams.get(&key) else {
                    return;
                };
                (
                    stream.client.clone(),
                    stream.thread.clone(),
                    stream.cursor.clone(),
                )
            };
            let weak = Arc::downgrade(&inner);
            drop(inner);
            match runtime.block_on(read_stream(weak.clone(), &key, &client, &thread, &cursor)) {
                Outcome::Gone => return,
                Outcome::Auth(code) => {
                    if let Some(inner) = weak.upgrade() {
                        if let Some(stream) =
                            inner.conversation_streams.0.lock().unwrap().get_mut(&key)
                        {
                            stream.running = false;
                        }
                        inner.emit(&CoreEvent::ConversationError {
                            thread_id: thread,
                            code,
                        });
                    }
                    return;
                }
                Outcome::Retry => {
                    thread::sleep(Duration::from_secs(delay));
                    delay = (delay * 2).min(30);
                }
            }
        }
    });
}

enum Outcome {
    Gone,
    Auth(ErrorCode),
    Retry,
}

async fn read_stream(
    inner: Weak<Inner>,
    key: &str,
    provider: &Client,
    thread: &str,
    cursor: &str,
) -> Outcome {
    let path = match provider.path(&["threads", thread, "events"]) {
        Ok(path) => path,
        Err(_) => return Outcome::Auth(ErrorCode::PermissionDenied),
    };
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(_) => return Outcome::Retry,
    };
    let logins = provider.logins.clone();
    let name = provider.info.name.clone();
    let Ok(Some(token)) = tokio::task::spawn_blocking(move || logins.token(&name)).await else {
        return Outcome::Auth(ErrorCode::LoginRequired);
    };
    let request = |token: &str| {
        let mut req = client
            .get(format!("{}{}", provider.info.base_url, path))
            .bearer_auth(token);
        if !cursor.is_empty() {
            req = req.header("Last-Event-ID", cursor);
        }
        req.send()
    };
    let mut response = match request(&token).await {
        Ok(response) => response,
        Err(_) => return Outcome::Retry,
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let logins = provider.logins.clone();
        let name = provider.info.name.clone();
        let rejected = token.clone();
        let Ok(Some(refreshed)) =
            tokio::task::spawn_blocking(move || logins.refresh(&name, &rejected)).await
        else {
            return Outcome::Auth(ErrorCode::LoginRequired);
        };
        response = match request(&refreshed).await {
            Ok(response) => response,
            Err(_) => return Outcome::Retry,
        };
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            provider.logins.invalidate(&provider.info.name, &refreshed);
            return Outcome::Auth(ErrorCode::LoginRequired);
        }
    }
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Outcome::Auth(ErrorCode::PermissionDenied);
    }
    if !response.status().is_success() {
        return Outcome::Retry;
    }
    let mut bytes = Vec::<u8>::new();
    let mut data = Vec::<Vec<u8>>::new();
    let mut event_id = None::<String>;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            _ => return Outcome::Retry,
        };
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 4 * 1024 * 1024 {
            return Outcome::Retry;
        }
        while let Some(newline) = bytes.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = bytes.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                if !data.is_empty() {
                    let joined = data.join(&b'\n');
                    let Ok(event) = serde_json::from_slice::<ConversationEvent>(&joined) else {
                        return Outcome::Retry;
                    };
                    let Some(inner) = inner.upgrade() else {
                        return Outcome::Gone;
                    };
                    let event = {
                        let mut streams = inner.conversation_streams.0.lock().unwrap();
                        let Some(state) = streams.get_mut(key) else {
                            return Outcome::Gone;
                        };
                        if let Some(id) = event_id.take() {
                            state.cursor = id;
                        }
                        deduplicate(state, event)
                    };
                    if let Some(update) = event {
                        inner.emit(&CoreEvent::ConversationUpdate {
                            thread_id: thread.into(),
                            update,
                        });
                    }
                    data.clear();
                }
                event_id = None;
            } else if let Some(value) = line.strip_prefix(b"data:") {
                data.push(value.strip_prefix(b" ").unwrap_or(value).to_vec());
            } else if let Some(value) = line.strip_prefix(b"id:") {
                event_id =
                    String::from_utf8(value.strip_prefix(b" ").unwrap_or(value).to_vec()).ok();
            }
            if data.iter().map(Vec::len).sum::<usize>() > 4 * 1024 * 1024 {
                return Outcome::Retry;
            }
        }
    }
}

fn deduplicate(state: &mut Stream, event: ConversationEvent) -> Option<ConversationEvent> {
    match event {
        ConversationEvent::Item { item } if !state.seen.insert(item.id.clone()) => None,
        ConversationEvent::Snapshot { mut snapshot } => {
            snapshot
                .items
                .retain(|item| state.seen.insert(item.id.clone()));
            state.cursor = snapshot.cursor.clone();
            Some(ConversationEvent::Snapshot { snapshot })
        }
        other => Some(other),
    }
}
