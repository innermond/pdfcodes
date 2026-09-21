use lopdf::{Document, Object, Stream, Dictionary};

// Deep-copy an object (and, recursively, anything it references) from `src`
// into `dst`, renumbering object IDs so they don't collide with `dst`'s
// existing objects. Used to pull a background page's content/resources from
// a separately-loaded contour PDF into the print document for `--combineb`.
pub(crate) fn import_object(
    src: &Document,
    dst: &mut Document,
    obj: &Object,
    id_map: &mut std::collections::HashMap<lopdf::ObjectId, lopdf::ObjectId>,
) -> Object {
    match obj {
        Object::Reference(id) => {
            if let Some(new_id) = id_map.get(id) {
                return Object::Reference(*new_id);
            }
            dst.max_id += 1;
            let new_id = (dst.max_id, 0);
            id_map.insert(*id, new_id);
            if let Ok(referenced) = src.get_object(*id) {
                let imported = import_object(src, dst, referenced, id_map);
                dst.objects.insert(new_id, imported);
            }
            Object::Reference(new_id)
        }
        Object::Dictionary(dict) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in dict.iter() {
                new_dict.set(k.clone(), import_object(src, dst, v, id_map));
            }
            Object::Dictionary(new_dict)
        }
        Object::Array(arr) => Object::Array(arr.iter().map(|v| import_object(src, dst, v, id_map)).collect()),
        Object::Stream(stream) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in stream.dict.iter() {
                new_dict.set(k.clone(), import_object(src, dst, v, id_map));
            }
            Object::Stream(Stream::new(new_dict, stream.content.clone()))
        }
        other => other.clone(),
    }
}

// Copy every page of `src`'s page tree into `dst`, appending them (in
// document order) to `dst`'s own Pages/Kids, translating each page's
// MediaBox/Contents/Resources/Rotate (and everything they reference) via
// `import_object`. Used to join the N per-background-page runs of
// `generate_pdf` into one combined document — call once per run, in page
// order, against a running `dst`.
pub(crate) fn append_pages(dst: &mut Document, src: &Document) -> Result<(), Box<dyn std::error::Error>> {
    let dst_catalog_id = dst.trailer.get(b"Root")?.as_reference()?;
    let dst_pages_id = dst.get_object(dst_catalog_id)?.as_dict()?.get(b"Pages")?.as_reference()?;

    let mut id_map = std::collections::HashMap::new();
    for (_, src_page_id) in src.get_pages() {
        let src_page_dict = src.get_object(src_page_id)?.as_dict()?;

        let mut new_page = Dictionary::new();
        new_page.set("Type", Object::Name(b"Page".to_vec()));
        new_page.set("Parent", Object::Reference(dst_pages_id));
        for key in [b"MediaBox".as_slice(), b"Contents", b"Resources", b"Rotate"] {
            if let Ok(value) = src_page_dict.get(key) {
                let imported = import_object(src, dst, value, &mut id_map);
                new_page.set(key, imported);
            }
        }
        let new_page_id = dst.add_object(Object::Dictionary(new_page));

        let pages_dict = dst.get_object(dst_pages_id)?.as_dict()?.clone();
        let mut kids = pages_dict.get(b"Kids")?.as_array()?.clone();
        kids.push(Object::Reference(new_page_id));
        let mut new_pages_dict = pages_dict;
        let count = kids.len() as i64;
        new_pages_dict.set("Kids", Object::Array(kids));
        new_pages_dict.set("Count", Object::Integer(count));
        dst.objects.insert(dst_pages_id, Object::Dictionary(new_pages_dict));
    }
    Ok(())
}
