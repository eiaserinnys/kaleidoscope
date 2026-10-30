use super::*;
use kaleidoscope_contract::{
    registry::{ConnectionInfo, ConnectionKind, DeviceEvent},
    validate::valid_request_path,
    PermissionDecl,
};
use reqwest::{header::HeaderName, header::HeaderValue, Url};
use std::collections::BTreeMap;

#[derive(Clone)]
pub(super) struct ConnectionRecord {
    pub(super) info: ConnectionInfo,
    pub(super) headers: BTreeMap<String, String>,
    description: String,
}

pub(super) struct ConnectionRegistration {
    pub name: String,
    pub kind: ConnectionKind,
    pub base_url: String,
    pub description: Option<String>,
    pub writable: Option<bool>,
    pub paths: Option<Vec<String>>,
    pub headers: Option<BTreeMap<String, String>>,
    pub issuer: Option<String>,
    pub scopes: Option<String>,
    pub resource: Option<String>,
}

impl AppState {
    pub(super) fn set_connection(
        &self,
        mut input: ConnectionRegistration,
    ) -> Result<(ConnectionInfo, Vec<String>), CoreError> {
        validate_registration(&input)?;
        input.base_url = input.base_url.trim_end_matches('/').to_string();

        let old = self.connection(&input.name)?;
        let headers = input.headers.unwrap_or_else(|| {
            if input.kind == ConnectionKind::Relay
                && old
                    .as_ref()
                    .is_some_and(|record| record.info.kind == ConnectionKind::Relay)
            {
                old.map(|record| record.headers).unwrap_or_default()
            } else {
                BTreeMap::new()
            }
        });
        let mut header_names: Vec<_> = headers.keys().cloned().collect();
        header_names.sort();
        let header_json = serde_json::to_string(&headers)
            .map_err(|_| server_error("연결을 저장할 수 없습니다."))?;
        let description = input.description.unwrap_or_default();
        let paths = input.paths.unwrap_or_default();
        let paths_json = serde_json::to_string(&paths)
            .map_err(|_| server_error("연결을 저장할 수 없습니다."))?;
        let info = ConnectionInfo {
            name: input.name,
            kind: input.kind,
            base_url: input.base_url,
            writable: input.writable.unwrap_or(false),
            paths,
            issuer: input.issuer,
            scopes: input.scopes,
            resource: input.resource,
        };
        let kind = match info.kind {
            ConnectionKind::Relay => "relay",
            ConnectionKind::Oauth => "oauth",
        };
        self.lock_db()?
            .execute(
                "INSERT INTO connections(name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(name) DO UPDATE SET kind=excluded.kind,base_url=excluded.base_url,writable=excluded.writable,paths=excluded.paths,headers=excluded.headers,issuer=excluded.issuer,scopes=excluded.scopes,resource=excluded.resource,description=excluded.description,updated_at=excluded.updated_at",
                params![
                    info.name,
                    kind,
                    info.base_url,
                    info.writable,
                    paths_json,
                    header_json,
                    info.issuer,
                    info.scopes,
                    info.resource,
                    description,
                    timestamp()
                ],
            )
            .map_err(db_error)?;
        self.broadcast_connections()?;
        Ok((info, header_names))
    }

    pub(super) fn list_connections(
        &self,
    ) -> Result<Vec<(ConnectionInfo, Vec<String>, String)>, CoreError> {
        self.connection_records().map(|records| {
            records
                .into_iter()
                .map(|record| {
                    let mut names: Vec<_> = record.headers.keys().cloned().collect();
                    names.sort();
                    (record.info, names, record.description)
                })
                .collect()
        })
    }

    pub(super) fn delete_connection(&self, name: &str) -> Result<bool, CoreError> {
        let deleted = self
            .lock_db()?
            .execute("DELETE FROM connections WHERE name=?1", [name])
            .map_err(db_error)?;
        if deleted > 0 {
            self.broadcast_connections()?;
        }
        Ok(deleted > 0)
    }

    pub(super) fn connection(&self, name: &str) -> Result<Option<ConnectionRecord>, CoreError> {
        let db = self.lock_db()?;
        let row: Option<(String, String, bool, String, String, Option<String>, Option<String>, Option<String>, String)> = db
            .query_row(
                "SELECT kind,base_url,writable,paths,headers,issuer,scopes,resource,description FROM connections WHERE name=?1",
                [name],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?)),
            )
            .optional()
            .map_err(db_error)?;
        row.map(
            |(kind, base_url, writable, paths, headers, issuer, scopes, resource, description)| {
                let kind = parse_kind(&kind)?;
                let paths = serde_json::from_str(&paths)
                    .map_err(|_| server_error("연결 경로 설정을 읽을 수 없습니다."))?;
                let headers = serde_json::from_str(&headers)
                    .map_err(|_| server_error("연결 헤더 설정을 읽을 수 없습니다."))?;
                Ok(ConnectionRecord {
                    info: ConnectionInfo {
                        name: name.into(),
                        kind,
                        base_url,
                        writable,
                        paths,
                        issuer,
                        scopes,
                        resource,
                    },
                    headers,
                    description,
                })
            },
        )
        .transpose()
    }

    fn connection_records(&self) -> Result<Vec<ConnectionRecord>, CoreError> {
        let db = self.lock_db()?;
        let mut statement = db
            .prepare("SELECT name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description FROM connections ORDER BY name")
            .map_err(db_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                ))
            })
            .map_err(db_error)?;
        rows.map(|row| {
            let (
                name,
                kind,
                base_url,
                writable,
                paths,
                headers,
                issuer,
                scopes,
                resource,
                description,
            ) = row.map_err(db_error)?;
            Ok(ConnectionRecord {
                info: ConnectionInfo {
                    name,
                    kind: parse_kind(&kind)?,
                    base_url,
                    writable,
                    paths: serde_json::from_str(&paths)
                        .map_err(|_| server_error("연결 경로 설정을 읽을 수 없습니다."))?,
                    issuer,
                    scopes,
                    resource,
                },
                headers: serde_json::from_str(&headers)
                    .map_err(|_| server_error("연결 헤더 설정을 읽을 수 없습니다."))?,
                description,
            })
        })
        .collect()
    }

    pub(super) fn connection_snapshot(&self) -> Result<Vec<ConnectionInfo>, CoreError> {
        self.connection_records()
            .map(|records| records.into_iter().map(|record| record.info).collect())
    }

    fn broadcast_connections(&self) -> Result<(), CoreError> {
        self.send_event(DeviceEvent::ConnectionsSnapshot {
            connections: self.connection_snapshot()?,
        });
        Ok(())
    }

    fn connection_names(&self) -> Result<std::collections::HashSet<String>, CoreError> {
        Ok(self
            .connection_records()?
            .into_iter()
            .map(|record| record.info.name)
            .collect())
    }

    pub(super) fn missing_app_connections(
        &self,
        definition: &AppDefinition,
    ) -> Result<Vec<String>, CoreError> {
        let known = self.connection_names()?;
        let mut missing: Vec<_> = definition
            .permissions
            .iter()
            .filter_map(|permission| match permission {
                PermissionDecl::Connection { connection, .. } if !known.contains(connection) => {
                    Some(connection.clone())
                }
                _ => None,
            })
            .collect();
        missing.sort();
        missing.dedup();
        Ok(missing)
    }

    pub(super) fn missing_app_connections_from_json(
        &self,
        definition_json: &str,
    ) -> Result<Vec<String>, CoreError> {
        let definition = parse_app_definition(definition_json)?;
        self.missing_app_connections(&definition)
    }
}

fn validate_registration(input: &ConnectionRegistration) -> Result<(), CoreError> {
    if !valid_connection_name(&input.name)
        || !valid_base_url(&input.base_url)
        || input
            .paths
            .as_ref()
            .is_some_and(|paths| paths.iter().any(|path| !valid_request_path(path)))
    {
        return Err(CoreError::new(ErrorCode::InvalidRequest));
    }
    match input.kind {
        ConnectionKind::Relay
            if input.issuer.is_some() || input.scopes.is_some() || input.resource.is_some() =>
        {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        ConnectionKind::Oauth if input.headers.is_some() => {
            return Err(CoreError::new(ErrorCode::InvalidRequest));
        }
        _ => {}
    }
    if let Some(headers) = &input.headers {
        for (name, value) in headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| CoreError::new(ErrorCode::InvalidRequest))?;
            if matches!(
                name.as_str(),
                "host" | "content-length" | "connection" | "transfer-encoding"
            ) || HeaderValue::from_str(value).is_err()
            {
                return Err(CoreError::new(ErrorCode::InvalidRequest));
            }
        }
    }
    Ok(())
}

fn valid_connection_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_base_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let scheme_allowed = url.scheme() == "https"
        || (url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost")));
    scheme_allowed
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none()
}

fn parse_kind(value: &str) -> Result<ConnectionKind, CoreError> {
    match value {
        "relay" => Ok(ConnectionKind::Relay),
        "oauth" => Ok(ConnectionKind::Oauth),
        _ => Err(server_error("연결 종류를 읽을 수 없습니다.")),
    }
}
