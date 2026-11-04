use kaleidoscope_contract::data::Binding;
use serde_json::json;

#[test]
fn 배열과_스칼라와_여러_키_객체는_리터럴이다() {
    for value in [json!(["2026-12-25"]), json!(["x"]), json!("x"), json!(1), json!(true), json!(null), json!({"state":"x","other":1})] {
        let binding: Binding = serde_json::from_value(value.clone()).unwrap();
        assert!(matches!(&binding, Binding::Literal(literal) if literal == &value), "{value}: {binding:?}");
        assert_eq!(serde_json::to_value(binding).unwrap(), value);
    }
}

#[test]
fn 한_키_객체의_참조와_직렬화는_유지한다() {
    for (value, kind) in [(json!({"state":"x"}), "state"), (json!({"expr":"x"}), "expr"), (json!({"client":"x"}), "client"), (json!({"item":"x"}), "item"), (json!({"parent_item":"x"}), "parent_item"), (json!({"message":{"item":"k"}}), "message")] {
        let binding: Binding = serde_json::from_value(value.clone()).unwrap();
        let actual = match &binding { Binding::State(_) => "state", Binding::Expr(_) => "expr", Binding::Client(_) => "client", Binding::Item(_) => "item", Binding::ParentItem(_) => "parent_item", Binding::Message(_) => "message", Binding::Literal(_) => "literal" };
        assert_eq!(actual, kind);
        assert_eq!(serde_json::to_value(binding).unwrap(), value);
    }
}
