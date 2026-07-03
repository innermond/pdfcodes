// A text fill color, either RGB (each component 0.0-1.0) or CMYK (each
// component 0.0-1.0).
#[derive(Clone, Copy)]
pub enum TextColor {
    Rgb(f32, f32, f32),
    Cmyk(f32, f32, f32, f32),
}

impl TextColor {
    // 8-bit sRGB triple, for compositing a raster image over this color. RGB is
    // exact; CMYK uses the naive `(1-c)(1-k)` model — the web UI always sends RGB
    // hex (see `colorToCss`), so CMYK here is only a fallback.
    pub fn to_rgb8(self) -> [u8; 3] {
        let to_u8 = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        match self {
            TextColor::Rgb(r, g, b) => [to_u8(r), to_u8(g), to_u8(b)],
            TextColor::Cmyk(c, m, y, k) => {
                [to_u8((1.0 - c) * (1.0 - k)), to_u8((1.0 - m) * (1.0 - k)), to_u8((1.0 - y) * (1.0 - k))]
            }
        }
    }
}

// Parse a color, either:
// - "#RRGGBB" (or "RRGGBB") hex -> RGB
// - "c:m:y:k" (4 colon-separated floats, 0.0-1.0) -> CMYK. A colon (rather
//   than comma) is used so multiple colors can still be given as a
//   comma-separated list, e.g. "--text-colors=#FF0000,0:0:0:1".
pub fn parse_color(s: &str) -> Result<TextColor, String> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex_rgb(hex);
    }
    if s.contains(':') {
        let parts = s.split(':').map(|v| v.trim().parse::<f32>()).collect::<Result<Vec<f32>, _>>()
            .map_err(|e| format!("invalid color {:?}: {}", s, e))?;
        if let [c, m, y, k] = parts[..] {
            return Ok(TextColor::Cmyk(c, m, y, k));
        }
        return Err(format!("invalid color {:?} (expected 4 colon-separated CMYK values, e.g. \"0:0:0:1\")", s));
    }
    parse_hex_rgb(s)
}

// Parse a background color, where "none" or "-" means no background for
// that word position (used by --text-backgrounds).
pub fn parse_color_or_none(s: &str) -> Result<Option<TextColor>, String> {
    match s.trim() {
        "none" | "-" => Ok(None),
        s => parse_color(s).map(Some),
    }
}

fn parse_hex_rgb(s: &str) -> Result<TextColor, String> {
    if s.len() != 6 {
        return Err(format!("invalid color {:?} (expected hex \"#RRGGBB\" or 4 comma-separated CMYK values)", s));
    }
    let component = |slice: &str| -> Result<f32, String> {
        u8::from_str_radix(slice, 16)
            .map(|v| v as f32 / 255.0)
            .map_err(|e| format!("invalid color {:?}: {}", s, e))
    };
    Ok(TextColor::Rgb(component(&s[0..2])?, component(&s[2..4])?, component(&s[4..6])?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_color_rgb_hex_with_hash() {
        match parse_color("#FF0000").unwrap() {
            TextColor::Rgb(r, g, b) => {
                assert!((r - 1.0).abs() < 1e-6);
                assert!((g - 0.0).abs() < 1e-6);
                assert!((b - 0.0).abs() < 1e-6);
            }
            _ => panic!("expected RGB"),
        }
    }

    #[test]
    fn parse_color_rgb_hex_without_hash() {
        match parse_color("00FF00").unwrap() {
            TextColor::Rgb(r, g, b) => {
                assert!((r - 0.0).abs() < 1e-6);
                assert!((g - 1.0).abs() < 1e-6);
                assert!((b - 0.0).abs() < 1e-6);
            }
            _ => panic!("expected RGB"),
        }
    }

    #[test]
    fn parse_color_cmyk() {
        match parse_color("0:0:0:1").unwrap() {
            TextColor::Cmyk(c, m, y, k) => {
                assert_eq!((c, m, y, k), (0.0, 0.0, 0.0, 1.0));
            }
            _ => panic!("expected CMYK"),
        }
    }

    #[test]
    fn parse_color_invalid_hex_length() {
        assert!(parse_color("#FF00").is_err());
    }

    #[test]
    fn parse_color_invalid_hex_digits() {
        assert!(parse_color("#GGGGGG").is_err());
    }

    #[test]
    fn parse_color_invalid_cmyk_component_count() {
        assert!(parse_color("0:0:0").is_err());
    }

    #[test]
    fn parse_color_invalid_cmyk_value() {
        assert!(parse_color("0:0:0:not-a-number").is_err());
    }

    #[test]
    fn parse_color_or_none_sentinels() {
        assert!(parse_color_or_none("none").unwrap().is_none());
        assert!(parse_color_or_none("-").unwrap().is_none());
        assert!(parse_color_or_none("#FF0000").unwrap().is_some());
        assert!(parse_color_or_none("not-a-color").is_err());
    }
}
