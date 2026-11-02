use crate::error;
use kaleidoscope_contract::{CoreError, ErrorCode};
use reqwest::blocking::Client;
use std::sync::OnceLock;
use std::time::Duration;

static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

pub(crate) fn shared() -> Result<&'static Client, CoreError> {
    match CLIENT.get_or_init(|| {
        Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(None)
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(client) => Ok(client),
        Err(message) => Err(error::with_message(ErrorCode::Server, message)),
    }
}
