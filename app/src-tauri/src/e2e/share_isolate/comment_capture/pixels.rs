pub(crate) fn validate(green: usize, blue: usize, marker: usize) -> Result<(), String> {
    if green == 0 || blue != 0 || marker == 0 {
        return Err(format!(
            "unexpected pixels: green={green} blue={blue} marker={marker}"
        ));
    }
    Ok(())
}

pub(crate) fn validate_frames(rows: &[Vec<&str>]) -> Result<(), String> {
    if rows.is_empty() {
        return Err("comment capture had no recorded frames".into());
    }
    if let Some(row) = rows
        .iter()
        .find(|row| row.get(3).and_then(|v| v.parse::<usize>().ok()) != Some(0))
    {
        return Err(format!(
            "comment capture changed recorded screen; first changed bbox: {}",
            row.get(7).copied().unwrap_or("(missing)")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_missing_target_missing_marker_and_cover() {
        assert!(validate(100, 0, 10).is_ok());
        assert!(validate(0, 0, 10).is_err());
        assert!(validate(100, 1, 10).is_err());
        assert!(validate(100, 0, 0).is_err());
    }

    #[test]
    fn reports_first_changed_frame_bbox() {
        let rows = vec![
            vec!["0", "", "", "0", "", "", "comment-capture", ""],
            vec![
                "1",
                "",
                "",
                "304",
                "",
                "",
                "comment-capture",
                "913;49;973;61",
            ],
            vec!["2", "", "", "25", "", "", "comment-capture", "10;20;30;40"],
        ];
        let error = validate_frames(&rows).unwrap_err();
        assert!(error.contains("913;49;973;61"));
        assert!(!error.contains("10;20;30;40"));
        assert!(validate_frames(&rows[..1]).is_ok());
        assert!(validate_frames(&[]).is_err());
    }
}
