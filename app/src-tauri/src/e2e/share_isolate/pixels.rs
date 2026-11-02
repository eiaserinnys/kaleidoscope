#[derive(Debug, Default)]
pub(super) struct PixelStats {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) green: usize,
    pub(super) blue: usize,
    pub(super) red: usize,
    pub(super) agent_background: usize,
}

impl PixelStats {
    pub(super) fn count(&mut self, [r, g, b, _]: [u8; 4]) {
        if [r, g, b] == [251, 0, 251] {
            self.agent_background += 1;
        }
        let (r, g, b) = (r as u16, g as u16, b as u16);
        if g > 150 && g * 2 > r * 3 && g * 2 > b * 3 {
            self.green += 1;
        }
        if b > 170 && b * 2 > r * 3 && b * 5 > g * 6 {
            self.blue += 1;
        }
        if r > 160 && r * 2 > g * 3 && r * 2 > b * 3 {
            self.red += 1;
        }
    }

    pub(super) fn validate(&self, red: bool, reject_blue: bool) -> Result<(), String> {
        let pixels = (self.width as usize)
            .saturating_mul(self.height as usize)
            .max(1);
        let target = if red { self.red } else { self.green };
        if target * 100 < pixels * 60 {
            return Err(format!("target color {target} / {pixels} pixels: {self:?}"));
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
        for _ in 0..100 {
            image.count([20, 210, 70, 255]);
        }
        assert!(image.validate(false, true).is_ok());
        image.count([25, 65, 225, 255]);
        assert!(image.validate(false, true).is_err());
        image.blue = 0;
        image.count([251, 0, 251, 255]);
        assert!(image.validate(false, true).is_err());
        assert!(image.validate(true, true).is_err());
    }
}
