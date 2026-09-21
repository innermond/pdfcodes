// How a multi-page background PDF's extra pages are used. Mirrored by the
// `backgroundPageMode` union in web-preview/src/lib/options.ts.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum BackgroundPageMode {
    // Only `background_page_number`'s single page is used; other pages are ignored.
    #[default]
    Single,
    // Run the whole job once per background page and join every run's output
    // pages into one PDF — each page gets its own dedicated set of sheets,
    // repeated in every grid cell of that run. See `generate_pdf_multi_background`.
    Joined,
    // One shared grid; each card's background cycles to the next background
    // page in row order (wrapping), instead of every card sharing one page.
    // See `generate_pdf_sequential_background`.
    Sequential,
}

impl std::str::FromStr for BackgroundPageMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "single" => Ok(BackgroundPageMode::Single),
            "joined" => Ok(BackgroundPageMode::Joined),
            "sequential" => Ok(BackgroundPageMode::Sequential),
            other => Err(format!("invalid background page mode {other:?} (expected \"single\", \"joined\" or \"sequential\")")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_page_mode_from_str() {
        assert!(matches!("single".parse::<BackgroundPageMode>(), Ok(BackgroundPageMode::Single)));
        assert!(matches!("joined".parse::<BackgroundPageMode>(), Ok(BackgroundPageMode::Joined)));
        assert!(matches!(" sequential ".parse::<BackgroundPageMode>(), Ok(BackgroundPageMode::Sequential)));
        assert!("cycled".parse::<BackgroundPageMode>().is_err());
    }

    #[test]
    fn background_page_mode_defaults_to_single() {
        assert!(matches!(BackgroundPageMode::default(), BackgroundPageMode::Single));
    }
}
