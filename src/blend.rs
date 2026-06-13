// PDF blend modes (PDF 1.7 spec, table "Standard separable/non-separable
// blend modes"), named after the equivalent CSS `mix-blend-mode` values used
// by the web preview (web-preview/src/lib/options.ts `BlendMode`/`BLEND_MODES`).
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

impl BlendMode {
    // The PDF `/BM` ExtGState name for this blend mode.
    pub fn pdf_name(&self) -> &'static str {
        match self {
            BlendMode::Normal => "Normal",
            BlendMode::Multiply => "Multiply",
            BlendMode::Screen => "Screen",
            BlendMode::Overlay => "Overlay",
            BlendMode::Darken => "Darken",
            BlendMode::Lighten => "Lighten",
            BlendMode::ColorDodge => "ColorDodge",
            BlendMode::ColorBurn => "ColorBurn",
            BlendMode::HardLight => "HardLight",
            BlendMode::SoftLight => "SoftLight",
            BlendMode::Difference => "Difference",
            BlendMode::Exclusion => "Exclusion",
            BlendMode::Hue => "Hue",
            BlendMode::Saturation => "Saturation",
            BlendMode::Color => "Color",
            BlendMode::Luminosity => "Luminosity",
        }
    }
}

impl std::str::FromStr for BlendMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "normal" => Ok(BlendMode::Normal),
            "multiply" => Ok(BlendMode::Multiply),
            "screen" => Ok(BlendMode::Screen),
            "overlay" => Ok(BlendMode::Overlay),
            "darken" => Ok(BlendMode::Darken),
            "lighten" => Ok(BlendMode::Lighten),
            "color-dodge" => Ok(BlendMode::ColorDodge),
            "color-burn" => Ok(BlendMode::ColorBurn),
            "hard-light" => Ok(BlendMode::HardLight),
            "soft-light" => Ok(BlendMode::SoftLight),
            "difference" => Ok(BlendMode::Difference),
            "exclusion" => Ok(BlendMode::Exclusion),
            "hue" => Ok(BlendMode::Hue),
            "saturation" => Ok(BlendMode::Saturation),
            "color" => Ok(BlendMode::Color),
            "luminosity" => Ok(BlendMode::Luminosity),
            other => Err(format!("invalid blend mode {:?}", other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_mode_from_str_round_trips_to_pdf_name() {
        assert!(matches!("normal".parse::<BlendMode>(), Ok(BlendMode::Normal)));
        assert_eq!("multiply".parse::<BlendMode>().unwrap().pdf_name(), "Multiply");
        assert_eq!("color-dodge".parse::<BlendMode>().unwrap().pdf_name(), "ColorDodge");
        assert_eq!("hard-light".parse::<BlendMode>().unwrap().pdf_name(), "HardLight");
        assert_eq!("luminosity".parse::<BlendMode>().unwrap().pdf_name(), "Luminosity");
    }

    #[test]
    fn blend_mode_from_str_rejects_unknown() {
        assert!("invalid".parse::<BlendMode>().is_err());
    }

    #[test]
    fn blend_mode_default_is_normal() {
        assert!(matches!(BlendMode::default(), BlendMode::Normal));
    }
}
