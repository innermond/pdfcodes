// How a code is drawn: as text (glyphs from the embedded font) or as one of the
// machine-readable symbols that replace it in the same box. Mirrored by `CodeKind`
// in web-preview/src/lib/options.ts.
//
// The kind is explicit rather than inferred from whichever size field is set: with
// more than one symbol kind, two implicit switches could contradict each other.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum CodeKind {
    #[default]
    Text,
    // A QR square; see `qr_sizes_mm` / `qr_ecc` in src/options.rs.
    Qr,
    // A 1D barcode rectangle; see `barcode_*` in src/options.rs.
    Barcode,
}

impl std::str::FromStr for CodeKind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "text" => Ok(CodeKind::Text),
            "qr" => Ok(CodeKind::Qr),
            "barcode" => Ok(CodeKind::Barcode),
            other => Err(format!("invalid code kind {other:?} (expected \"text\", \"qr\" or \"barcode\")")),
        }
    }
}

impl CodeKind {
    // True for the kinds drawn as a grid of modules rather than glyphs. Those share
    // the whole placement path but need no font and get no glyph outline.
    pub(crate) fn is_symbol(self) -> bool {
        !matches!(self, CodeKind::Text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_kind_from_str() {
        assert!(matches!("text".parse::<CodeKind>(), Ok(CodeKind::Text)));
        assert!(matches!("qr".parse::<CodeKind>(), Ok(CodeKind::Qr)));
        assert!(matches!(" barcode ".parse::<CodeKind>(), Ok(CodeKind::Barcode)));
        assert!("ean".parse::<CodeKind>().is_err());
    }

    #[test]
    fn code_kind_defaults_to_text_and_only_symbols_report_so() {
        assert!(matches!(CodeKind::default(), CodeKind::Text));
        assert!(!CodeKind::Text.is_symbol());
        assert!(CodeKind::Qr.is_symbol());
        assert!(CodeKind::Barcode.is_symbol());
    }
}
