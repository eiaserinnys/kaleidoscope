pub(crate) fn validate(green: usize, blue: usize, marker: usize) -> Result<(), String> {
    if green == 0 || blue != 0 || marker == 0 {
        return Err(format!(
            "unexpected pixels: green={green} blue={blue} marker={marker}"
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
}
