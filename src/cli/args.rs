pub(crate) fn get_flag_opt(args: &[String], name: &str) -> Option<f32> {
    let prefix = format!("--{}=", name);
    for a in args {
        if let Some(v) = a.strip_prefix(prefix.as_str()) {
            if let Ok(f) = v.parse::<f32>() {
                return Some(f);
            }
        }
    }
    None
}

pub(crate) fn get_flag(args: &[String], name: &str, default: f32) -> f32 {
    let prefix = format!("--{}=", name);
    for a in args {
        if let Some(v) = a.strip_prefix(prefix.as_str()) {
            if let Ok(f) = v.parse::<f32>() {
                return f;
            }
        }
    }
    default
}

pub(crate) fn get_string_flag(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("--{}=", name);
    args.iter().find_map(|a| a.strip_prefix(prefix.as_str()).map(|v| v.to_string()))
}

// Parse a comma-separated list of strings, e.g. --fonts=a.ttf,b.ttf -> ["a.ttf", "b.ttf"].
pub(crate) fn get_string_list_flag(args: &[String], name: &str) -> Option<Vec<String>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().to_string()).collect())
}

// Parse a comma-separated list of floats, e.g. --font-sizes=9,14 -> [9.0, 14.0].
pub(crate) fn get_float_list_flag(args: &[String], name: &str) -> Option<Vec<f32>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().parse::<f32>()).collect::<Result<Vec<f32>, _>>().unwrap_or_else(|e| {
        eprintln!("Invalid --{}={}: {}", name, raw, e);
        std::process::exit(1);
    }))
}

// Parse a comma-separated list of booleans, e.g. --text-flip-x=true,false -> [true, false].
pub(crate) fn get_bool_list_flag(args: &[String], name: &str) -> Option<Vec<bool>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().parse::<bool>()).collect::<Result<Vec<bool>, _>>().unwrap_or_else(|e| {
        eprintln!("Invalid --{}={}: {}", name, raw, e);
        std::process::exit(1);
    }))
}

// Default output filename: <background without extension>-print.pdf, or
// <background without extension>-contour.pdf when --contour is set.
pub(crate) fn default_output_path(background_path: &str, contour: bool) -> String {
    let path = std::path::Path::new(background_path);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(background_path);
    let suffix = if contour { "-contour.pdf" } else { "-print.pdf" };
    format!("{}{}", stem, suffix)
}

// Insert `suffix` before the file extension, e.g. with_suffix("foo.pdf", "-contour") -> "foo-contour.pdf".
// Preserves any directory component of the path.
pub(crate) fn with_suffix(path: &str, suffix: &str) -> String {
    let p = std::path::Path::new(path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(path);
    let new_name = match p.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{}{}.{}", stem, suffix, ext),
        None => format!("{}{}", stem, suffix),
    };
    match p.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        Some(parent) => parent.join(new_name).to_string_lossy().into_owned(),
        None => new_name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        std::iter::once("pdfcodes".to_string())
            .chain(values.iter().map(|s| s.to_string()))
            .collect()
    }

    #[test]
    fn get_flag_parses_value_or_returns_default() {
        let a = args(&["--host-width=100.5"]);
        assert_eq!(get_flag(&a, "host-width", 267.0), 100.5);
        assert_eq!(get_flag(&a, "missing", 267.0), 267.0);
    }

    #[test]
    fn get_flag_ignores_unparseable_value() {
        let a = args(&["--host-width=not-a-number"]);
        assert_eq!(get_flag(&a, "host-width", 267.0), 267.0);
    }

    #[test]
    fn get_string_flag_finds_value() {
        let a = args(&["--config=path.json"]);
        assert_eq!(get_string_flag(&a, "config"), Some("path.json".to_string()));
        assert_eq!(get_string_flag(&a, "missing"), None);
    }

    #[test]
    fn get_string_list_flag_splits_and_trims() {
        let a = args(&["--fonts=a.ttf, b.ttf,c.ttf"]);
        assert_eq!(
            get_string_list_flag(&a, "fonts"),
            Some(vec!["a.ttf".to_string(), "b.ttf".to_string(), "c.ttf".to_string()])
        );
        assert_eq!(get_string_list_flag(&a, "missing"), None);
    }

    #[test]
    fn get_float_list_flag_parses_values() {
        let a = args(&["--font-sizes=9, 14.5"]);
        assert_eq!(get_float_list_flag(&a, "font-sizes"), Some(vec![9.0, 14.5]));
        assert_eq!(get_float_list_flag(&a, "missing"), None);
    }

    #[test]
    fn get_bool_list_flag_parses_values() {
        let a = args(&["--text-flip-x=true, false"]);
        assert_eq!(get_bool_list_flag(&a, "text-flip-x"), Some(vec![true, false]));
        assert_eq!(get_bool_list_flag(&a, "missing"), None);
    }

    #[test]
    fn default_output_path_appends_suffix() {
        assert_eq!(default_output_path("15x15.pdf", false), "15x15-print.pdf");
        assert_eq!(default_output_path("15x15.pdf", true), "15x15-contour.pdf");
        assert_eq!(default_output_path("path/to/15x15.pdf", false), "15x15-print.pdf");
    }

    #[test]
    fn with_suffix_inserts_before_extension_and_preserves_dir() {
        assert_eq!(with_suffix("foo.pdf", "-contour"), "foo-contour.pdf");
        assert_eq!(with_suffix("foo", "-contour"), "foo-contour");
        assert_eq!(with_suffix("dir/foo.pdf", "-contour"), "dir/foo-contour.pdf");
    }
}
