use lopdf::{Document, Object, Dictionary, ObjectId, Stream};

// Create an Optional Content Group (layer) marked non-printable (visible on
// screen, excluded when printing) and install it on the catalog's OCProperties.
// Returns the OCG's object ID; the caller wraps the relevant content in a
// `/OC /<name> BDC … EMC` marked-content sequence and maps `<name>` to this OCG
// via the page's Resources /Properties.
//
// Usually the document's only OCG (the print overlay and the contour's registration
// circles live in separate PDFs), in which case a fresh OCProperties is written. When
// one already exists — "Neimprimabil" on top of the combine overlay — the new group is
// added to it.
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
    // An earlier OCG on the same document (say the combine overlay) must stay listed, so
    // the new group is appended to the existing OCProperties instead of replacing it.
    let existing = catalog_dict.get(b"OCProperties").ok().and_then(|o| o.as_dict().ok()).cloned();
    let as_entry = Object::Dictionary({
        let mut as_dict = Dictionary::new();
        as_dict.set("Event", Object::Name(b"Print".to_vec()));
        as_dict.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
        as_dict.set("Category", Object::Array(vec![Object::Name(b"Print".to_vec())]));
        as_dict
    });
    let ocp = match existing {
        None => {
            let mut ocp = Dictionary::new();
            ocp.set("OCGs", Object::Array(vec![Object::Reference(ocg_id)]));
            ocp.set("D", Object::Dictionary({
                let mut d = Dictionary::new();
                d.set("Name", Object::String(b"Default".to_vec(), lopdf::StringFormat::Literal));
                d.set("BaseState", Object::Name(b"ON".to_vec()));
                d.set("ON", Object::Array(vec![Object::Reference(ocg_id)]));
                d.set("OFF", Object::Array(vec![]));
                d.set("AS", Object::Array(vec![as_entry]));
                d.set("Order", Object::Array(vec![Object::Reference(ocg_id)]));
                d
            }));
            ocp
        }
        Some(mut ocp) => {
            push_to_array(&mut ocp, "OCGs", Object::Reference(ocg_id));
            let mut d = ocp.get(b"D").ok().and_then(|o| o.as_dict().ok()).cloned().unwrap_or_default();
            push_to_array(&mut d, "ON", Object::Reference(ocg_id));
            push_to_array(&mut d, "Order", Object::Reference(ocg_id));
            push_to_array(&mut d, "AS", as_entry);
            ocp.set("D", Object::Dictionary(d));
            ocp
        }
    };
    catalog_dict.set("OCProperties", Object::Dictionary(ocp));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));

    Ok(ocg_id)
}

// Append `value` to the array stored under `key`, creating the array when absent.
fn push_to_array(dict: &mut Dictionary, key: &str, value: Object) {
    let mut items = dict.get(key.as_bytes()).ok().and_then(|o| o.as_array().ok()).cloned().unwrap_or_default();
    items.push(value);
    dict.set(key, Object::Array(items));
}

// Make every page of `doc` view-only: all of its content goes into a non-printable
// layer (View: ON, Print: OFF), so compliant viewers show it on screen but print blank
// pages. The page's `Contents` becomes `[ /OC /OCU BDC, <its own streams>, EMC ]` —
// streams in a `Contents` array are concatenated, so no stream has to be decoded and
// pages with compressed or several content streams work alike. A deterrent, not copy
// protection: a viewer or tool that ignores layers still prints it.
pub(crate) fn make_unprintable(
    doc: &mut Document,
    catalog_id: ObjectId,
) -> Result<(), Box<dyn std::error::Error>> {
    let ocg_id = add_nonprintable_ocg(doc, catalog_id, b"Print layer (non-printable)")?;
    let prefix = doc.add_object(Stream::new(Dictionary::new(), b"/OC /OCU BDC\n".to_vec()));
    let suffix = doc.add_object(Stream::new(Dictionary::new(), b"\nEMC".to_vec()));

    let page_ids: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    for page_id in page_ids {
        let mut page = doc.get_object(page_id)?.as_dict()?.clone();

        let own: Vec<Object> = match page.get(b"Contents") {
            Ok(Object::Array(items)) => items.clone(),
            Ok(Object::Reference(id)) => match doc.get_object(*id) {
                Ok(Object::Array(items)) => items.clone(),
                _ => vec![Object::Reference(*id)],
            },
            _ => Vec::new(),
        };
        let mut contents = vec![Object::Reference(prefix)];
        contents.extend(own);
        contents.push(Object::Reference(suffix));
        page.set("Contents", Object::Array(contents));

        let mut resources = match page.get(b"Resources") {
            Ok(Object::Dictionary(d)) => d.clone(),
            Ok(Object::Reference(id)) => doc.get_object(*id)?.as_dict()?.clone(),
            _ => Dictionary::new(),
        };
        let mut properties = match resources.get(b"Properties") {
            Ok(Object::Dictionary(d)) => d.clone(),
            Ok(Object::Reference(id)) => doc.get_object(*id)?.as_dict()?.clone(),
            _ => Dictionary::new(),
        };
        properties.set("OCU", Object::Reference(ocg_id));
        resources.set("Properties", Object::Dictionary(properties));
        page.set("Resources", Object::Dictionary(resources));

        doc.objects.insert(page_id, Object::Dictionary(page));
    }
    Ok(())
}
