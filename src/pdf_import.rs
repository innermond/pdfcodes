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
