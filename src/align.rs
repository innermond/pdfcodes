#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    Left,
    Center,
    Right,
    // Framed against the contour's bounding rectangle instead of the card; resolved
    // per code (like the card variants) so a wide code re-anchors to the contour edge
    // instead of overflowing it. See `resolve_x` in src/generate/cards.rs.
    ContourLeft,
    ContourCenter,
    ContourRight,
}

impl std::str::FromStr for TextAlign {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "left" => Ok(TextAlign::Left),
            "center" => Ok(TextAlign::Center),
            "right" => Ok(TextAlign::Right),
            "contour-left" => Ok(TextAlign::ContourLeft),
            "contour-center" => Ok(TextAlign::ContourCenter),
            "contour-right" => Ok(TextAlign::ContourRight),
            other => Err(format!("invalid alignment {:?} (expected \"left\", \"center\", \"right\", or their \"contour-*\" variants)", other)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_align_from_str() {
        assert!(matches!("left".parse::<TextAlign>(), Ok(TextAlign::Left)));
        assert!(matches!("center".parse::<TextAlign>(), Ok(TextAlign::Center)));
        assert!(matches!("right".parse::<TextAlign>(), Ok(TextAlign::Right)));
        assert!(matches!("contour-left".parse::<TextAlign>(), Ok(TextAlign::ContourLeft)));
        assert!(matches!("contour-center".parse::<TextAlign>(), Ok(TextAlign::ContourCenter)));
        assert!(matches!("contour-right".parse::<TextAlign>(), Ok(TextAlign::ContourRight)));
        assert!("middle".parse::<TextAlign>().is_err());
    }
}
