/**
 * Groups an async stream into arrays of at most `size` items.
 * The consumer pulls the next batch only after handling the previous one, so
 * backpressure carries through to the source stream and memory stays O(size).
 */
export async function* inBatches<T>(source: AsyncIterable<T>, size: number): AsyncGenerator<T[]> {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Batch size must be a positive integer, got ${size}`);
  }
  let batch: T[] = [];
  for await (const item of source) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}
