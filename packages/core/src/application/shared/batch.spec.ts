import { inBatches } from './batch';

async function* range(n: number): AsyncGenerator<number> {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
    yield i;
  }
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe('inBatches', () => {
  it('groups items and flushes the remainder', async () => {
    expect(await collect(inBatches(range(7), 3))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });

  it('yields nothing for an empty source', async () => {
    expect(await collect(inBatches(range(0), 3))).toEqual([]);
  });

  it('pulls from the source lazily (backpressure)', async () => {
    let produced = 0;
    async function* counting(): AsyncGenerator<number> {
      for (let i = 0; i < 100; i += 1) {
        produced += 1;
        await Promise.resolve();
        yield i;
      }
    }
    const iterator = inBatches(counting(), 10)[Symbol.asyncIterator]();
    await iterator.next();
    expect(produced).toBeLessThanOrEqual(11);
    await iterator.return(undefined);
  });

  it('rejects invalid sizes', async () => {
    await expect(collect(inBatches(range(1), 0))).rejects.toThrow(RangeError);
  });
});
