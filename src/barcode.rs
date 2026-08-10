// The 1D barcode symbologies a code can be drawn as. Mirrored by `Symbology` in
// web-preview/src/lib/options.ts.
//
// All four come from the `barcoders` crate, which exposes them through one shape:
// `Sym::new(data)? .encode() -> Vec<u8>`, one byte per module, quiet zone excluded.
// This module wraps that so callers never see the crate's two rough edges — Code
// 128's character-set prefix, and error values too terse to show a user.
use barcoders::sym::code39::Code39;
use barcoders::sym::code128::Code128;
use barcoders::sym::ean8::EAN8;
use barcoders::sym::ean13::EAN13;

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum Symbology {
    // Any ASCII, the most compact of the four, and the only one that encodes this
    // app's mixed letter+digit codes as they are — hence the default.
    #[default]
    Code128,
    // Uppercase, digits and a few punctuation marks. Roughly 2.5x wider than Code
    // 128, but it is what older industrial scanners require.
    Code39,
    // Retail article numbers: exactly 12 digits, or 13 with the check digit already
    // computed (which is then verified).
    Ean13,
    // The short EAN for small packages: 7 digits, or 8 with the check digit.
    Ean8,
}

impl Symbology {
    // Quiet zone in modules kept clear on each side, inside the stated width. The
    // EAN symbologies specify asymmetric zones, but the wider of the two on both
    // sides is simpler and never scans worse.
    pub(crate) fn quiet_modules(self) -> usize {
        match self {
            // 10x the narrow bar is the usual minimum for the Code symbologies.
            Symbology::Code128 | Symbology::Code39 => 10,
            Symbology::Ean13 | Symbology::Ean8 => 11,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Symbology::Code128 => "Code 128",
            Symbology::Code39 => "Code 39",
            Symbology::Ean13 => "EAN-13",
            Symbology::Ean8 => "EAN-8",
        }
    }
}

impl std::str::FromStr for Symbology {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "code128" => Ok(Symbology::Code128),
            "code39" => Ok(Symbology::Code39),
            "ean13" => Ok(Symbology::Ean13),
            "ean8" => Ok(Symbology::Ean8),
            other => Err(format!(
                "invalid barcode symbology {other:?} (expected \"code128\", \"code39\", \"ean13\" or \"ean8\")"
            )),
        }
    }
}

// Code 128 encodes digits two-per-symbol in character set C, which nearly halves the
// width — but the set can only hold whole pairs, so it needs an even count. Set B
// covers the printable ASCII range and is the safe choice for everything else.
//
// `barcoders` wants the set as a Unicode marker prefixed to the data (see the crate's
// code128 docs); that is an encoding detail, so it is added here and never surfaces.
fn code128_with_charset(data: &str) -> String {
    let all_digits = !data.is_empty() && data.chars().all(|c| c.is_ascii_digit());
    let marker = if all_digits && data.len().is_multiple_of(2) { 'Ć' } else { 'Ɓ' };
    format!("{marker}{data}")
}

// The module row for `data` under `sym`: one byte per module (1 = bar), quiet zone
// excluded — the caller insets that. The error is written for the person who typed
// the code, since it is shown in the app and listed per failing row.
pub(crate) fn encode(sym: Symbology, data: &str) -> Result<Vec<u8>, String> {
    if data.is_empty() {
        return Err(format!("{} needs a non-empty code", sym.label()));
    }
    let requirement = || match sym {
        Symbology::Code128 => "any characters".to_string(),
        Symbology::Code39 => "only A-Z, 0-9, space and - . $ / + %".to_string(),
        Symbology::Ean13 => "exactly 12 digits (or 13 with the check digit)".to_string(),
        Symbology::Ean8 => "exactly 7 digits (or 8 with the check digit)".to_string(),
    };
    let reject = |detail: &str| format!("{} needs {} — got {data:?} ({detail})", sym.label(), requirement());

    match sym {
        Symbology::Code128 => Code128::new(code128_with_charset(data))
            .map(|b| b.encode())
            .map_err(|_| reject("unsupported character")),
        Symbology::Code39 => Code39::new(data)
            .map(|b| b.encode())
            .map_err(|_| reject("unsupported character; lowercase is not allowed")),
        Symbology::Ean13 => EAN13::new(data)
            .map(|b| b.encode())
            .map_err(|_| reject(ean_detail(data, 12))),
        Symbology::Ean8 => EAN8::new(data)
            .map(|b| b.encode())
            .map_err(|_| reject(ean_detail(data, 7))),
    }
}

// Why an EAN code was refused: the wrong length, a non-digit, or a check digit that
// doesn't match. Saying which one turns a dead end into a fixable mistake.
fn ean_detail(data: &str, digits: usize) -> &'static str {
    if !data.chars().all(|c| c.is_ascii_digit()) {
        "not all digits"
    } else if data.len() == digits + 1 {
        "the check digit doesn't match"
    } else {
        "wrong number of digits"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbology_from_str() {
        assert!(matches!("code128".parse::<Symbology>(), Ok(Symbology::Code128)));
        assert!(matches!("Code39".parse::<Symbology>(), Ok(Symbology::Code39)));
        assert!(matches!(" ean13 ".parse::<Symbology>(), Ok(Symbology::Ean13)));
        assert!(matches!("ean8".parse::<Symbology>(), Ok(Symbology::Ean8)));
        assert!("upca".parse::<Symbology>().is_err());
        assert!(matches!(Symbology::default(), Symbology::Code128));
    }

    #[test]
    fn code128_encodes_anything_this_app_generates() {
        // Mixed alphanumeric — the shape the code generator produces.
        let bits = encode(Symbology::Code128, "AB1234").unwrap();
        assert!(bits.iter().all(|b| *b <= 1), "bits are 0/1");
        assert!(bits.len() > 50);
        // Lowercase and punctuation go through character set B too.
        assert!(encode(Symbology::Code128, "ab-12/x").is_ok());
    }

    #[test]
    fn code128_uses_the_double_density_set_for_even_digit_runs() {
        // Set C packs two digits per symbol, so 8 digits encode shorter than 8
        // letters do. This is the whole point of picking the set automatically.
        let digits = encode(Symbology::Code128, "12345678").unwrap();
        let letters = encode(Symbology::Code128, "ABCDEFGH").unwrap();
        assert!(digits.len() < letters.len(), "digits {} vs letters {}", digits.len(), letters.len());
    }

    #[test]
    fn code128_falls_back_to_set_b_for_an_odd_digit_run() {
        // Set C can only hold whole pairs — an odd count must not reach it, or the
        // crate rejects the trailing digit.
        let odd = encode(Symbology::Code128, "1234567");
        assert!(odd.is_ok(), "odd digit runs must still encode: {odd:?}");
        // ...and it is genuinely the wider set B, not a silently dropped digit.
        let even = encode(Symbology::Code128, "123456").unwrap();
        assert!(odd.unwrap().len() > even.len());
    }

    #[test]
    fn code39_rejects_lowercase_with_a_message_that_says_so() {
        assert!(encode(Symbology::Code39, "AB-12").is_ok());
        let err = encode(Symbology::Code39, "ab12").unwrap_err();
        assert!(err.contains("Code 39"), "{err}");
        assert!(err.contains("lowercase"), "{err}");
    }

    #[test]
    fn ean13_takes_12_digits_and_verifies_a_supplied_check_digit() {
        assert!(encode(Symbology::Ean13, "750103131130").is_ok());
        // 13 digits: the last is checked, not stored.
        let good = encode(Symbology::Ean13, "5901234123457");
        assert!(good.is_ok(), "{good:?}");
        let bad = encode(Symbology::Ean13, "5901234123450").unwrap_err();
        assert!(bad.contains("check digit"), "{bad}");
    }

    #[test]
    fn ean_rejections_name_the_actual_problem() {
        let short = encode(Symbology::Ean13, "12345").unwrap_err();
        assert!(short.contains("wrong number of digits"), "{short}");
        let alpha = encode(Symbology::Ean13, "AB1234QT5678").unwrap_err();
        assert!(alpha.contains("not all digits"), "{alpha}");
        // The message states the requirement, so it stands alone in the UI.
        assert!(alpha.contains("exactly 12 digits"), "{alpha}");
    }

    #[test]
    fn ean8_takes_7_digits() {
        assert!(encode(Symbology::Ean8, "5512345").is_ok());
        assert!(encode(Symbology::Ean8, "551234567").is_err());
    }

    #[test]
    fn an_empty_code_is_refused_before_the_encoder_sees_it() {
        let err = encode(Symbology::Code128, "").unwrap_err();
        assert!(err.contains("non-empty"), "{err}");
    }

    #[test]
    fn quiet_zones_match_each_symbology() {
        assert_eq!(Symbology::Code128.quiet_modules(), 10);
        assert_eq!(Symbology::Ean13.quiet_modules(), 11);
    }
}
