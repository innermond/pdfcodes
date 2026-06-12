use lopdf::{Document, Object, Dictionary, Stream, ObjectId, content::{Operation, Content}};

use crate::geometry::CardLayout;

// Build a single host page laying out the grid (same dimensions, offsets and
// registration circles as the print pages), with every cell showing just the
// background and no label text. Returns the new page's object ID; the
// caller is responsible for adding it to the page tree.
pub(crate) fn build_contour_page(
    doc: &mut Document,
    pages_id: ObjectId,
    bg_form_id: ObjectId,
    layout: &CardLayout,
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut operations = Vec::new();

    for i in 0..layout.cards_per_page {
        let (x, y) = layout.position_serpentine(i);

        operations.push(Operation::new("q", vec![]));
        operations.push(Operation::new("cm", vec![
            Object::Real(1.0), Object::Real(0.0),
            Object::Real(0.0), Object::Real(1.0),
            Object::Real(x), Object::Real(y),
        ]));
        operations.push(Operation::new("Do", vec![Object::Name(b"BG".to_vec())]));
        operations.push(Operation::new("Q", vec![]));
    }

    operations.extend(layout.registration_circles());

    let content = Content { operations };
    let content_stream = Stream::new(Dictionary::new(), content.encode()?);
    let content_id = doc.add_object(content_stream);

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(layout.host_box.clone()));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary({
        let mut res = Dictionary::new();
        res.set("XObject", Object::Dictionary({
            let mut xobjs = Dictionary::new();
            xobjs.set("BG", Object::Reference(bg_form_id));
            xobjs
        }));
        res
    }));

    Ok(doc.add_object(Object::Dictionary(page_dict)))
}
