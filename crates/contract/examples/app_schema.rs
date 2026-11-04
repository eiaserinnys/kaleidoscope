use std::io::{self, Write};

fn main() -> io::Result<()> {
    let schema = kaleidoscope_contract::app_definition_schema();
    let output = serde_json::to_string_pretty(&schema)? + "\n";
    match io::stdout().lock().write_all(output.as_bytes()) {
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Ok(()),
        result => result,
    }
}
