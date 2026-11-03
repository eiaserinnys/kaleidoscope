use super::*;

pub(crate) fn handle(inner: &Arc<Inner>, request: CoreRequest) -> Result<CoreReply, CoreError> {
    let is_attachment_open = matches!(&request, CoreRequest::LocalAgentAttachmentOpen { .. });
    match request {
        CoreRequest::LocalAgentAttach { window_id } => {
            {
                let mut windows = inner.local_agents.windows.lock().unwrap();
                windows
                    .entry(window_id.clone())
                    .or_insert_with(Controller::new)
                    .attached = true;
            }
            reconcile(inner, &window_id);
            let windows = inner.local_agents.windows.lock().unwrap();
            let c = windows.get(&window_id).ok_or_else(|| {
                errors::AGENT_ATTACH_CONTROLLER_NOT_FOUND()
                    .and_details(vec![format!("window_id: {}", &window_id)])
            })?;
            let ctx = context::resolve(inner, &window_id, &c.generation)?
                .ok_or_else(|| errors::AGENT_ATTACH_CONTEXT_INVALID())?;
            Ok(CoreReply::LocalAgentAttach {
                snapshot: merged(&ctx, c.worker.as_ref(), c.snapshot.as_ref()),
            })
        }
        CoreRequest::LocalAgentDetach { window_id } => {
            if let Some(c) = inner
                .local_agents
                .windows
                .lock()
                .unwrap()
                .get_mut(&window_id)
            {
                c.attached = false;
            }
            Ok(CoreReply::LocalAgentDetach {})
        }
        CoreRequest::LocalAgentAllow {
            window_id,
            spec_hash,
        } => {
            let ctx = context::resolve(inner, &window_id, "")?
                .ok_or_else(|| errors::AGENT_ALLOW_CONTEXT_INVALID())?;
            if ctx.snapshot.phase != LocalAgentPhase::AwaitingPermission
                || ctx
                    .snapshot
                    .execution
                    .as_ref()
                    .is_none_or(|e| e.spec_hash != spec_hash)
            {
                return Err(errors::AGENT_ALLOW_REQUEST_STALE());
            }
            let mut state = inner.state.lock().unwrap();
            state.device.local_agent_access.push(LocalAgentAccess {
                app_id: ctx.app_id,
                permission: ctx.permission,
                spec_hash,
                granted_at: crate::state_commands::timestamp(),
            });
            if let Err(err) = inner.save_state_locked(&state, false, true, false) {
                state.device.local_agent_access.pop();
                return Err(err);
            }
            drop(state);
            reconcile(inner, &window_id);
            Ok(CoreReply::LocalAgentAllow {})
        }
        CoreRequest::LocalAgentRetry {
            window_id,
            generation,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            worker(inner, &window_id, &generation)?
                .lock()
                .unwrap()
                .retry()?;
            Ok(CoreReply::LocalAgentRetry {})
        }
        CoreRequest::LocalAgentAuthenticate {
            window_id,
            generation,
            method_id,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            worker(inner, &window_id, &generation)?
                .lock()
                .unwrap()
                .authenticate(&method_id)?;
            Ok(CoreReply::LocalAgentAuthenticate {})
        }
        CoreRequest::LocalAgentConfigure {
            window_id,
            generation,
            control_id,
            value,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            worker(inner, &window_id, &generation)?
                .lock()
                .unwrap()
                .configure(&control_id, value)?;
            Ok(CoreReply::LocalAgentConfigure {})
        }
        CoreRequest::LocalAgentCancel {
            window_id,
            generation,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            worker(inner, &window_id, &generation)?
                .lock()
                .unwrap()
                .cancel();
            Ok(CoreReply::LocalAgentCancel {})
        }
        CoreRequest::LocalAgentPermission {
            window_id,
            generation,
            request_id,
            option_id,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            worker(inner, &window_id, &generation)?
                .lock()
                .unwrap()
                .answer_permission(&request_id, &option_id)?;
            Ok(CoreReply::LocalAgentPermission {})
        }
        CoreRequest::LocalAgentSend {
            window_id,
            generation,
            request_id,
            text,
            attachments,
        } => {
            let _guard = inner.local_agents.gate.lock().unwrap();
            let worker = worker(inner, &window_id, &generation)?;
            let ctx = context::resolve(inner, &window_id, &generation)?
                .ok_or_else(|| errors::AGENT_SEND_CONTEXT_INVALID())?;
            let key = format!("local-agent:{window_id}");
            let bytes = attachments.iter().try_fold(0u64, |total, attachment| {
                let bytes = STANDARD.decode(&attachment.data_base64).ok()?;
                (bytes.len() as u64 <= kaleidoscope_contract::AGENT_ATTACHMENT_MAX_BYTES)
                    .then_some(total.saturating_add(bytes.len() as u64))
            }).unwrap_or(kaleidoscope_contract::AGENT_ATTACHMENTS_TOTAL_MAX_BYTES + 1);
            let (visuals, visuals_sent) = share::capture_for_send(
                inner, &ctx.workspace, &key, attachments.len(), bytes,
            );
            let prepared = share::prepare_text(inner, &ctx.workspace, &key);
            let queued = worker.lock().unwrap().send(PromptInput {
                request_id: request_id.clone(),
                text,
                uploads: attachments,
                context: prepared.as_ref().map(|p| p.0.clone()),
                visuals,
            })?;
            if let Some((_, sent)) = prepared {
                share::mark_sent_text(inner, &key, sent);
            }
            share::mark_sent_visuals(inner, &key, visuals_sent);
            Ok(CoreReply::LocalAgentSend { request_id, queued })
        }
        CoreRequest::LocalAgentAttachment {
            window_id,
            item_id,
            attachment_id,
        }
        | CoreRequest::LocalAgentAttachmentOpen {
            window_id,
            item_id,
            attachment_id,
        } => {
            context::resolve(inner, &window_id, "")?
                .ok_or_else(|| errors::AGENT_ATTACHMENT_CONTEXT_INVALID())?;
            let (mime, bytes, _) = super::super::attachment_bytes(
                &context::record_dir(inner, &window_id),
                &item_id,
                &attachment_id,
            )?;
            if !is_attachment_open {
                return Ok(CoreReply::LocalAgentAttachment {
                    mime,
                    data_base64: STANDARD.encode(bytes),
                });
            }
            let name = super::super::read_history(&context::record_dir(inner, &window_id))
                .iter()
                .find(|item| item.id == item_id)
                .and_then(|item| item.attachments.iter().find(|a| a.id == attachment_id))
                .map(|a| crate::attachment::safe_attachment_name(&a.name))
                .ok_or_else(|| {
                    errors::AGENT_ATTACHMENT_HISTORY_MISSING().and_details(vec![
                        format!("item_id: {}", &item_id),
                        format!("attachment_id: {}", &attachment_id),
                    ])
                })?;
            let dir = inner.data_dir.join("attachments").join(format!(
                "{:x}",
                sha2::Sha256::digest(format!("{item_id}\0{attachment_id}").as_bytes())
            ));
            std::fs::create_dir_all(&dir).map_err(|e| {
                let reason = e.to_string();
                if e.kind() == std::io::ErrorKind::NotFound {
                    errors::AGENT_ATTACHMENT_OPEN_DIR_NOT_FOUND(reason)
                } else {
                    errors::AGENT_ATTACHMENT_OPEN_DIR_FAILED(reason)
                }
            })?;
            let path = dir.join(&name);
            std::fs::write(&path, bytes).map_err(|e| {
                let reason = e.to_string();
                if e.kind() == std::io::ErrorKind::NotFound {
                    errors::AGENT_ATTACHMENT_OPEN_WRITE_NOT_FOUND(reason)
                } else {
                    errors::AGENT_ATTACHMENT_OPEN_WRITE_FAILED(reason)
                }
            })?;
            if crate::attachment::should_reveal(&name) {
                inner.attachment_opener.reveal(&path)
            } else {
                inner.attachment_opener.open(&path)
            }
            .map_err(|e| {
                let reason = e.to_string();
                if e.kind() == std::io::ErrorKind::NotFound {
                    errors::AGENT_ATTACHMENT_OPEN_NOT_FOUND(reason)
                } else {
                    errors::AGENT_ATTACHMENT_OPEN_FAILED(reason)
                }
            })?;
            Ok(CoreReply::LocalAgentAttachmentOpen {})
        }
        _ => Err(errors::AGENT_COMMAND_UNKNOWN()),
    }
}
use sha2::Digest;
