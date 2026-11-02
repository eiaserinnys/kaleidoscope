//! 실제 에이전트 입력 경로로 같이 보기 격리 캡처를 검증한다.
use super::*;
use kaleidoscope_core::kaleidoscope_contract::local_agent::{LocalAgentPhase, LocalAgentSnapshot};
use kaleidoscope_core::{crop_share_capture_png, WebHost};
use std::cmp::min;
use std::time::{Duration, Instant};

const A_ID: &str = "e2e-share-a";
const B_ID: &str = "e2e-share-b";
const WEB_APP_ID: &str = "e2e-share-web-browser";
const AGENT_APP_ID: &str = "e2e-share-agent";
const AGENT_ID: &str = "test-agent";
const WINDOW_READY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy)]
struct Layout {
    width: u32,
    height: u32,
    a: Rect,
    b: Rect,
    web: Rect,
    agent: Rect,
}

mod capture;
#[path = "share_isolate/native_input.rs"]
pub(super) mod native_input;
mod pixels;
mod scroll;
mod support;
use capture::*;
use scroll::*;
use support::*;

pub(super) fn scenario(
    app: &AppHandle,
    core: &Core,
    out: &Path,
    log: &mut File,
) -> Result<(), String> {
    let agent_bin = env::var_os("KALEIDOSCOPE_E2E_AGENT_BIN")
        .map(PathBuf::from)
        .ok_or("test agent bin path is missing")?;
    let work_folder = env::var_os("KALEIDOSCOPE_E2E_PICK_FOLDER")
        .map(PathBuf::from)
        .ok_or("test work folder path is missing")?;
    if !agent_bin.join("fake-agent.cmd").is_file() || !work_folder.is_dir() {
        return Err("test agent wrapper or work folder is missing".into());
    }
    let image_dir = out.join("share-isolate-images");
    fs::create_dir_all(&image_dir).map_err(|error| error.to_string())?;
    record(log, "start", json!({"scenario":"share-isolate"}))?;
    thread::sleep(Duration::from_secs(2));
    let shell = snapshot(core)?;
    let workspace = shell
        .device
        .active_workspace_id
        .ok_or("active workspace is missing")?;
    let desktop_id = shell
        .device
        .active_desktop_ids
        .get(&workspace)
        .ok_or("active desktop is missing")?
        .clone();
    let layout = query_layout(app)?;
    record(
        log,
        "viewport",
        json!({"width":layout.width,"height":layout.height,"a":layout.a,"b":layout.b,"web":layout.web,"agent":layout.agent}),
    )?;

    import_definition(
        core,
        surface_definition(A_ID, "Share Surface A", "#14d246", "A_VISIBLE_MARKER", true),
    )?;
    import_definition(
        core,
        surface_definition(
            B_ID,
            "Share Surface B",
            "rgb(25,65,225)",
            "B_COVER_MARKER",
            false,
        ),
    )?;
    import_definition(core, agent_definition(out))?;
    let mut web_browser: Value =
        serde_json::from_str(include_str!("../../../../apps/web-browser.json"))
            .map_err(|error| error.to_string())?;
    web_browser["id"] = json!(WEB_APP_ID);
    web_browser["state"]["url"] = json!("https://example.com/");
    import_definition(core, web_browser)?;
    let a_id = open_window(core, &desktop_id, A_ID, layout.a)?;
    let b_id = open_window(core, &desktop_id, B_ID, layout.b)?;
    let web_events = ui::track_web_events(core);
    let web_id = open_window(core, &desktop_id, WEB_APP_ID, layout.web)?;
    // 웹 창이 가장 앞에 있을 때 먼저 화면과 페이지를 올린다.
    ui::wait_dom(
        app,
        &format!("return !!document.querySelector('[data-testid=\\\"app-window-{WEB_APP_ID}\\\"] [data-ks-web-surface]');"),
        "web surface rendered",
    )?;
    let web_page = ui::wait_for_web_page(&web_events, &web_id, "https://example.com/")?;
    record(
        log,
        "web.loaded",
        json!({"window_id":web_id,"url":web_page.url}),
    )?;
    let agent_window_id = open_window(core, &desktop_id, AGENT_APP_ID, layout.agent)?;
    let grant = match call(
        core,
        CoreRequest::FilesPickFolder {
            window_id: agent_window_id.clone(),
            permission: "work".into(),
        },
    )? {
        CoreReply::FilesPickFolder { grant: Some(grant) } => grant,
        reply => return Err(format!("test work folder was not granted: {reply:?}")),
    };
    if Path::new(&grant.root_path)
        != fs::canonicalize(&work_folder).map_err(|error| error.to_string())?
    {
        return Err(format!("unexpected agent folder grant: {grant:?}"));
    }
    let ready = wait_agent_phase(core, &agent_window_id, LocalAgentPhase::AwaitingPermission)?;
    let spec_hash = ready
        .execution
        .as_ref()
        .ok_or("execution consent is missing")?
        .spec_hash
        .clone();
    call(
        core,
        CoreRequest::LocalAgentAllow {
            window_id: agent_window_id.clone(),
            spec_hash,
        },
    )?;
    wait_agent_phase(core, &agent_window_id, LocalAgentPhase::Ready)?;
    ui::wait_dom(app, &format!("return !!document.querySelector('[data-testid=\\\"app-window-{A_ID}\\\"] iframe') && !!document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"] textarea[aria-label=\\\"메시지\\\"]');"), "share windows rendered")?;
    share(core, &a_id, true)?;
    ui::wait_dom(
        app,
        "return !!document.querySelector('.ks-window');",
        "share view setup",
    )?;
    let a_initial = wait_share_view(&a_id, true, Some("A_VISIBLE_MARKER"))?;
    record(
        log,
        "share.initial",
        json!({"a":{"occluded":a_initial.occluded,"text_contains_marker":a_initial.text.contains("A_VISIBLE_MARKER")},"web_shared":false}),
    )?;

    // 에이전트 영역의 시험 색으로 다른 창이 섞였는지 실제 픽셀에서 식별한다.
    ui::evaluate(app, &format!("const style=document.createElement('style');style.textContent='[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"] .ks-agent-chat-history {{ background: rgb(251, 0, 251) !important; }}';document.head.appendChild(style);return true;"))?;
    start_recorder(app, out, &agent_window_id)?;
    let mut failed = false;
    let mut focus_results = Vec::<(String, bool)>::new();
    let web_over = layout.web;
    macro_rules! check {
        ($id:expr, $body:block) => {{
            let result: Result<(), String> = (|| $body)();
            let ok = result.is_ok();
            if !ok { failed = true; }
            record(log, "check.result", json!({"id":$id,"ok":ok,"message":result.err().unwrap_or_default()}))?;
        }};
    }
    check!("1-covered-b", {
        // 다른 앱 창이 덮은 A는 격리 캡처에서 파란 덮개 픽셀을 포함하지 않는다.
        raise(core, &b_id)?;
        raise(core, &agent_window_id)?;
        wait_share_view(&a_id, true, Some("A_VISIBLE_MARKER"))?;
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "covered by B",
                "a-covered-by-b",
                &mut focus_results,
                log,
            )?,
            1,
            "a-covered-by-b",
        )?;
        assert_isolated_surface(&images[0], out, "a-covered-by-b", log, true)?;

        Ok(())
    });

    check!("1-covered-agent", {
        // 에이전트 창이 A를 덮어도 프레임만 캡처되고 에이전트 표면은 섞이지 않는다.
        set_phase(app, out, &agent_window_id, "prepare-a-covered-by-agent")?;
        restore(core, &a_id)?;
        minimize(core, &b_id)?;
        set_rect(core, &a_id, layout.b)?;
        let agent_over_a = Rect {
            x: layout.b.x + 30,
            y: layout.b.y + 30,
            width: layout.b.width.saturating_sub(60),
            height: layout.b.height.saturating_sub(60),
        };
        set_agent_rect(app, core, &agent_window_id, agent_over_a)?;
        raise(core, &agent_window_id)?;
        wait_share_view(&a_id, true, Some("A_VISIBLE_MARKER"))?;
        ui::wait_dom(app, &format!("const e=document.querySelector('[data-testid=\\\"app-window-{AGENT_APP_ID}\\\"] .ks-agent-chat-history');return !!e && getComputedStyle(e).backgroundColor==='rgb(251, 0, 251)';"), "agent background fixture")?;
        let (screen, _) = shell_capture(app)?;
        let fixture = png_stats(&screen)?;
        record(
            log,
            "agent.fixture",
            json!({"background_pixels":fixture.agent_background}),
        )?;
        if fixture.agent_background == 0 {
            return Err("agent background fixture did not appear in the overlapping window".into());
        }
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "covered by sender",
                "a-covered-by-agent",
                &mut focus_results,
                log,
            )?,
            1,
            "a-covered-by-agent",
        )?;
        assert_isolated_surface(&images[0], out, "a-covered-by-agent", log, false)?;

        Ok(())
    });

    check!("2-minimized", {
        // 실제 HTML 프레임을 스크롤한 뒤 A를 최소화해 보내고 복원 후 위치를 비교한다.
        set_phase(app, out, &agent_window_id, "prepare-a-minimized")?;
        restore(core, &a_id)?;
        minimize(core, &b_id)?;
        set_agent_rect(app, core, &agent_window_id, layout.agent)?;
        raise(core, &agent_window_id)?;
        raise(core, &a_id)?;
        wait_share_view(&a_id, false, Some("A_VISIBLE_MARKER"))?;
        set_scroll_to_bottom(app, &a_id, log)?;
        minimize(core, &a_id)?;
        let minimized_view = wait_share_view(&a_id, true, Some("A_VISIBLE_MARKER"))?;
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "minimized A",
                "a-minimized",
                &mut focus_results,
                log,
            )?,
            1,
            "a-minimized",
        )?;
        assert_scrolled_surface(&images[0], out, "a-minimized", log)?;
        set_phase(app, out, &agent_window_id, "prepare-web-covered")?;
        restore(core, &a_id)?;
        ui::wait_dom(app, &format!("return document.querySelector('[data-testid=\\\"app-window-{A_ID}\\\"]')?.dataset.minimized==='false';"), "A restored")?;
        assert_restored_scroll(app, &a_id, log)?;
        let text_sent = prompt_contains(&image_dir, "minimized A", "A_VISIBLE_MARKER")?;
        record(
            log,
            "share.minimized-text",
            json!({"window_id":a_id,"view_contains_marker":minimized_view.text.contains("A_VISIBLE_MARKER"),"prompt_contains_marker":text_sent,"occluded":minimized_view.occluded,"passed":text_sent}),
        )?;
        if !text_sent {
            return Err("minimized A text did not reach the agent".into());
        }

        Ok(())
    });

    check!("3-web-covered", {
        // 자식 웹뷰는 가린 상태와 최소화 상태 모두 제 캡처를 보내고 숨김 상태로 돌아온다.
        set_phase(app, out, &agent_window_id, "prepare-web-covered")?;
        share(core, &a_id, false)?;
        share(core, &web_id, true)?;
        restore(core, &web_id)?;
        minimize(core, &a_id)?;
        set_agent_rect(app, core, &agent_window_id, web_over)?;
        raise(core, &agent_window_id)?;
        wait_share_view(&web_id, true, None)?;
        let web_started = Instant::now();
        let web_capture_mark = ui::capture_duration_mark();
        let web_request_mark = ui::mark_requests();
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "covered web",
                "web-covered",
                &mut focus_results,
                log,
            )?,
            1,
            "web-covered",
        )?;
        assert_png(&images[0], out, "web-covered", log)?;
        assert_web_capture_time(&web_id, web_capture_mark, log)?;
        record(
            log,
            "web.capture-time",
            json!({"state":"covered","elapsed_ms":web_started.elapsed().as_millis()}),
        )?;
        ensure_web_hidden_after_send(&web_id, web_request_mark, log)?;

        Ok(())
    });

    check!("3-web-minimized", {
        set_phase(app, out, &agent_window_id, "prepare-web-minimized")?;
        share(core, &a_id, false)?;
        share(core, &web_id, true)?;
        restore(core, &web_id)?;
        set_rect(
            core,
            &web_id,
            Rect {
                width: layout.web.width.saturating_sub(1),
                ..layout.web
            },
        )?;
        wait_window_rect(
            app,
            WEB_APP_ID,
            Rect {
                width: layout.web.width.saturating_sub(1),
                ..layout.web
            },
        )?;
        thread::sleep(Duration::from_millis(100));
        minimize(core, &web_id)?;
        set_agent_rect(app, core, &agent_window_id, layout.agent)?;
        raise(core, &agent_window_id)?;
        wait_share_view(&web_id, true, None)?;
        let web_started = Instant::now();
        let web_capture_mark = ui::capture_duration_mark();
        let web_request_mark = ui::mark_requests();
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "minimized web",
                "web-minimized",
                &mut focus_results,
                log,
            )?,
            1,
            "web-minimized",
        )?;
        assert_png(&images[0], out, "web-minimized", log)?;
        assert_web_capture_time(&web_id, web_capture_mark, log)?;
        record(
            log,
            "web.capture-time",
            json!({"state":"minimized","elapsed_ms":web_started.elapsed().as_millis()}),
        )?;
        ensure_web_hidden_after_send(&web_id, web_request_mark, log)?;

        Ok(())
    });

    check!("4-both-covered", {
        // 두 시각 창이 동시에 가려져도 각각 그림 한 장씩 간다.
        set_phase(app, out, &agent_window_id, "prepare-both-covered")?;
        share(core, &web_id, true)?;
        restore(core, &web_id)?;
        restore(core, &a_id)?;
        restore(core, &b_id)?;
        share(core, &a_id, true)?;
        raise(core, &a_id)?;
        wait_share_view(&a_id, false, Some("A_VISIBLE_MARKER"))?;
        set_scroll_to_bottom(app, &a_id, log)?;
        raise(core, &b_id)?;
        set_rect(
            core,
            &a_id,
            Rect {
                width: layout.b.width.saturating_sub(1),
                height: layout.b.height.saturating_sub(1),
                ..layout.b
            },
        )?;
        set_rect(
            core,
            &web_id,
            Rect {
                width: layout.web.width.saturating_sub(2),
                ..layout.web
            },
        )?;
        set_agent_rect(app, core, &agent_window_id, web_over)?;
        raise(core, &agent_window_id)?;
        share(core, &a_id, true)?;
        wait_share_view(&a_id, true, Some("A_VISIBLE_MARKER"))?;
        wait_share_view(&web_id, true, None)?;
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "two covered targets",
                "both-covered",
                &mut focus_results,
                log,
            )?,
            2,
            "both-covered",
        )?;
        let (_, first_stats) = decode_image(&images[0], out, "both-covered-first")?;
        let (_, second_stats) = decode_image(&images[1], out, "both-covered-second")?;
        record(
            log,
            "share.two-stats",
            json!({
                "first":{"width":first_stats.width,"height":first_stats.height,"green":first_stats.green,"red":first_stats.red,"blue":first_stats.blue,"agent_background":first_stats.agent_background},
                "second":{"width":second_stats.width,"height":second_stats.height,"green":second_stats.green,"red":second_stats.red,"blue":second_stats.blue,"agent_background":second_stats.agent_background}
            }),
        )?;
        let first_pixels = (first_stats.width as usize)
            .saturating_mul(first_stats.height as usize)
            .max(1);
        let second_pixels = (second_stats.width as usize)
            .saturating_mul(second_stats.height as usize)
            .max(1);
        let first_a = first_stats.green * 100 >= first_pixels * 60
            || first_stats.red * 100 >= first_pixels * 60;
        let second_a = second_stats.green * 100 >= second_pixels * 60
            || second_stats.red * 100 >= second_pixels * 60;
        if first_a == second_a {
            return Err(
                "two covered captures did not contain exactly one A image and one web image".into(),
            );
        }
        let a_stats = if first_a { first_stats } else { second_stats };
        if a_stats.blue != 0
            || a_stats.agent_background != 0
            || a_stats.red * 100 < (a_stats.width as usize * a_stats.height as usize) * 60
        {
            return Err(format!(
                "A image is not the scrolled isolated surface: {a_stats:?}"
            ));
        }
        record(
            log,
            "share.two-captures",
            json!({"a_image":"green or red scrolled surface","a_green_pixels":a_stats.green,"a_red_pixels":a_stats.red,"a_blue_pixels":a_stats.blue,"passed":true}),
        )?;

        Ok(())
    });

    check!("8-visible", {
        // 가려지지 않은 A는 기존 캡처 경로를 쓰고 격리 고정 명령을 부르지 않는다.
        set_phase(app, out, &agent_window_id, "prepare-visible")?;
        share(core, &web_id, false)?;
        restore(core, &a_id)?;
        share(core, &a_id, true)?;
        set_rect(
            core,
            &a_id,
            Rect {
                width: layout.b.width.saturating_sub(2),
                height: layout.b.height.saturating_sub(2),
                ..layout.b
            },
        )?;
        minimize(core, &b_id)?;
        set_agent_rect(app, core, &agent_window_id, layout.agent)?;
        raise(core, &agent_window_id)?;
        raise(core, &a_id)?;
        wait_share_view(&a_id, false, Some("A_VISIBLE_MARKER"))?;
        set_scroll_to_top(app, &a_id, log)?;
        let request_mark = ui::mark_requests();
        let images = expect_images(
            send_prompt(
                app,
                core,
                out,
                &image_dir,
                &agent_window_id,
                "visible A",
                "a-visible",
                &mut focus_results,
                log,
            )?,
            1,
            "a-visible",
        )?;
        assert_isolated_surface(&images[0], out, "a-visible", log, true)?;
        if ui::requests_since(request_mark)
            .iter()
            .any(|request| matches!(request, CoreRequest::ShareFreeze {}))
        {
            return Err("visible target unexpectedly called share.freeze".into());
        }
        record(
            log,
            "share.no-target-freeze",
            json!({"freeze_called":false,"passed":true}),
        )?;

        Ok(())
    });

    check!("7-watchdog", {
        // 고정을 풀지 않은 경우에도 5초 타이머가 덮개를 없앤다.
        set_phase(app, out, &agent_window_id, "watchdog")?;
        match call(core, CoreRequest::ShareFreeze {})? {
            CoreReply::ShareFreeze { frozen: true } => {}
            reply => return Err(format!("native watchdog freeze did not start: {reply:?}")),
        }
        if !cover_active(app)? {
            return Err("freeze cover was not visible before watchdog expiry".into());
        }
        thread::sleep(Duration::from_millis(5_500));
        if cover_active(app)? {
            return Err("freeze cover remained after the five-second watchdog".into());
        }
        record(
            log,
            "share.watchdog",
            json!({"visible_before":true,"visible_after":false,"waited_ms":5500,"passed":true}),
        )?;

        Ok(())
    });

    // 녹화기는 중간에 실패한 단계가 있어도 종료하고 판정 근거를 저장한다.
    fs::write(out.join("record.stop"), b"").map_err(|error| error.to_string())?;
    check!("5-flicker", { wait_for_recorder(out, log) });
    check!("6-focus", {
        if focus_results.len() != 7 || focus_results.iter().any(|(_, ok)| !ok) {
            Err(format!(
                "focus was verified for {} of 7 sends: {focus_results:?}",
                focus_results.len()
            ))
        } else {
            Ok(())
        }
    });
    record(
        log,
        "complete",
        json!({"scenario":"share-isolate","passed":!failed}),
    )?;
    if failed {
        Err("one or more isolated capture checks failed".into())
    } else {
        Ok(())
    }
}

fn ensure_web_hidden_after_send(
    window_id: &str,
    mark: usize,
    log: &mut File,
) -> Result<(), String> {
    let requests = ui::requests_since(mark);
    let latest = requests.iter().rev().find(
        |request| matches!(request, CoreRequest::WebPlace { window_id: id, .. } if id == window_id),
    );
    if !matches!(latest, Some(CoreRequest::WebPlace { bounds: None, .. })) {
        return Err(format!(
            "web child view {window_id} was not hidden after send: {latest:?}"
        ));
    }
    record(
        log,
        "web.hidden-after-send",
        json!({"window_id":window_id,"hidden":true,"passed":true}),
    )
}

fn assert_web_capture_time(window_id: &str, mark: usize, log: &mut File) -> Result<(), String> {
    let captures = ui::capture_durations_since(mark);
    let elapsed = captures
        .iter()
        .find(|(id, _)| id == window_id)
        .map(|(_, elapsed)| *elapsed)
        .ok_or_else(|| format!("share.capture duration is missing for {window_id}"))?;
    record(
        log,
        "web.capture-duration",
        json!({"window_id":window_id,"elapsed_ms":elapsed,"passed":elapsed <= 2000}),
    )?;
    if elapsed > 2_000 {
        return Err(format!(
            "web share.capture exceeded two seconds: {elapsed} ms"
        ));
    }
    record(
        log,
        "web.capture-duration",
        json!({"window_id":window_id,"elapsed_ms":elapsed,"passed":true}),
    )
}
