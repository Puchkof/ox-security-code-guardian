/**
 * OOM proof: streams a (huge) Trivy report through the production parser and
 * reports peak memory. Run it under the assignment's heap limit:
 *
 *   node --max-old-space-size=150 dist/bench/scripts/parse-benchmark.js <report.json>
 */
import { stat } from 'node:fs/promises';
import { inBatches, Severity } from '@code-guardian/core';
import { StreamingTrivyReportParser } from '../src/trivy/streaming-trivy-report-parser';

const MB = 1024 * 1024;
const fmt = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`;

async function main(): Promise<void> {
  const [file] = process.argv.slice(2);
  if (!file) throw new Error('Usage: parse-benchmark <report.json>');
  const { size } = await stat(file);

  let peakHeap = 0;
  let peakRss = 0;
  const sample = (): void => {
    const { heapUsed, rss } = process.memoryUsage();
    peakHeap = Math.max(peakHeap, heapUsed);
    peakRss = Math.max(peakRss, rss);
  };
  const sampler = setInterval(sample, 25);

  const started = process.hrtime.bigint();
  let critical = 0;
  let batches = 0;
  const parser = new StreamingTrivyReportParser();
  // Same batching as the worker uses before writing to Postgres.
  for await (const batch of inBatches(
    parser.stream(file, { severities: new Set([Severity.Critical]) }),
    500,
  )) {
    critical += batch.length;
    batches += 1;
  }
  sample();
  clearInterval(sampler);

  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  console.log(
    [
      `report:        ${fmt(size)}`,
      `critical:      ${critical} (in ${batches} batches)`,
      `duration:      ${seconds.toFixed(1)}s (${(size / MB / seconds).toFixed(1)} MB/s)`,
      `peak heapUsed: ${fmt(peakHeap)}`,
      `peak RSS:      ${fmt(peakRss)}`,
      `heap limit:    ${fmt(Number(process.execArgv.find((a) => a.startsWith('--max-old-space-size='))?.split('=')[1] ?? 0) * MB)}`,
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
