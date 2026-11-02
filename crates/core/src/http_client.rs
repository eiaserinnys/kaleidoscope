use kaleidoscope_contract::{errors, CoreError};
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
            .map_err(|error| error.without_url().to_string())
    }) {
        Ok(client) => Ok(client),
        Err(message) => {
            Err(errors::DATA_HTTP_CLIENT_BUILD_FAILED().and_details(vec![message.clone()]))
        }
    }
}
