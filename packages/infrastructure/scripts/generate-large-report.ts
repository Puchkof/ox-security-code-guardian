/**
 * Generates a Trivy-shaped JSON report of roughly the requested size, streaming
 * it to disk (constant memory).
 *
 *   node dist/bench/scripts/generate-large-report.js <out.json> [sizeMB=600]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeSyntheticTrivyReport } from '../src/trivy/fixtures/write-trivy-report';

const VULNS_PER_RESULT = 5_000;
const DESCRIPTION_BYTES = 1_200;
/** Measured average size of one generated entry with the settings above. */
const APPROX_BYTES_PER_VULN = 1_820;

async function main(): Promise<void> {
  const [out, sizeArg] = process.argv.slice(2);
  if (!out) throw new Error('Usage: generate-large-report <out.json> [sizeMB]');
  const targetBytes = Number(sizeArg ?? '600') * 1024 * 1024;
  const results = Math.max(1, Math.ceil(targetBytes / APPROX_BYTES_PER_VULN / VULNS_PER_RESULT));

  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const started = Date.now();
  const stats = await writeSyntheticTrivyReport(out, {
    results,
    vulnerabilitiesPerResult: VULNS_PER_RESULT,
    criticalEvery: 50,
    descriptionBytes: DESCRIPTION_BYTES,
  });
  const mb = (stats.bytes / 1024 / 1024).toFixed(1);
  console.log(
    `Wrote ${out}: ${mb} MB, ${stats.vulnerabilities} vulnerabilities, ${stats.critical} critical, in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
