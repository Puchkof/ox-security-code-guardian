/**
 * Counter-example kept for the README: what the assignment forbids.
 * Under --max-old-space-size=150 this crashes on a 500MB+ report
 * ("JavaScript heap out of memory" / "Cannot create a string longer than ...").
 *
 *   node --max-old-space-size=150 dist/bench/scripts/naive-parse.js <report.json>
 */
/* eslint-disable no-restricted-imports, no-restricted-properties -- intentional anti-pattern demo */
import { readFile } from 'node:fs/promises';

interface NaiveReport {
  Results?: { Vulnerabilities?: { Severity: string }[] }[];
}

async function main(): Promise<void> {
  const [file] = process.argv.slice(2);
  if (!file) throw new Error('Usage: naive-parse <report.json>');
  const report = JSON.parse(await readFile(file, 'utf8')) as NaiveReport;
  const critical = (report.Results ?? [])
    .flatMap((r) => r.Vulnerabilities ?? [])
    .filter((v) => v.Severity === 'CRITICAL').length;
  console.log(`critical: ${critical}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
