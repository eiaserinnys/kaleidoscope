//! 계정별 쉘 설정과 메시지 수신 앱 판정.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{client::ClientCapability, AppDefinition};

/// 서버가 관리하는 계정 설정. 기본 앱이 없으면 기본 앱 묶음의 초기 수신 앱을 쓴다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "contract.ts")]
pub struct AccountPreferences {
    #[ts(type = "number")]
    pub revision: u64,
    pub default_message_app_id: Option<String>,
    pub asked_message_app_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageReceiver {
    Conversation,
    Client,
}

/// 수신 판정: agent가 있으면 Conversation, 없고 receive_message가 있으면 Client,
/// 둘 다 있으면 Conversation, 둘 다 없으면 None. 같은 표는 시험 fixture에 있다.
pub fn message_receiver(definition: &AppDefinition) -> Option<MessageReceiver> {
    if definition.agent.is_some() {
        Some(MessageReceiver::Conversation)
    } else if definition.client.as_ref().and_then(|client| client.capabilities.as_ref())
        .is_some_and(|capabilities| capabilities.contains(&ClientCapability::ReceiveMessage))
    {
        Some(MessageReceiver::Client)
    } else {
        None
    }
}
