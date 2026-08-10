// Error-correction level for the QR codes drawn in place of a code's text
// (see `src/generate/qr.rs`). Named after the standard's L/M/Q/H levels and
// mirrored by `QrEcc` in web-preview/src/lib/options.ts.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum QrEcc {
    // ~7% recoverable: the smallest symbol for a given payload.
    Low,
    // ~15%: the default — enough tolerance for print/scan wear without
    // inflating the module count.
    #[default]
    Medium,
    // ~25%.
    Quartile,
    // ~30%: the largest symbol, but survives the most damage.
    High,
}

impl QrEcc {
    // The `qrcodegen` level this maps to. Kept here so the encoder crate stays
    // an implementation detail of the generator.
    pub(crate) fn to_qrcodegen(self) -> qrcodegen::QrCodeEcc {
        match self {
            QrEcc::Low => qrcodegen::QrCodeEcc::Low,
            QrEcc::Medium => qrcodegen::QrCodeEcc::Medium,
            QrEcc::Quartile => qrcodegen::QrCodeEcc::Quartile,
            QrEcc::High => qrcodegen::QrCodeEcc::High,
        }
    }
}

impl std::str::FromStr for QrEcc {
    type Err = String;

    // Accepts the single letters the UI sends, in either case ("M" / "m").
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "l" => Ok(QrEcc::Low),
            "m" => Ok(QrEcc::Medium),
            "q" => Ok(QrEcc::Quartile),
            "h" => Ok(QrEcc::High),
            other => Err(format!("invalid QR error-correction level {other:?} (expected \"L\", \"M\", \"Q\" or \"H\")")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_ecc_from_str_accepts_both_cases() {
        assert!(matches!("l".parse::<QrEcc>(), Ok(QrEcc::Low)));
        assert!(matches!("M".parse::<QrEcc>(), Ok(QrEcc::Medium)));
        assert!(matches!(" q ".parse::<QrEcc>(), Ok(QrEcc::Quartile)));
        assert!(matches!("H".parse::<QrEcc>(), Ok(QrEcc::High)));
        assert!("x".parse::<QrEcc>().is_err());
    }

    #[test]
    fn qr_ecc_default_is_medium() {
        assert!(matches!(QrEcc::default(), QrEcc::Medium));
    }
}
