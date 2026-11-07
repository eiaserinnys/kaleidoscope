//! PC 접근 허용 네이티브 클릭이 주 웹뷰 DOM에 도달했는지 판정한다.
//!
//! 판정은 관측기 기록만 보고 한다. 다시 클릭하거나 결과를 덮지 않는다.

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Event {
    pub kind: String,
    pub trusted: bool,
    pub on_allow_button: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Trace {
    /// 관측기가 설치되고 설치 확인까지 통과했는가.
    pub installed: bool,
    /// 클릭 전에 스냅샷을 남겼는가. 남기지 못했으면 관측기가 살아 있지 않았다.
    pub before: bool,
    /// 클릭 뒤에도 스냅샷을 남겼는가.
    pub after: bool,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// 관측기 객체가 없거나 설치/수집 단계에서 손상됐다.
    ObserverMissing,
    /// 포인터·마우스 이벤트가 하나도 없다. 네이티브 입력이 DOM에 닿지 않았다.
    NoEvents,
    /// 일부 이벤트만 도착했거나 click 없이 끝났다.
    PartialDelivery,
    /// 클릭은 있었으나 허용 버튼이 아니거나 신뢰 입력이 아니다.
    WrongTarget,
    /// 허용 버튼에 신뢰 클릭이 도착했다.
    TrustedClick,
}

const POINTER_KINDS: [&str; 5] = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

pub(crate) fn classify_pc_access_click(trace: &Trace) -> Outcome {
    if !trace.installed || !trace.before || !trace.after {
        return Outcome::ObserverMissing;
    }
    let pointer_events = trace
        .events
        .iter()
        .filter(|event| POINTER_KINDS.contains(&event.kind.as_str()))
        .count();
    if pointer_events == 0 {
        return Outcome::NoEvents;
    }
    if trace
        .events
        .iter()
        .any(|event| event.kind == "click" && event.trusted && event.on_allow_button)
    {
        return Outcome::TrustedClick;
    }
    if trace
        .events
        .iter()
        .any(|event| event.kind == "pointercancel")
    {
        return Outcome::PartialDelivery;
    }
    if trace.events.iter().any(|event| event.kind == "click") {
        return Outcome::WrongTarget;
    }
    Outcome::PartialDelivery
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: &str, trusted: bool, on_allow_button: bool) -> Event {
        Event {
            kind: kind.to_owned(),
            trusted,
            on_allow_button,
        }
    }

    fn trace(events: Vec<Event>) -> Trace {
        Trace {
            installed: true,
            before: true,
            after: true,
            events,
        }
    }

    fn trusted_click() -> Vec<Event> {
        vec![
            event("pointerdown", true, true),
            event("mousedown", true, true),
            event("pointerup", true, true),
            event("mouseup", true, true),
            event("click", true, true),
        ]
    }

    #[test]
    fn trusted_click_on_the_allow_button_is_delivered() {
        assert_eq!(
            classify_pc_access_click(&trace(trusted_click())),
            Outcome::TrustedClick
        );
    }

    #[test]
    fn missing_or_corrupted_observer_is_its_own_outcome() {
        let mut missing = trace(Vec::new());
        missing.installed = false;
        assert_eq!(classify_pc_access_click(&missing), Outcome::ObserverMissing);

        let mut corrupted = trace(trusted_click());
        corrupted.after = false;
        assert_eq!(
            classify_pc_access_click(&corrupted),
            Outcome::ObserverMissing
        );
    }

    #[test]
    fn zero_events_is_undelivered_native_input() {
        assert_eq!(
            classify_pc_access_click(&trace(Vec::new())),
            Outcome::NoEvents
        );
    }

    #[test]
    fn partial_delivery_is_not_reported_as_undelivered_input() {
        let events = vec![
            event("pointerdown", true, true),
            event("mousedown", true, true),
            event("pointercancel", true, true),
        ];
        assert_eq!(
            classify_pc_access_click(&trace(events)),
            Outcome::PartialDelivery
        );
    }

    #[test]
    fn press_and_release_without_click_is_partial_delivery() {
        let events = vec![event("mousedown", true, true), event("mouseup", true, true)];
        assert_eq!(
            classify_pc_access_click(&trace(events)),
            Outcome::PartialDelivery
        );
    }

    #[test]
    fn click_on_another_element_is_a_wrong_target() {
        let events = vec![
            event("pointerdown", true, false),
            event("mousedown", true, false),
            event("pointerup", true, false),
            event("mouseup", true, false),
            event("click", true, false),
        ];
        assert_eq!(
            classify_pc_access_click(&trace(events)),
            Outcome::WrongTarget
        );
    }

    #[test]
    fn untrusted_click_is_not_accepted_as_delivered_input() {
        let events = vec![
            event("pointerdown", false, true),
            event("mousedown", false, true),
            event("click", false, true),
        ];
        assert_eq!(
            classify_pc_access_click(&trace(events)),
            Outcome::WrongTarget
        );
    }
}
