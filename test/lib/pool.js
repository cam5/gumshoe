/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once. Each of `concurrency`
 * loops pulls the next unclaimed index off a shared counter and awaits the worker for it, so a
 * fast item doesn't sit idle waiting for a slower sibling the way a fixed-size chunking scheme
 * would -- the pool stays full until the item list runs out.
 */
export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runNext() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}
