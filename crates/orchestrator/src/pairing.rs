use super::*;

impl AppState {
    async fn clear_expired_pairings(&self) {
        let now = Utc::now().timestamp();
        self.0
            .pairings
            .lock()
            .await
            .retain(|_, p| p.expires_at_unix > now);
    }

    pub(super) async fn start_pairing(
        &self,
        device_name: String,
    ) -> Result<PairStartReply, (StatusCode, CoreError)> {
        let device_name = device_name.trim().to_string();
        if !(1..=100).contains(&device_name.chars().count()) {
            return Err((
                StatusCode::BAD_REQUEST,
                CoreError::with_details(
                    ErrorCode::InvalidRequest,
                    vec!["기기 이름은 1~100자여야 합니다".into()],
                ),
            ));
        }
        self.clear_expired_pairings().await;
        let mut pairings = self.0.pairings.lock().await;
        if pairings.values().filter(|p| p.approved.is_none()).count()
            >= registry::PAIRING_MAX_PENDING
        {
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                server_error("승인 대기 중인 연결이 너무 많습니다."),
            ));
        }
        let (device_code, user_code) = loop {
            let device_code = random_token();
            let code = random_user_code();
            if !pairings.values().any(|p| p.user_code == code) {
                break (device_code, code);
            }
        };
        let expires_at = Utc::now() + chrono::Duration::seconds(registry::PAIRING_TTL_SECS as i64);
        let expires_at = expires_at.to_rfc3339_opts(SecondsFormat::Secs, true);
        pairings.insert(
            device_code.clone(),
            Pairing {
                device_name,
                user_code: user_code.clone(),
                expires_at_unix: Utc::now().timestamp() + registry::PAIRING_TTL_SECS as i64,
                approved: None,
            },
        );
        Ok(PairStartReply {
            device_code,
            user_code,
            expires_at,
            interval_secs: registry::PAIRING_POLL_INTERVAL_SECS,
        })
    }

    pub(super) async fn poll_pairing(
        &self,
        device_code: &str,
    ) -> Result<PairPollReply, (StatusCode, CoreError)> {
        self.clear_expired_pairings().await;
        let mut pairings = self.0.pairings.lock().await;
        let Some(pairing) = pairings.get(device_code).cloned() else {
            return Err((
                StatusCode::NOT_FOUND,
                server_error("연결 코드가 없거나 만료되었습니다."),
            ));
        };
        if let Some((device_id, token)) = pairing.approved {
            pairings.remove(device_code);
            return Ok(PairPollReply::Approved { device_id, token });
        }
        Ok(PairPollReply::Pending {})
    }

    pub(super) async fn approve_pairing(&self, code: &str) -> Result<(String, String), CoreError> {
        self.clear_expired_pairings().await;
        let normalized: String = code
            .chars()
            .filter(|c| *c != '-' && !c.is_whitespace())
            .flat_map(char::to_uppercase)
            .collect();
        let mut pairings = self.0.pairings.lock().await;
        let Some((device_code, pairing)) = pairings
            .iter()
            .find(|(_, p)| p.user_code.replace('-', "") == normalized)
            .map(|(k, v)| (k.clone(), v.clone()))
        else {
            return Err(server_error(
                "코드가 없거나 만료되었습니다. 쉘에서 연결을 다시 시작하게 하세요.",
            ));
        };
        let id = Uuid::new_v4().to_string();
        let token = random_token();
        let now = timestamp();
        let account_id = self.mcp_account_id()?;
        self.lock_db()?
            .execute(
                "INSERT INTO devices(id,name,account_id,token_sha256,created_at) VALUES(?1,?2,?3,?4,?5)",
                params![id, pairing.device_name, account_id, sha256_hex(token.as_bytes()), now],
            )
            .map_err(db_error)?;
        if let Some(entry) = pairings.get_mut(&device_code) {
            entry.approved = Some((id.clone(), token));
        }
        Ok((id, pairing.device_name))
    }
}
