use lopdf::{Document, Object, Dictionary, ObjectId};

// Create an Optional Content Group (layer) marked non-printable (visible on
// screen, excluded when printing) and install it on the catalog's OCProperties.
// Returns the OCG's object ID; the caller wraps the relevant content in a
// `/OC /<name> BDC … EMC` marked-content sequence and maps `<name>` to this OCG
// via the page's Resources /Properties.
//
// One OCG per generated document is the norm here (the print overlay and the
// contour's registration circles live in separate PDFs), so a fresh
// OCProperties is written rather than merged.
pub(crate) fn add_nonprintable_ocg(
    doc: &mut Document,
    catalog_id: ObjectId,
    name: &[u8],
) -> Result<ObjectId, Box<dyn std::error::Error>> {
    let mut ocg_dict = Dictionary::new();
    ocg_dict.set("Type", Object::Name(b"OCG".to_vec()));
    ocg_dict.set("Name", Object::String(name.to_vec(), lopdf::StringFormat::Literal));
    ocg_dict.set("Usage", Object::Dictionary({
        let mut usage = Dictionary::new();
        usage.set("Print", Object::Dictionary({
            let mut print = Dictionary::new();
            print.set("PrintState", Object::Name(b"OFF".to_vec()));
            print
        }));
        usage.set("View", Object::Dictionary({
            let mut view = Dictionary::new();
            view.set("ViewState", Object::Name(b"ON".to_vec()));
            view
        }));
        usage
    }));
    let ocg_id = doc.add_object(Object::Dictionary(ocg_dict));

    let mut catalog_dict = doc.get_object(catalog_id)?.as_dict()?.clone();
    catalog_dict.set("OCProperties", Object::Dictionary({
        let mut ocp = Dictionary::new();
        ocp.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
        ocp.set("D", Object::Dictionary({
            let mut d = Dictionary::new();
            d.set("Name", Object::String(b"Default".to_vec(), lopdf::StringFormat::Literal));
            d.set("BaseState", Object::Name(b"ON".to_vec()));
            d.set("ON", Object::Array(vec![Object::Reference(ocg_id)]));
            d.set("OFF", Object::Array(vec![]));
            d.set("AS", Object::Array(vec![Object::Dictionary({
                let mut as_dict = Dictionary::new();
                as_dict.set("Event", Object::Name(b"Print".to_vec()));
                as_dict.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
                as_dict.set("Category", Object::Array(vec![Object::Name(b"Print".to_vec())]));
                as_dict
            })]));
            d.set("Order", Object::Array(vec![Object::Reference(ocg_id)]));
            d
        }));
        ocp
    }));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));

    Ok(ocg_id)
}
