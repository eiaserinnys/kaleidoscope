//! 대화 명령을 창의 제공자와 저장소에 연결한다.
use crate::{Inner, conversation_context::Context};
use base64::{Engine, engine::general_purpose::STANDARD};
use kaleidoscope_contract::{
    CoreError, CoreReply, CoreRequest,
    conversation::{
        ConversationModel, ConversationProfile, ModelsReply, ProfilesReply, ThreadItemsReply,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc};

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let window = match &request {
        CoreRequest::ConversationGet { window_id, .. }
        | CoreRequest::ConversationHistory { window_id, .. }
        | CoreRequest::ConversationCreate { window_id, .. }
        | CoreRequest::ConversationSwitch { window_id, .. }
        | CoreRequest::ConversationSend { window_id, .. }
        | CoreRequest::ConversationAttachment { window_id, .. }
        | CoreRequest::ConversationAttachmentOpen { window_id, .. } => window_id,
        _ => return Err(kaleidoscope_contract::errors::CONV_CONVERSATION_REQUEST_INVALID()),
    }
    .clone();
    let is_open = matches!(&request, CoreRequest::ConversationAttachmentOpen { .. });
    let ctx = Context::open(inner, &window)?;
    let request = match request {
        CoreRequest::ConversationSend {
            request_id,
            text,
            attachments,
            ..
        } => {
            return crate::conversation_send::send(inner, &ctx, request_id, text, attachments);
        }
        request => request,
    };
    ctx.client.require_login()?;
    let namespace = ctx.namespace(inner)?;
    match request {
        CoreRequest::ConversationGet { profile, .. } => {
            let thread = ctx.thread(inner, &namespace)?;
            let config = ctx.values(
                inner,
                &[
                    ("profile", &ctx.provider.profile),
                    ("selected_model", &ctx.provider.selected_model),
                    ("model_order", &ctx.provider.model_order),
                ],
            )?;
            let start_profile = config
                .get("profile")
                .and_then(Value::as_str)
                .filter(|profile| !profile.trim().is_empty())
                .ok_or_else(|| kaleidoscope_contract::errors::CONV_CONVERSATION_PROFILE_MISSING())?
                .to_string();
            let profile = profile
                .as_deref()
                .or_else(|| {
                    thread
                        .as_ref()
                        .and_then(|thread| thread.profile.as_ref().map(|p| p.id.as_str()))
                })
                .unwrap_or(&start_profile);
            let (models, profiles, items) = get_resources(
                &ctx.client,
                profile,
                thread.as_ref().map(|thread| thread.id.as_str()),
            )?;
            let model_order: Vec<String> =
                serde_json::from_value(config.get("model_order").cloned().unwrap_or_default())
                    .map_err(|_| {
                        kaleidoscope_contract::errors::CONV_SELECTION_MODEL_ORDER_INVALID()
                    })?;
            let selected_model = config.get("selected_model").and_then(Value::as_str);
            let start_model = selected_model
                .filter(|selected| {
                    models
                        .iter()
                        .any(|model| model.id == *selected && model.available)
                })
                .map(str::to_string)
                .or_else(|| {
                    model_order.iter().find_map(|selected| {
                        models
                            .iter()
                            .any(|model| model.id == *selected && model.available)
                            .then(|| selected.clone())
                    })
                });
            if let Some(thread) = &thread {
                let key = format!(
                    "{}\u{0}{}\u{0}{}",
                    ctx.client.info.name, namespace, ctx.workspace.id
                );
                crate::conversation_stream::watch(
                    inner,
                    key,
                    &window,
                    ctx.client.clone(),
                    &thread.id,
                    &items.cursor,
                );
            }
            crate::conversation_send::emit_drafts(inner, &ctx, &window);
            Ok(CoreReply::ConversationGet {
                thread,
                items: items.items,
                cursor: items.cursor,
                next_before: items.next_before,
                models,
                profiles,
                start: kaleidoscope_contract::conversation::ConversationStart {
                    profile: start_profile,
                    model: start_model,
                },
            })
        }
        CoreRequest::ConversationHistory { before, .. } => {
            let thread = ctx.thread(inner, &namespace)?.ok_or_else(|| {
                kaleidoscope_contract::errors::CONV_CONVERSATION_THREAD_NOT_FOUND(
                    &ctx.workspace.name,
                )
            })?;
            let items = history(&ctx, &thread.id, Some(&before))?;
            Ok(CoreReply::ConversationHistory {
                items: items.items,
                next_before: items.next_before,
            })
        }
        CoreRequest::ConversationCreate { model, profile, .. } => {
            let thread = ctx.create(inner, &namespace, &model, profile.as_deref())?;
            let key = format!(
                "{}\u{0}{}\u{0}{}",
                ctx.client.info.name, namespace, ctx.workspace.id
            );
            crate::conversation_stream::watch(
                inner,
                key,
                &window,
                ctx.client.clone(),
                &thread.id,
                "",
            );
            Ok(CoreReply::ConversationCreate { thread })
        }
        CoreRequest::ConversationSwitch { profile, model, .. } => {
            let (thread, notices) =
                ctx.switch(inner, &namespace, profile.as_deref(), model.as_deref())?;
            let key = format!(
                "{}\u{0}{}\u{0}{}",
                ctx.client.info.name, namespace, ctx.workspace.id
            );
            crate::conversation_stream::watch(
                inner,
                key,
                &window,
                ctx.client.clone(),
                &thread.id,
                "",
            );
            Ok(CoreReply::ConversationSwitch { thread, notices })
        }
        CoreRequest::ConversationAttachment {
            item_id,
            attachment_id,
            ..
        }
        | CoreRequest::ConversationAttachmentOpen {
            item_id,
            attachment_id,
            ..
        } => {
            let thread = ctx.thread(inner, &namespace)?.ok_or_else(|| {
                kaleidoscope_contract::errors::CONV_CONVERSATION_ATTACHMENT_THREAD_NOT_FOUND(
                    &ctx.workspace.name,
                )
            })?;
            let path = ctx.client.path(&[
                "threads",
                &thread.id,
                "items",
                &item_id,
                "attachments",
                &attachment_id,
            ])?;
            let (name, mime, bytes) = ctx.client.bytes(&path)?;
            if is_open {
                let name = crate::attachment::safe_attachment_name(&name);
                let key = format!(
                    "{:x}",
                    Sha256::digest(format!("{item_id}\0{attachment_id}").as_bytes())
                );
                let dir = inner.data_dir.join("attachments").join(key);
                std::fs::create_dir_all(&dir).map_err(|e| {
                    kaleidoscope_contract::errors::CONV_CONVERSATION_ATTACHMENT_WRITE_FAILED(&name)
                        .and_details(vec![e.to_string()])
                })?;
                let path = dir.join(&name);
                std::fs::write(&path, bytes).map_err(|e| {
                    kaleidoscope_contract::errors::CONV_CONVERSATION_ATTACHMENT_WRITE_FAILED(&name)
                        .and_details(vec![e.to_string()])
                })?;
                if crate::attachment::should_reveal(&name) {
                    inner.attachment_opener.reveal(&path)
                } else {
                    inner.attachment_opener.open(&path)
                }
                .map_err(|e| {
                    kaleidoscope_contract::errors::CONV_CONVERSATION_ATTACHMENT_OPEN_FAILED(&name)
                        .and_details(vec![e.to_string()])
                })?;
                return Ok(CoreReply::ConversationAttachmentOpen {});
            }
            Ok(CoreReply::ConversationAttachment {
                name,
                mime,
                data_base64: STANDARD.encode(bytes),
            })
        }
        _ => Err(kaleidoscope_contract::errors::CONV_CONVERSATION_FEATURE_UNAVAILABLE()),
    }
}

fn get_resources(
    client: &crate::conversation_http::Client,
    profile: &str,
    thread_id: Option<&str>,
) -> Result<
    (
        Vec<ConversationModel>,
        Vec<ConversationProfile>,
        ThreadItemsReply,
    ),
    CoreError,
> {
    let models_client = client.clone();
    let profiles_client = client.clone();
    let items_client = client.clone();
    let profile = profile.to_string();
    let thread_id = thread_id.map(str::to_string);
    std::thread::scope(
        |scope| -> Result<
            (
                Vec<ConversationModel>,
                Vec<ConversationProfile>,
                ThreadItemsReply,
            ),
            CoreError,
        > {
            let models = scope.spawn(move || {
                let query = BTreeMap::from([("profile".into(), profile)]);
                models_client
                    .json::<ModelsReply>(
                        reqwest::Method::GET,
                        &models_client.path(&["models"])?,
                        &query,
                        None::<&Value>,
                    )?
                    .ok_or_else(kaleidoscope_contract::errors::CONV_CONVERSATION_MODELS_MISSING)
            });
            let profiles = scope.spawn(move || {
                profiles_client
                    .json::<ProfilesReply>(
                        reqwest::Method::GET,
                        &profiles_client.path(&["profiles"])?,
                        &BTreeMap::new(),
                        None::<&Value>,
                    )?
                    .ok_or_else(kaleidoscope_contract::errors::CONV_CONVERSATION_PROFILES_MISSING)
            });
            let items = scope.spawn(move || match thread_id {
                Some(id) => history_client(&items_client, &id, None),
                None => Ok(ThreadItemsReply {
                    items: vec![],
                    next_before: None,
                    cursor: String::new(),
                }),
            });
            let models = models.join().unwrap();
            let profiles = profiles.join().unwrap();
            let items = items.join().unwrap();
            Ok((models?.models, profiles?.profiles, items?))
        },
    )
}

fn history(ctx: &Context, id: &str, before: Option<&str>) -> Result<ThreadItemsReply, CoreError> {
    history_client(&ctx.client, id, before)
}

fn history_client(
    client: &crate::conversation_http::Client,
    id: &str,
    before: Option<&str>,
) -> Result<ThreadItemsReply, CoreError> {
    let mut query = BTreeMap::from([("limit".into(), "200".into())]);
    if let Some(before) = before {
        query.insert("before".into(), before.into());
    }
    let mut reply: ThreadItemsReply = client
        .json(
            reqwest::Method::GET,
            &client.path(&["threads", id, "items"])?,
            &query,
            None::<&Value>,
        )?
        .ok_or_else(|| kaleidoscope_contract::errors::CONV_CONVERSATION_HISTORY_NOT_FOUND(id))?;
    for item in &mut reply.items {
        crate::share::strip_legacy_share_from_item(item);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{conversation_http::Client, logins::LoginEntry, profiler::Profiler};
    use kaleidoscope_contract::registry::{ConnectionInfo, ConnectionKind};
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn conversation_get_resources_arrive_concurrently() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let peak = Arc::new(AtomicUsize::new(0));
        let server_peak = peak.clone();
        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(4);
            let mut requests = 0;
            let mut workers = Vec::new();
            while requests < 3 && Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        requests += 1;
                        let peak = server_peak.clone();
                        workers.push(thread::spawn(move || {
                            static ACTIVE: AtomicUsize = AtomicUsize::new(0);
                            let now = ACTIVE.fetch_add(1, Ordering::SeqCst) + 1;
                            peak.fetch_max(now, Ordering::SeqCst);
                            let mut reader = BufReader::new(stream.try_clone().unwrap());
                            let mut line = String::new();
                            reader.read_line(&mut line).unwrap();
                            let path = line.split_whitespace().nth(1).unwrap();
                            thread::sleep(Duration::from_millis(120));
                            let body = if path.starts_with("/v1/models") {
                                r#"{"models":[]}"#
                            } else if path.starts_with("/v1/profiles") {
                                r#"{"profiles":[]}"#
                            } else {
                                r#"{"items":[],"cursor":"cursor"}"#
                            };
                            write!(
                                stream,
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                body.len(),
                                body
                            )
                            .unwrap();
                            ACTIVE.fetch_sub(1, Ordering::SeqCst);
                        }));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("local server accept failed: {error}"),
                }
            }
            for worker in workers {
                worker.join().unwrap();
            }
            requests
        });

        let temp = tempfile::tempdir().unwrap();
        let logins = Arc::new(crate::logins::Logins::open(temp.path()).unwrap());
        logins
            .store(
                "test",
                LoginEntry {
                    issuer: format!("http://{address}"),
                    client_id: None,
                    redirect_port: None,
                    access_token: Some("token".into()),
                    refresh_token: None,
                    expires_at: None,
                },
            )
            .unwrap();
        let client = Client {
            info: ConnectionInfo {
                name: "test".into(),
                kind: ConnectionKind::Oauth,
                base_url: format!("http://{address}"),
                writable: true,
                paths: vec![],
                issuer: None,
                scopes: None,
                resource: None,
            },
            workspace_name: "작업".into(),
            base_path: "/v1".into(),
            logins,
            profiler: Profiler::default(),
        };

        let (models, profiles, items) = get_resources(
            &client,
            "profile",
            Some("00000000-0000-0000-0000-000000000001"),
        )
        .unwrap();
        assert!(models.is_empty());
        assert!(profiles.is_empty());
        assert_eq!(items.cursor, "cursor");
        assert_eq!(server.join().unwrap(), 3);
        assert!(peak.load(Ordering::SeqCst) > 1);
        let spans = client.profiler.snapshot("network");
        assert_eq!(spans["recent_spans"].as_array().unwrap().len(), 3);
        assert!(
            spans["recent_spans"]
                .as_array()
                .unwrap()
                .iter()
                .any(|span| span["target"] == "GET /threads/{id}/items")
        );
        assert_eq!(spans["categories"][0]["label"], "네트워크 요청");
    }
}
