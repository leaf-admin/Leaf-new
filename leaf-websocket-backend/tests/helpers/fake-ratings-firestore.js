'use strict';

// Minimal Firestore for the ratings store: docs, create() conflicts inside a
// transaction, batches and equality queries.
function fakeRatingsFirestore() {
  const docs = new Map();
  const ref = (collection, id) => ({
    path: `${collection}/${id}`,
    get: async () => ({ exists: docs.has(`${collection}/${id}`), data: () => docs.get(`${collection}/${id}`) }),
    set: async value => { docs.set(`${collection}/${id}`, value); }
  });
  const query = (collection, filters = []) => ({
    where: (field, _op, value) => query(collection, [...filters, [field, value]]),
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([path, value]) => path.startsWith(`${collection}/`) && filters.every(([f, v]) => value[f] === v))
        .map(([, value]) => ({ data: () => value }))
    })
  });
  return {
    docs,
    paths: () => [...docs.keys()],
    collection: name => ({ doc: id => ref(name, id), where: (f, op, v) => query(name).where(f, op, v) }),
    batch: () => {
      const ops = [];
      return { set: (target, value) => ops.push([target.path, value]), commit: async () => ops.forEach(([p, v]) => docs.set(p, v)) };
    },
    runTransaction: async fn => {
      const pending = [];
      const result = await fn({
        get: target => target.get(),
        create: (target, value) => {
          if (docs.has(target.path)) throw Object.assign(new Error('exists'), { code: 6 });
          pending.push([target.path, value]);
        }
      });
      pending.forEach(([p, v]) => docs.set(p, v));
      return result;
    }
  };
}

module.exports = { fakeRatingsFirestore };
