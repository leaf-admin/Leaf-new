// Transaction model with optimistic conflict retries; no provider/network access.
function memoryFirestore(seed = {}) {
  const records = new Map(Object.entries(seed));
  let sequence = 0;
  let version = 0;
  const snapshot = ref => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => records.get(ref.path) });
  const isDelete = value => typeof value?.isEqual === 'function' && value.isEqual(require('@google-cloud/firestore').FieldValue.delete());
  const write = (ref, value, options) => {
    if (options?.mergeFields) {
      // Only the listed top-level fields change; FieldValue.delete() removes one.
      const next = { ...(records.get(ref.path) || {}) };
      for (const field of options.mergeFields) {
        const name = field.segments?.[0] ?? String(field);
        if (isDelete(value[name])) delete next[name];
        else next[name] = value[name];
      }
      records.set(ref.path, next);
    } else {
      records.set(ref.path, options?.merge ? { ...records.get(ref.path), ...value } : value);
    }
    version += 1;
  };
  const collection = path => ({
    doc: (id = `auto-${++sequence}`) => {
      const ref = { path: `${path}/${id}`, id, collection: name => collection(`${path}/${id}/${name}`) };
      ref.get = async () => snapshot(ref);
      ref.set = async (value, options) => write(ref, value, options);
      return ref;
    },
    where: (field, _op, value) => ({ get: async () => ({ docs: [...records.entries()]
      .filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1 && data[field] === value)
      .map(([key]) => snapshot(collection(path).doc(key.split('/').pop()))) }) })
  });
  return { records, collection, runTransaction: async callback => {
    for (let retry = 0; retry < 30; retry += 1) {
      const start = version;
      const pending = [];
      const result = await callback({
        get: async ref => snapshot(ref),
        set: (ref, value, options) => pending.push(() => write(ref, value, options)),
        delete: ref => pending.push(() => { records.delete(ref.path); version += 1; })
      });
      if (version !== start) continue;
      pending.forEach(commit => commit());
      return result;
    }
    throw new Error('transaction contention');
  } };
}
module.exports = { memoryFirestore };
