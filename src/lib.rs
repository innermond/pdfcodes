mod align;
mod color;
mod fonts;
mod generate;
mod geometry;
mod measure;
mod options;
mod pdf_import;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use align::TextAlign;
pub use color::{parse_color, parse_color_or_none, TextColor};
pub use generate::{generate_pdf, GenerateOutput};
pub use options::Options;
