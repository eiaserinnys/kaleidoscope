use super::*;
use kaleidoscope_contract::{
    errors,
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

        let account_id = self.mcp_account_id()?;
        let old = self.connection_for_account(&account_id, &input.name)?;
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
        if headers.values().any(|value| value.contains("${env:")) {
            return Err(errors::CONN_SETTING_HEADER_REFERENCE());
        }
        let mut header_names: Vec<_> = headers.keys().cloned().collect();
        header_names.sort();
        let header_json =
            serde_json::to_string(&headers).map_err(|_| errors::CONN_SETTING_SERIALIZE_FAILED())?;
        let description = input.description.unwrap_or_default();
        let paths = input.paths.unwrap_or_default();
        let paths_json =
            serde_json::to_string(&paths).map_err(|_| errors::CONN_SETTING_SERIALIZE_FAILED())?;
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
                "INSERT INTO connections(account_id,name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(account_id,name) DO UPDATE SET kind=excluded.kind,base_url=excluded.base_url,writable=excluded.writable,paths=excluded.paths,headers=excluded.headers,issuer=excluded.issuer,scopes=excluded.scopes,resource=excluded.resource,description=excluded.description,updated_at=excluded.updated_at",
                params![
                    account_id,
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
            .map_err(|error| db_error_with(error, kaleidoscope_contract::errors::CONN_SETTING_SAVE_DATABASE_FAILED(&info.name)))?;
        self.broadcast_connections()?;
        Ok((info, header_names))
    }

    pub(super) fn list_connections(
        &self,
    ) -> Result<Vec<(ConnectionInfo, Vec<String>, String)>, CoreError> {
        let account_id = self.mcp_account_id()?;
        self.connection_records(&account_id).map(|records| {
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
        let account_id = self.mcp_account_id()?;
        let deleted = self
            .lock_db()?
            .execute(
                "DELETE FROM connections WHERE account_id=?1 AND name=?2",
                params![account_id, name],
            )
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::CONN_SETTING_DELETE_DATABASE_FAILED(name),
                )
            })?;
        if deleted > 0 {
            self.broadcast_connections()?;
        }
        Ok(deleted > 0)
    }

    pub(super) fn connection(&self, name: &str) -> Result<Option<ConnectionRecord>, CoreError> {
        let account_id = self.mcp_account_id()?;
        self.connection_for_account(&account_id, name)
    }

    pub(super) fn connection_for_account(
        &self,
        account_id: &str,
        name: &str,
    ) -> Result<Option<ConnectionRecord>, CoreError> {
        let db = self.lock_db()?;
        let row: Option<(String, String, bool, String, String, Option<String>, Option<String>, Option<String>, String)> = db
            .query_row(
                "SELECT kind,base_url,writable,paths,headers,issuer,scopes,resource,description FROM connections WHERE account_id=?1 AND name=?2",
                params![account_id, name],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?)),
            )
            .optional()
            .map_err(|error| db_error_with(error, kaleidoscope_contract::errors::CONN_SETTING_READ_DATABASE_FAILED(name)))?;
        row.map(
            |(kind, base_url, writable, paths, headers, issuer, scopes, resource, description)| {
                let kind = parse_kind(&kind)?;
                let paths = serde_json::from_str(&paths)
                    .map_err(|_| errors::CONN_SETTING_PATHS_INVALID())?;
                let headers = serde_json::from_str(&headers)
                    .map_err(|_| errors::CONN_SETTING_HEADERS_INVALID())?;
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

    fn connection_records(&self, account_id: &str) -> Result<Vec<ConnectionRecord>, CoreError> {
        let db = self.lock_db()?;
        let mut statement = db
            .prepare("SELECT name,kind,base_url,writable,paths,headers,issuer,scopes,resource,description FROM connections WHERE account_id=?1 ORDER BY name")
            .map_err(|error| db_error_with(error, kaleidoscope_contract::errors::CONN_SETTING_LIST_DATABASE_FAILED()))?;
        let rows = statement
            .query_map([account_id], |row| {
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
            .map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::CONN_SETTING_LIST_DATABASE_FAILED(),
                )
            })?;
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
            ) = row.map_err(|error| {
                db_error_with(
                    error,
                    kaleidoscope_contract::errors::CONN_SETTING_LIST_DATABASE_FAILED(),
                )
            })?;
            Ok(ConnectionRecord {
                info: ConnectionInfo {
                    name,
                    kind: parse_kind(&kind)?,
                    base_url,
                    writable,
                    paths: serde_json::from_str(&paths)
                        .map_err(|_| errors::CONN_SETTING_LIST_PATHS_INVALID())?,
                    issuer,
                    scopes,
                    resource,
                },
                headers: serde_json::from_str(&headers)
                    .map_err(|_| errors::CONN_SETTING_LIST_HEADERS_INVALID())?,
                description,
            })
        })
        .collect()
    }

    pub(super) fn connection_snapshot(&self) -> Result<Vec<ConnectionInfo>, CoreError> {
        let account_id = self.mcp_account_id()?;
        self.connection_records(&account_id)
            .map(|records| records.into_iter().map(|record| record.info).collect())
    }

    pub(super) fn connection_snapshot_for_device(
        &self,
        device_id: &str,
    ) -> Result<Vec<ConnectionInfo>, CoreError> {
        let account_id = self.device_account_id(device_id)?;
        self.connection_records(&account_id)
            .map(|records| records.into_iter().map(|record| record.info).collect())
    }

    fn broadcast_connections(&self) -> Result<(), CoreError> {
        self.send_event(DeviceEvent::ConnectionsSnapshot {
            connections: self.connection_snapshot()?,
        });
        Ok(())
    }

    fn connection_names(&self) -> Result<std::collections::HashSet<String>, CoreError> {
        let account_id = self.mcp_account_id()?;
        Ok(self
            .connection_records(&account_id)?
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
    if !valid_connection_name(&input.name) {
        return Err(errors::CONN_SETTING_NAME_INVALID());
    }
    if !valid_base_url(&input.base_url) {
        return Err(errors::CONN_SETTING_URL_INVALID());
    }
    if input
        .paths
        .as_ref()
        .is_some_and(|paths| paths.iter().any(|path| !valid_request_path(path)))
    {
        return Err(errors::CONN_SETTING_PATH_INVALID());
    }
    match input.kind {
        ConnectionKind::Relay
            if input.issuer.is_some() || input.scopes.is_some() || input.resource.is_some() =>
        {
            return Err(errors::CONN_SETTING_RELAY_OAUTH_FIELDS_INVALID());
        }
        ConnectionKind::Oauth if input.headers.is_some() => {
            return Err(errors::CONN_SETTING_OAUTH_HEADERS_INVALID());
        }
        _ => {}
    }
    if let Some(headers) = &input.headers {
        for (name, value) in headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| errors::CONN_SETTING_HEADER_NAME_INVALID())?;
            if matches!(
                name.as_str(),
                "host" | "content-length" | "connection" | "transfer-encoding"
            ) {
                return Err(errors::CONN_SETTING_HEADER_RESERVED());
            }
            if HeaderValue::from_str(value).is_err() {
                return Err(errors::CONN_SETTING_HEADER_VALUE_INVALID());
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
        _ => Err(errors::CONN_SETTING_KIND_INVALID()),
    }
}
