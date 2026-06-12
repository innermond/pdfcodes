mod cli;

use std::env;
use pdfcodes::{generate_pdf, parse_color, parse_color_or_none, Options, TextAlign};

use cli::args::{default_output_path, get_bool_list_flag, get_flag, get_float_list_flag, get_string_flag, get_string_list_flag, with_suffix};
use cli::config::Config;

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
