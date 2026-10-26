'use strict';

// Fixed worker count; failure stops admission and waits for already admitted
// requests. No Promise.all over an unbounded collection or orphaned work.
module.exports = async function mapWithConcurrency(items, concurrency, visit) {
  const results = new Array(items.length);
  const workers = Number.isInteger(concurrency) && concurrency > 0 ? Math.min(16, concurrency) : 4;
  let next = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(items.length, workers) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await visit(items[index], index); }
      catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return results;
};
