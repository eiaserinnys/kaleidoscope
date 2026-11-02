#[derive(Debug, Default)]
pub(super) struct PixelStats {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) green: usize,
    pub(super) blue: usize,
    pub(super) red: usize,
    pub(super) agent_background: usize,
    pub(super) green_bounds: Option<(u32, u32, u32, u32)>,
    pub(super) red_bounds: Option<(u32, u32, u32, u32)>,
}

impl PixelStats {
    pub(super) fn count(&mut self, x: u32, y: u32, [r, g, b, _]: [u8; 4]) {
        if [r, g, b] == [251, 0, 251] {
            self.agent_background += 1;
        }
        if [r, g, b] == [20, 210, 70] {
            self.green += 1;
            extend(&mut self.green_bounds, x, y);
        }
        if [r, g, b] == [25, 65, 225] {
            self.blue += 1;
        }
        if [r, g, b] == [230, 35, 65] {
            self.red += 1;
            extend(&mut self.red_bounds, x, y);
        }
    }

    pub(super) fn validate(&self, red: bool, reject_blue: bool) -> Result<(), String> {
        let pixels = (self.width as usize)
            .saturating_mul(self.height as usize)
            .max(1);
        let target = if red { self.red } else { self.green };
        if target * 100 < pixels * 50 {
            return Err(format!("target color {target} / {pixels} pixels: {self:?}"));
        }
        let (left, top, right, bottom) = (if red {
            self.red_bounds
        } else {
            self.green_bounds
        })
        .ok_or("target color bounds missing")?;
        let width = right - left + 1;
        let height = bottom - top + 1;
        let bounds_area = width as usize * height as usize;
        if left != 0
            || top != 0
            || width * 2 < self.width
            || height * 10 < self.height * 9
            || target * 100 < bounds_area * 95
        {
            return Err(format!(
                "target color does not fill the visible surface: {self:?}"
            ));
        }
        if reject_blue && self.blue != 0 {
            return Err(format!("covering window pixels: {self:?}"));
        }
        if self.agent_background != 0 {
            return Err(format!("agent background pixels: {self:?}"));
        }
        Ok(())
    }
}

fn extend(bounds: &mut Option<(u32, u32, u32, u32)>, x: u32, y: u32) {
    match bounds {
        Some((left, top, right, bottom)) => {
            *left = (*left).min(x);
            *top = (*top).min(y);
            *right = (*right).max(x);
            *bottom = (*bottom).max(y);
        }
        None => *bounds = Some((x, y, x, y)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_cover_and_agent_pixels_on_target() {
        let mut image = PixelStats {
            width: 10,
            height: 10,
            ..Default::default()
        };
        for y in 0..10 {
            for x in 0..10 {
                image.count(x, y, [20, 210, 70, 255]);
            }
        }
        assert!(image.validate(false, true).is_ok());
        image.count(0, 0, [25, 65, 225, 255]);
        assert!(image.validate(false, true).is_err());
        image.blue = 0;
        image.count(0, 0, [251, 0, 251, 255]);
        assert!(image.validate(false, true).is_err());
        assert!(image.validate(true, true).is_err());
    }
}
