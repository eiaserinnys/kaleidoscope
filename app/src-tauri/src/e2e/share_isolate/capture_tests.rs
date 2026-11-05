use super::*;

#[test]
fn recording_reports_raw_peaks_and_rejects_thresholded_changes() {
    let dir = std::env::temp_dir().join(format!("ks-frame-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let phases = [
        "a-covered-by-b",
        "a-covered-by-agent",
        "a-minimized",
        "web-covered",
        "web-minimized",
        "both-covered",
        "a-visible",
        "watchdog",
    ];
    let mut csv = String::from("index,ms,different_pixels,protected_pixels,protected_raw_pixels,protected_max_delta,phase,protected_bbox,capture_start_qpc_ms,capture_end_qpc_ms\n");
    for (index, phase) in phases.iter().enumerate() {
        let (raw, delta) = if *phase == "both-covered" {
            (7, 4)
        } else {
            (0, 0)
        };
        csv.push_str(&format!(
            "{index},{index},0,0,{raw},{delta},{phase},,{}.000,{}.500\n",
            1000 + index * 10,
            1000 + index * 10
        ));
    }
    // 두 번째 프레임을 더해 같은 단계의 앞 프레임과 덮개 기록을 비교하게 한다.
    csv.push_str("8,8,0,0,0,0,both-covered,,1060.000,1060.500\n");
    fs::write(dir.join("screen-frames.csv"), &csv).unwrap();
    let mut log = File::create(dir.join("events.jsonl")).unwrap();
    assert!(wait_for_recorder(&dir, &mut log).is_ok());
    let entries = fs::read_to_string(dir.join("events.jsonl")).unwrap();
    let event: Value = serde_json::from_str(entries.lines().next().unwrap()).unwrap();
    assert_eq!(
        event["data"]["phase_peaks"]["both-covered"],
        json!({"protected_pixels":0,"protected_raw_pixels":7,"protected_max_delta":4})
    );
    let changed = csv.replace(
        "8,8,0,0,0,0,both-covered,,",
        "8,8,0,1,7,9,both-covered,12;34;15;37,",
    );
    fs::write(dir.join("screen-frames.csv"), changed).unwrap();
    fs::write(
        dir.join("cover-trace.csv"),
        "label,qpc_ms\ncover.shown,1020.000\nunfreeze.called,1058.000\ncover.destroyed,1059.000\n",
    )
    .unwrap();
    let failure = wait_for_recorder(&dir, &mut log).unwrap_err();
    assert!(failure.contains("both-covered"));
    assert!(failure.contains("frame=8"));
    assert!(failure.contains("ms=8"));
    assert!(failure.contains("12;34;15;37"));
    // 앞 프레임(1050.5)에는 덮개가 있었고 바뀐 프레임(1060)을 찍을 때는 걷혀 있었다.
    assert!(failure.contains("unchanged_until=-9.5"), "{failure}");
    assert!(failure.contains("cover_when_unchanged=up"), "{failure}");
    assert!(failure.contains("cover_at_capture=down"), "{failure}");
    assert!(failure.contains("cover.destroyed-1.0"), "{failure}");
    drop(log);
    fs::remove_dir_all(dir).unwrap();
}
