mod align;
mod barcode;
mod blend;
mod code_kind;
mod color;
mod fonts;
mod generate;
mod geometry;
mod measure;
mod options;
mod pdf_import;
mod qr;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use align::TextAlign;
pub use barcode::Symbology;
pub use blend::BlendMode;
pub use code_kind::CodeKind;
pub use color::{parse_color, parse_color_or_none, TextColor};
pub use qr::QrEcc;
pub use generate::{generate_pdf, GenerateOutput};
pub use options::Options;
