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
    let mut csv = String::from("index,ms,different_pixels,protected_pixels,protected_raw_pixels,protected_max_delta,phase,protected_bbox\n");
    for (index, phase) in phases.iter().enumerate() {
        let (raw, delta) = if *phase == "both-covered" {
            (7, 4)
        } else {
            (0, 0)
        };
        csv.push_str(&format!("{index},{index},0,0,{raw},{delta},{phase},\n"));
    }
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
        "5,5,0,0,7,4,both-covered,",
        "5,5,0,1,7,9,both-covered,12;34;15;37",
    );
    fs::write(dir.join("screen-frames.csv"), changed).unwrap();
    let failure = wait_for_recorder(&dir, &mut log).unwrap_err();
    assert!(failure.contains("both-covered"));
    assert!(failure.contains("frame=5"));
    assert!(failure.contains("ms=5"));
    assert!(failure.contains("12;34;15;37"));
    drop(log);
    fs::remove_dir_all(dir).unwrap();
}
