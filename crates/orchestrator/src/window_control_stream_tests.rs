use super::*;
use kaleidoscope_contract::WindowGeometry;

#[tokio::test]
async fn only_the_supported_target_stream_receives_control_and_image_is_returned() {
    let (state, token, _) = setup();
    let mut supported = Box::pin(state.stream_with_registry("pc".into(), None, 12).unwrap());
    let mut legacy = Box::pin(state.stream_with_registry("pc".into(), None, 11).unwrap());
    let mut other = Box::pin(
        state
            .stream_with_registry("other".into(), None, 12)
            .unwrap(),
    );
    let mut events = state.0.events.subscribe();
    let task = tokio::spawn({
        let state = state.clone();
        async move {
            state
                .read_window(
                    principal(),
                    ReadWindowArgs {
                        window_id: "window".into(),
                        image: Some(true),
                    },
                )
                .await
        }
    });
    let req = next_request(&mut events, &state, "pc").await;
    let received = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let event = supported.next().await.unwrap().unwrap();
            if format!("{event:?}").contains("window.control") {
                break;
            }
        }
    })
    .await;
    assert!(received.is_ok());
    for stream in [&mut legacy, &mut other] {
        let received = tokio::time::timeout(Duration::from_millis(200), async {
            loop {
                let event = stream.next().await.unwrap().unwrap();
                if format!("{event:?}").contains("window.control") {
                    break;
                }
            }
        })
        .await;
        assert!(received.is_err());
    }
    let mut reply = response(&req, "picture-view", None, "화면");
    if let WindowControlResult::Ok { value } = &mut reply.result {
        value.after.image_base64 = Some("cG5n".into());
        value.after.geometry = Some(WindowGeometry {
            css_width: 100.0,
            css_height: 80.0,
            pixel_width: 200,
            pixel_height: 160,
        });
    }
    assert_eq!(
        post(
            &state,
            &token,
            &req.request_id,
            serde_json::to_string(&reply).unwrap()
        )
        .await,
        StatusCode::OK
    );
    let result = task.await.unwrap().unwrap();
    assert_eq!(result.image_base64.as_deref(), Some("cG5n"));
    assert_eq!(result.output.geometry.unwrap().pixel_width, 200);
}
