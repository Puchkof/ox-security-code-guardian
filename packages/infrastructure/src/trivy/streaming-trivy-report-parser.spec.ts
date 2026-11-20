import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ReportParseFailedError,
  ScanTimeoutError,
  Severity,
  type Vulnerability,
} from '@code-guardian/core';
import { writeSyntheticTrivyReport } from './fixtures/write-trivy-report';
import { StreamingTrivyReportParser } from './streaming-trivy-report-parser';

const CRITICAL = new Set([Severity.Critical]);

describe('StreamingTrivyReportParser', () => {
  let dir: string;
  const parser = new StreamingTrivyReportParser({ highWaterMark: 1024 });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cg-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function report(content: unknown): Promise<string> {
    const file = path.join(dir, 'report.json');
    await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
  }

  async function collect(
    file: string,
    severities: ReadonlySet<Severity> = CRITICAL,
    signal?: AbortSignal,
  ): Promise<Vulnerability[]> {
    const out: Vulnerability[] = [];
    for await (const v of parser.stream(file, { severities, signal })) out.push(v);
    return out;
  }

  const base = {
    VulnerabilityID: 'CVE-1',
    PkgName: 'lodash',
    InstalledVersion: '4.17.4',
    FixedVersion: '4.17.21',
    Title: 'Prototype pollution',
    PrimaryURL: 'https://avd.aquasec.com/nvd/cve-1',
    Description: 'long text',
    References: ['https://a'],
  };

  it('yields only CRITICAL findings and attaches the owning Result target', async () => {
    const file = await report({
      SchemaVersion: 2,
      ArtifactName: '.',
      Results: [
        {
          Target: 'package-lock.json',
          Class: 'lang-pkgs',
          Vulnerabilities: [
            { ...base, VulnerabilityID: 'CVE-A', Severity: 'CRITICAL' },
            { ...base, VulnerabilityID: 'CVE-B', Severity: 'HIGH' },
          ],
        },
        { Target: 'Gemfile.lock', Class: 'lang-pkgs' },
        {
          Target: 'app/package.json',
          Vulnerabilities: [
            { ...base, VulnerabilityID: 'CVE-C', Severity: 'CRITICAL', FixedVersion: '' },
          ],
        },
      ],
    });

    expect(await collect(file)).toEqual([
      {
        vulnerabilityId: 'CVE-A',
        pkgName: 'lodash',
        installedVersion: '4.17.4',
        fixedVersion: '4.17.21',
        severity: 'CRITICAL',
        title: 'Prototype pollution',
        primaryUrl: 'https://avd.aquasec.com/nvd/cve-1',
        target: 'package-lock.json',
      },
      expect.objectContaining({
        vulnerabilityId: 'CVE-C',
        target: 'app/package.json',
        fixedVersion: null,
      }),
    ]);
  });

  it('honours the requested severities', async () => {
    const file = await report({
      Results: [
        {
          Target: 't',
          Vulnerabilities: [
            { ...base, VulnerabilityID: 'H', Severity: 'HIGH' },
            { ...base, VulnerabilityID: 'L', Severity: 'LOW' },
          ],
        },
      ],
    });
    const ids = (await collect(file, new Set([Severity.High]))).map((v) => v.vulnerabilityId);
    expect(ids).toEqual(['H']);
  });

  it('handles reports without findings', async () => {
    expect(await collect(await report({ SchemaVersion: 2, Results: [] }))).toEqual([]);
    expect(await collect(await report({ SchemaVersion: 2 }))).toEqual([]);
    expect(await collect(await report({ Results: null }))).toEqual([]);
  });

  it('skips malformed entries instead of failing the scan', async () => {
    const file = await report({
      Results: [
        {
          Target: 't',
          Vulnerabilities: [
            { Severity: 'CRITICAL', PkgName: 'no-id', InstalledVersion: '1' },
            'garbage',
            { ...base, Severity: 'NOT-A-SEVERITY' },
            { ...base, VulnerabilityID: 'OK', Severity: 'CRITICAL' },
          ],
        },
      ],
    });
    expect((await collect(file)).map((v) => v.vulnerabilityId)).toEqual(['OK']);
  });

  it('fails with ReportParseFailedError on truncated JSON', async () => {
    const file = await report('{"Results":[{"Target":"t","Vulnerabilities":[{"Severity":"CRI');
    await expect(collect(file)).rejects.toBeInstanceOf(ReportParseFailedError);
  });

  it('fails with ReportParseFailedError when the report is missing', async () => {
    await expect(collect(path.join(dir, 'missing.json'))).rejects.toThrow(/not found/);
  });

  it('maps an aborted parse to ScanTimeoutError', async () => {
    const file = path.join(dir, 'big.json');
    await writeSyntheticTrivyReport(file, {
      results: 5,
      vulnerabilitiesPerResult: 200,
      criticalEvery: 1,
      descriptionBytes: 100,
    });
    const controller = new AbortController();
    const seen: Vulnerability[] = [];
    await expect(
      (async () => {
        for await (const v of parser.stream(file, {
          severities: CRITICAL,
          signal: controller.signal,
        })) {
          seen.push(v);
          if (seen.length === 10) controller.abort();
        }
      })(),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    expect(seen.length).toBeLessThan(1000);
  });

  it('streams a generated multi-MB report and counts every critical', async () => {
    const file = path.join(dir, 'synthetic.json');
    const stats = await writeSyntheticTrivyReport(file, {
      results: 20,
      vulnerabilitiesPerResult: 500,
      criticalEvery: 7,
      descriptionBytes: 400,
    });
    expect(stats.bytes).toBeGreaterThan(5_000_000);

    let count = 0;
    for await (const v of new StreamingTrivyReportParser().stream(file, { severities: CRITICAL })) {
      expect(v.severity).toBe('CRITICAL');
      count += 1;
    }
    expect(count).toBe(stats.critical);
  });

  it('stops reading when the consumer stops early', async () => {
    const file = path.join(dir, 'early.json');
    await writeSyntheticTrivyReport(file, {
      results: 2,
      vulnerabilitiesPerResult: 100,
      criticalEvery: 1,
      descriptionBytes: 10,
    });
    const iterator = parser.stream(file, { severities: CRITICAL });
    let count = 0;
    while (count < 3 && !(await iterator.next()).done) count += 1;
    await iterator.return(undefined);
    expect(count).toBe(3);
  });
});
