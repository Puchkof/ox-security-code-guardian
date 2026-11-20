import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InsufficientStorageError,
  ScannerFailedError,
  ScanTimeoutError,
} from '@code-guardian/core';
import { FakeBinaries, readSmallFile } from '../../test/fake-binary';
import { ScannerUnavailableError, TrivyCliScanner } from './trivy-cli-scanner';

/** Fake trivy: records its argv, then writes `{}` to the path after --output. */
const WRITE_REPORT = `
for a in "$@"; do printf '%s\\n' "$a"; done > "$ARGS_FILE"
while [ $# -gt 0 ]; do
  if [ "$1" = "--output" ]; then printf '{}' > "$2"; fi
  shift
done`;

describe('TrivyCliScanner', () => {
  let bins: FakeBinaries;
  let workDir: string;
  let reportFile: string;

  beforeAll(async () => {
    bins = await FakeBinaries.create();
  });
  afterAll(async () => {
    await bins.dispose();
  });
  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'cg-trivy-'));
    reportFile = path.join(workDir, 'report.json');
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const neverAbort = (): AbortSignal => new AbortController().signal;

  it('writes the report to disk with the expected arguments', async () => {
    const trivy = await bins.script('trivy-ok', WRITE_REPORT);
    const argsFile = path.join(workDir, 'args');
    const scanner = new TrivyCliScanner({
      trivyBinary: trivy,
      cacheDir: '/cache',
      serverUrl: 'http://trivy:4954',
      env: { ARGS_FILE: argsFile },
    });

    await scanner.scan('/src/repo', reportFile, neverAbort());

    expect((await stat(reportFile)).isFile()).toBe(true);
    const args = (await readSmallFile(argsFile)).trim().split('\n');
    expect(args).toEqual([
      'fs',
      '--scanners',
      'vuln',
      '--format',
      'json',
      '--output',
      reportFile,
      '--quiet',
      '--timeout',
      '60m',
      '--cache-dir',
      '/cache',
      '--server',
      'http://trivy:4954',
      '--',
      '/src/repo',
    ]);
  });

  it('omits optional flags when not configured', () => {
    const args = new TrivyCliScanner().buildArgs('/s', '/r.json');
    expect(args).not.toContain('--server');
    expect(args).not.toContain('--cache-dir');
    expect(args.slice(-2)).toEqual(['--', '/s']);
  });

  it('maps a non-zero exit to ScannerFailedError with exit code and stderr tail', async () => {
    const trivy = await bins.script(
      'trivy-fail',
      `echo "FATAL	init error: DB error: failed to download vulnerability DB" >&2\nexit 1`,
    );
    const error = await new TrivyCliScanner({ trivyBinary: trivy })
      .scan(workDir, reportFile, neverAbort())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScannerFailedError);
    expect(error).toMatchObject({ exitCode: 1, retryable: true });
    expect((error as ScannerFailedError).stderrTail).toContain(
      'failed to download vulnerability DB',
    );
  });

  it('maps "no space left on device" to InsufficientStorageError', async () => {
    const trivy = await bins.script(
      'trivy-enospc',
      `echo "write /tmp/report.json: no space left on device" >&2\nexit 1`,
    );
    await expect(
      new TrivyCliScanner({ trivyBinary: trivy }).scan(workDir, reportFile, neverAbort()),
    ).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('fails when trivy exits 0 without writing the report', async () => {
    const trivy = await bins.script('trivy-silent', 'exit 0');
    await expect(
      new TrivyCliScanner({ trivyBinary: trivy }).scan(workDir, reportFile, neverAbort()),
    ).rejects.toBeInstanceOf(ScannerFailedError);
  });

  it('kills trivy and throws ScanTimeoutError("scan") on abort', async () => {
    const trivy = await bins.script('trivy-slow', 'sleep 30');
    const error = await new TrivyCliScanner({ trivyBinary: trivy })
      .scan(workDir, reportFile, AbortSignal.timeout(200))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanTimeoutError);
    expect(error).toMatchObject({ stage: 'scan' });
  });

  it('reports a missing binary as a non-retryable "not installed" failure', async () => {
    const error = await new TrivyCliScanner({ trivyBinary: path.join(workDir, 'no-trivy') })
      .scan(workDir, reportFile, neverAbort())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScannerUnavailableError);
    expect(error).toMatchObject({ retryable: false, code: 'SCANNER_UNAVAILABLE' });
    expect(String(error)).toContain('not installed');
  });
});
