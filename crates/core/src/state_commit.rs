//! 상태 변경 확정 절차: 이전 상태 복사 → 변경 → 저장 → 실패 시 복구 → 이벤트 생성.
//!
//! 로컬 조작, 레지스트리 사건, 서버 배치 반영이 같은 절차를 쓰고, 저장 정책과
//! 이벤트 생성 조건만 [`ChangeOrigin`]으로 고른다. 이벤트를 내보내는 일은
//! 호출부에 남긴다.

use crate::state_events::StateEvent;
use crate::{sync_state, web, CoreError, CoreState, Inner};

/// 상태 변경의 출처. 출처마다 저장 방식과 이벤트 생성 조건이 다르다.
#[derive(Clone, Copy)]
pub(crate) enum ChangeOrigin {
    /// 사용자 조작으로 생긴 이 기기의 변경. `debounced`면 저장을 미뤄 합친다.
    Local { debounced: bool },
    /// 레지스트리가 보낸 앱과 코멘트 같은 변경. 곧바로 저장한다.
    Registry,
    /// 서버가 보낸 창 배치. 곧바로 저장하고 바뀐 탐색을 서버에 알린다.
    ServerLayout,
}

/// 상태 잠금을 잡고 `update`를 적용한 뒤 저장하고, 이벤트를 만들어 돌려준다.
///
/// `update`가 실패하면 상태를 이전 값으로 되돌리고 그 오류를 돌려준다. 저장이
/// 실패해도 상태를 되돌린다. 두 경우 모두 이벤트를 만들지 않는다.
pub(crate) fn commit<T>(
    inner: &Inner,
    origin: ChangeOrigin,
    update: impl FnOnce(&mut CoreState) -> Result<T, CoreError>,
) -> Result<(T, Option<StateEvent>), CoreError> {
    let mut state = inner.state.lock().unwrap();
    let before = state.clone();
    let result = match update(&mut state) {
        Ok(result) => result,
        Err(error) => {
            *state = before;
            return Err(error);
        }
    };
    let local = matches!(origin, ChangeOrigin::Local { .. });
    if local {
        sync_state::mark_local_changes(inner, &before.shared, &mut state);
    }
    let shared_changed = before.shared != state.shared;
    let device_changed = before.device != state.device;
    let sync_changed = before.sync != state.sync;
    let link_changed = before.link != state.link;

    if shared_changed || device_changed || sync_changed {
        match origin {
            ChangeOrigin::Local { debounced: true } => inner.flusher.schedule(
                shared_changed,
                device_changed,
                sync_changed,
                &inner.profiler,
            ),
            _ => {
                if let Err(error) =
                    inner.save_state_locked(&state, shared_changed, device_changed, sync_changed)
                {
                    *state = before;
                    return Err(error);
                }
            }
        }
    }

    if matches!(origin, ChangeOrigin::ServerLayout) && shared_changed {
        web::record_server_navigation(inner, &before, &state);
    }

    let event = (local || shared_changed || device_changed || link_changed)
        .then(|| inner.state_event_locked(&state));

    drop(state);
    web::detach_removed(inner);
    Ok((result, event))
}
