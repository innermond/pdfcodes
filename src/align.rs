#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

impl std::str::FromStr for TextAlign {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "left" => Ok(TextAlign::Left),
            "center" => Ok(TextAlign::Center),
            "right" => Ok(TextAlign::Right),
            other => Err(format!("invalid alignment {:?} (expected \"left\", \"center\", or \"right\")", other)),
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
        assert!("middle".parse::<TextAlign>().is_err());
    }
}
