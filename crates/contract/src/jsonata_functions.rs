//! JSONata 평가기의 URL 인코딩을 JavaScript 표준과 맞춘다.
use jsonata_core::{
    evaluator::{Evaluator, EvaluatorError},
    functions::FunctionError,
    value::JValue,
};
use std::fmt::Write;

/// 앱 식을 계산하는 모든 평가기에 같은 함수를 등록한다.
pub fn install_standard_functions(evaluator: &mut Evaluator) {
    for (name, uri) in [("encodeUrlComponent", false), ("encodeUrl", true)] {
        evaluator
            .register_fn_override(name, move |args: &[JValue]| encode_url(args, name, uri))
            .expect("URL 인코딩 함수 등록");
    }
}

fn encode_url(args: &[JValue], name: &str, uri: bool) -> Result<JValue, EvaluatorError> {
    if args.is_empty() {
        return Err(
            FunctionError::ArgumentError(format!("${name}에 인코딩할 글을 인자로 주세요")).into(),
        );
    }
    let value = match &args[0] {
        JValue::String(value) => value,
        JValue::Undefined => return Ok(JValue::Undefined),
        _ => {
            return Err(EvaluatorError::TypeError(
                "T0410: Argument 1 must be String".into(),
            ))
        }
    };
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric()
            || b"-_.!~*'()".contains(byte)
            || (uri && b";,/?:@&=+$#".contains(byte))
        {
            encoded.push(*byte as char);
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("문자열 인코딩");
        }
    }
    Ok(JValue::string(encoded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonata_core::parser;
    use serde_json::{json, Value};

    fn evaluate(expression: &str) -> Result<Value, String> {
        let ast = parser::parse(expression).unwrap();
        let mut evaluator = Evaluator::new();
        install_standard_functions(&mut evaluator);
        evaluator
            .evaluate(&ast, &JValue::Null)
            .map(|value| Value::from(&value))
            .map_err(|error| error.to_string())
    }

    #[test]
    fn component_as_map_callback() {
        assert_eq!(
            evaluate("$map(['a-b','a b'], $encodeUrlComponent)").unwrap(),
            json!(["a-b", "a%20b"])
        );
    }

    #[test]
    fn uri_as_map_callback() {
        assert_eq!(
            evaluate("$map(['https://x.test/a b?q=1','https://x.test/c d'], $encodeUrl)").unwrap(),
            json!(["https://x.test/a%20b?q=1", "https://x.test/c%20d"])
        );
    }

    #[test]
    fn no_argument_reports_what_to_supply() {
        for name in ["encodeUrlComponent", "encodeUrl"] {
            let error = evaluate(&format!("${name}()")).unwrap_err();
            assert!(
                error.contains(&format!("${name}에 인코딩할 글을 인자로 주세요")),
                "{error}"
            );
        }
    }
}
