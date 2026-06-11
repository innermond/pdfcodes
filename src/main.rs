use serde::Deserialize;
use std::env;
use pdfcodes::{generate_pdf, parse_color, parse_color_or_none, Options, TextAlign};

// Optional JSON config file (--config=path.json) providing defaults for any
// of the CLI parameters. CLI flags and positional arguments take precedence.
#[derive(Default, Deserialize)]
struct Config {
    csv: Option<String>,
    background: Option<String>,
    contour_background: Option<String>,
    output: Option<String>,
    contour_output: Option<String>,
    host_width: Option<f32>,
    host_height: Option<f32>,
    offset_x: Option<f32>,
    offset_y: Option<f32>,
    circle_diameter: Option<f32>,
    contour: Option<bool>,
    with_contour: Option<bool>,
    measure_paths: Option<bool>,
    // Per-word text layout: font size in points and baseline y-position in
    // mm, indexed by the word's position in the (space-separated) CSV field.
    font_sizes: Option<Vec<f32>>,
    text_y: Option<Vec<f32>>,
    // Explicit baseline x-position in mm, indexed by word position. When
    // set, overrides `align` (and ignores `safe_margin`).
    text_x: Option<Vec<f32>>,
    // Paths to TrueType/OpenType font files, one per word position (or a
    // single entry to use the same font for every word).
    fonts: Option<Vec<String>>,
    // Horizontal alignment ("left", "center", or "right"), one per word
    // position (or a single entry to use the same alignment for every word).
    align: Option<Vec<String>>,
    // Text fill color ("#RRGGBB"), one per word position (or a single entry
    // to use the same color for every word). Defaults to black.
    text_colors: Option<Vec<String>>,
    // Overlay the contour grid as a non-printable layer on the print PDF.
    combineb: Option<bool>,
    // Outline the bounding box of each text part on the print PDF.
    debug: Option<bool>,
    // Margin (in mm) kept clear of left/right-aligned text.
    safe_margin: Option<f32>,
    // Rotation in degrees (counterclockwise) around each text part's own
    // center, one per word position (or a single entry for every word).
    text_rotations: Option<Vec<f32>>,
    // Mirror each text part horizontally/vertically around its own center,
    // one per word position (or a single entry for every word).
    text_flip_x: Option<Vec<bool>>,
    text_flip_y: Option<Vec<bool>>,
    // Background fill color drawn behind each text part's bounding box
    // ("#RRGGBB", "c:m:y:k", or "none"/"-" for no background), one per word
    // position (or a single entry for every word).
    text_backgrounds: Option<Vec<String>>,
    // Padding (in mm) added around the text bounding box for text_backgrounds.
    text_background_padding: Option<f32>,
    // Explicit width (in mm) for the text_backgrounds rectangle, one per
    // word position (or a single entry for every word). Centers the
    // rectangle on the text part's horizontal center.
    text_background_widths: Option<Vec<f32>>,
    // Opacity (0.0-1.0) of the text_backgrounds rectangle, one per word
    // position (or a single entry for every word).
    text_background_alphas: Option<Vec<f32>>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let positional: Vec<&String> = args.iter().skip(1).filter(|a| !a.starts_with("--")).collect();

    let config = match get_string_flag(&args, "config") {
        Some(path) => {
            let data = std::fs::read_to_string(&path)?;
            serde_json::from_str(&data)?
        }
        None => Config::default(),
    };

    let contour = args.iter().any(|a| a == "--contour") || config.contour.unwrap_or(false);
    let with_contour = args.iter().any(|a| a == "--with-contour") || config.with_contour.unwrap_or(false);

    let (csv_path, background_path, output_path, contour_output_path) = if contour {
        let background_path = positional.get(0).map(|s| s.to_string()).or_else(|| config.background.clone());

        let Some(background_path) = background_path else {
            eprintln!("Usage: {} <background_pdf> [output_pdf] --contour [--host-width=267] [--host-height=350] [--offset-x=0] [--offset-y=0] [--circle-diameter=10] [--config=config.json]", args[0]);
            std::process::exit(1);
        };
        let output_path = positional.get(1).map(|s| s.to_string()).or_else(|| config.output.clone()).unwrap_or_else(|| default_output_path(&background_path, true));
        (None, background_path, output_path, None)
    } else {
        let csv_path = positional.get(0).map(|s| s.to_string()).or_else(|| config.csv.clone());
        let background_path = positional.get(1).map(|s| s.to_string()).or_else(|| config.background.clone());

        let (Some(csv_path), Some(background_path)) = (csv_path, background_path) else {
            eprintln!("Usage: {} <csv_file> <background_pdf> [output_pdf] [--host-width=267] [--host-height=350] [--offset-x=0] [--offset-y=0] [--circle-diameter=10] [--font-sizes=9,14] [--text-y=10,3] [--text-x=5,5] [--fonts=path1.ttf,path2.ttf] [--align=left,center,right] [--text-colors=#RRGGBB|c:m:y:k,...] [--text-rotations=0,15] [--text-flip-x=true,false] [--text-flip-y=true,false] [--text-backgrounds=#RRGGBB|c:m:y:k|none,...] [--text-background-padding=0] [--text-backgrounds-widths=20,30] [--text-backgrounds-alphas=0.5,1] [--contour] [--with-contour] [--contour-background=path.pdf] [--combineb] [--debug] [--safe-margin=0] [--config=config.json]", args[0]);
            std::process::exit(1);
        };
        let output_path = if with_contour {
            default_output_path(&background_path, false)
        } else {
            positional.get(2).map(|s| s.to_string()).or_else(|| config.output.clone()).unwrap_or_else(|| default_output_path(&background_path, false))
        };
        let contour_output_path = if with_contour {
            let base = positional.get(2).map(|s| s.to_string()).or_else(|| config.contour_output.clone()).unwrap_or_else(|| default_output_path(&background_path, false));
            Some(with_suffix(&base, "-contour"))
        } else {
            None
        };
        (Some(csv_path), background_path, output_path, contour_output_path)
    };

    // Resolve which PDF's first page provides the contour content. Only used
    // for `--with-contour` (as the contour background) and `--combineb` (as
    // the non-printable overlay layer drawn on the print PDF).
    let contour_background_path = get_string_flag(&args, "contour-background")
        .or_else(|| config.contour_background.clone())
        .or_else(|| if with_contour { positional.get(2).map(|s| s.to_string()) } else { None })
        .unwrap_or_else(|| background_path.clone());

    let combine = args.iter().any(|a| a == "--combineb") || config.combineb.unwrap_or(false);

    let opts = Options {
        host_width_mm: get_flag(&args, "host-width", config.host_width.unwrap_or(267.0)),
        host_height_mm: get_flag(&args, "host-height", config.host_height.unwrap_or(350.0)),
        offset_x_mm: get_flag(&args, "offset-x", config.offset_x.unwrap_or(0.0)),
        offset_y_mm: get_flag(&args, "offset-y", config.offset_y.unwrap_or(0.0)),
        circle_diameter_mm: get_flag(&args, "circle-diameter", config.circle_diameter.unwrap_or(10.0)),
        contour,
        measure_paths: args.iter().any(|a| a == "--measure-paths") || config.measure_paths.unwrap_or(false),
        font_sizes: get_float_list_flag(&args, "font-sizes")
            .or_else(|| config.font_sizes.clone())
            .unwrap_or_else(|| vec![9.0, 14.0]),
        text_y_mm: get_float_list_flag(&args, "text-y")
            .or_else(|| config.text_y.clone())
            .unwrap_or_else(|| vec![10.0, 3.0]),
        text_x_mm: get_float_list_flag(&args, "text-x")
            .or_else(|| config.text_x.clone())
            .unwrap_or_default(),
        font_data: get_string_list_flag(&args, "fonts")
            .or_else(|| config.fonts.clone())
            .unwrap_or_default()
            .iter()
            .map(|path| std::fs::read(path))
            .collect::<Result<Vec<Vec<u8>>, _>>()?,
        align: get_string_list_flag(&args, "align")
            .or_else(|| config.align.clone())
            .unwrap_or_else(|| vec!["center".to_string()])
            .iter()
            .map(|s| s.parse::<TextAlign>())
            .collect::<Result<Vec<TextAlign>, String>>()?,
        text_colors: get_string_list_flag(&args, "text-colors")
            .or_else(|| config.text_colors.clone())
            .unwrap_or_default()
            .iter()
            .map(|s| parse_color(s))
            .collect::<Result<Vec<pdfcodes::TextColor>, String>>()?,
        combine,
        debug: args.iter().any(|a| a == "--debug") || config.debug.unwrap_or(false),
        safe_margin_mm: get_flag(&args, "safe-margin", config.safe_margin.unwrap_or(0.0)),
        text_rotations: get_float_list_flag(&args, "text-rotations")
            .or_else(|| config.text_rotations.clone())
            .unwrap_or_default(),
        text_flip_x: get_bool_list_flag(&args, "text-flip-x")
            .or_else(|| config.text_flip_x.clone())
            .unwrap_or_default(),
        text_flip_y: get_bool_list_flag(&args, "text-flip-y")
            .or_else(|| config.text_flip_y.clone())
            .unwrap_or_default(),
        text_backgrounds: get_string_list_flag(&args, "text-backgrounds")
            .or_else(|| config.text_backgrounds.clone())
            .unwrap_or_default()
            .iter()
            .map(|s| parse_color_or_none(s))
            .collect::<Result<Vec<Option<pdfcodes::TextColor>>, String>>()?,
        text_background_padding_mm: get_flag(&args, "text-background-padding", config.text_background_padding.unwrap_or(0.0)),
        text_background_widths_mm: get_float_list_flag(&args, "text-backgrounds-widths")
            .or_else(|| config.text_background_widths.clone())
            .unwrap_or_default(),
        text_background_alphas: get_float_list_flag(&args, "text-backgrounds-alphas")
            .or_else(|| config.text_background_alphas.clone())
            .unwrap_or_default(),
    };

    run(csv_path.as_deref(), &background_path, &output_path, &opts, &contour_background_path)?;
    println!("PDF generated successfully: {}", output_path);

    // When generating the print PDF, optionally also generate the matching
    // contour PDF using the same dimensional parameters, so both stay in sync.
    if let Some(contour_output_path) = contour_output_path {
        let mut contour_opts = opts.as_contour();
        contour_opts.combine = false;
        run(None, &contour_background_path, &contour_output_path, &contour_opts, &contour_background_path)?;
        println!("PDF generated successfully: {}", contour_output_path);
    }

    Ok(())
}

// Read inputs from disk, run the library's PDF generator, write the result,
// and print any requested path-length measurements.
fn run(csv_path: Option<&str>, background_path: &str, output_path: &str, opts: &Options, contour_background_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let csv_data = csv_path.map(std::fs::read_to_string).transpose()?;
    let background_bytes = std::fs::read(background_path)?;
    let contour_background_bytes = if opts.combine {
        Some(std::fs::read(contour_background_path)?)
    } else {
        None
    };

    let out = generate_pdf(csv_data.as_deref(), &background_bytes, contour_background_bytes.as_deref(), opts)?;

    if let (Some(per_card), Some(total)) = (out.path_length_per_card_mm, out.path_length_total_mm) {
        println!(
            "Stroked path length per card: {:.2} mm; total across {} cards: {:.2} mm",
            per_card, out.cards_per_page, total
        );
    }

    std::fs::write(output_path, out.pdf)?;
    Ok(())
}

fn get_flag(args: &[String], name: &str, default: f32) -> f32 {
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

fn get_string_flag(args: &[String], name: &str) -> Option<String> {
    let prefix = format!("--{}=", name);
    args.iter().find_map(|a| a.strip_prefix(prefix.as_str()).map(|v| v.to_string()))
}

// Parse a comma-separated list of strings, e.g. --fonts=a.ttf,b.ttf -> ["a.ttf", "b.ttf"].
fn get_string_list_flag(args: &[String], name: &str) -> Option<Vec<String>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().to_string()).collect())
}

// Parse a comma-separated list of floats, e.g. --font-sizes=9,14 -> [9.0, 14.0].
fn get_float_list_flag(args: &[String], name: &str) -> Option<Vec<f32>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().parse::<f32>()).collect::<Result<Vec<f32>, _>>().unwrap_or_else(|e| {
        eprintln!("Invalid --{}={}: {}", name, raw, e);
        std::process::exit(1);
    }))
}

// Parse a comma-separated list of booleans, e.g. --text-flip-x=true,false -> [true, false].
fn get_bool_list_flag(args: &[String], name: &str) -> Option<Vec<bool>> {
    let raw = get_string_flag(args, name)?;
    Some(raw.split(',').map(|v| v.trim().parse::<bool>()).collect::<Result<Vec<bool>, _>>().unwrap_or_else(|e| {
        eprintln!("Invalid --{}={}: {}", name, raw, e);
        std::process::exit(1);
    }))
}

// Default output filename: <background without extension>-print.pdf, or
// <background without extension>-contour.pdf when --contour is set.
fn default_output_path(background_path: &str, contour: bool) -> String {
    let path = std::path::Path::new(background_path);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(background_path);
    let suffix = if contour { "-contour.pdf" } else { "-print.pdf" };
    format!("{}{}", stem, suffix)
}

// Insert `suffix` before the file extension, e.g. with_suffix("foo.pdf", "-contour") -> "foo-contour.pdf".
// Preserves any directory component of the path.
fn with_suffix(path: &str, suffix: &str) -> String {
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
