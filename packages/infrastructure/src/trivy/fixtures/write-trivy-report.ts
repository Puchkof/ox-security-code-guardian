import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';

export interface SyntheticReportOptions {
  readonly results: number;
  readonly vulnerabilitiesPerResult: number;
  /** Every Nth vulnerability is CRITICAL; the rest rotate through other severities. */
  readonly criticalEvery: number;
  /** Size of the padded Description field, used to inflate the report. */
  readonly descriptionBytes: number;
}

export interface SyntheticReportStats {
  readonly bytes: number;
  readonly vulnerabilities: number;
  readonly critical: number;
}

const OTHER_SEVERITIES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;

async function write(out: WriteStream, chunk: string): Promise<void> {
  if (!out.write(chunk)) await once(out, 'drain');
}

/**
 * Writes a Trivy-shaped JSON report incrementally (honouring backpressure), so
 * multi-GB fixtures can be generated with constant memory.
 */
export async function writeSyntheticTrivyReport(
  file: string,
  options: SyntheticReportOptions,
): Promise<SyntheticReportStats> {
  const out = createWriteStream(file, { highWaterMark: 1 << 20 });
  const padding = 'x'.repeat(options.descriptionBytes);
  let vulnerabilities = 0;
  let critical = 0;

  await write(
    out,
    `{"SchemaVersion":2,"CreatedAt":"2026-11-20T00:00:00Z","ArtifactName":"synthetic","ArtifactType":"filesystem","Metadata":{"ImageConfig":{}},"Results":[`,
  );
  for (let r = 0; r < options.results; r += 1) {
    await write(
      out,
      `${r > 0 ? ',' : ''}{"Target":"target-${r}/package-lock.json","Class":"lang-pkgs","Type":"npm","Vulnerabilities":[`,
    );
    for (let v = 0; v < options.vulnerabilitiesPerResult; v += 1) {
      const isCritical = vulnerabilities % options.criticalEvery === 0;
      const severity = isCritical
        ? 'CRITICAL'
        : (OTHER_SEVERITIES[vulnerabilities % OTHER_SEVERITIES.length] ?? 'LOW');
      if (isCritical) critical += 1;
      const entry = {
        VulnerabilityID: `CVE-2026-${vulnerabilities}`,
        PkgID: `pkg-${v}@1.0.0`,
        PkgName: `pkg-${v}`,
        InstalledVersion: '1.0.0',
        FixedVersion: '1.0.1',
        Status: 'fixed',
        SeveritySource: 'ghsa',
        PrimaryURL: `https://avd.aquasec.com/nvd/cve-2026-${vulnerabilities}`,
        DataSource: {
          ID: 'ghsa',
          Name: 'GitHub Security Advisory npm',
          URL: 'https://github.com/advisories',
        },
        Title: `Synthetic vulnerability ${vulnerabilities}`,
        Description: padding,
        Severity: severity,
        CweIDs: ['CWE-79'],
        CVSS: { nvd: { V3Vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', V3Score: 9.8 } },
        References: ['https://example.com/a', 'https://example.com/b'],
        PublishedDate: '2026-01-01T00:00:00Z',
      };
      await write(out, `${v > 0 ? ',' : ''}${JSON.stringify(entry)}`);
      vulnerabilities += 1;
    }
    await write(out, ']}');
  }
  await write(out, ']}');
  out.end();
  await once(out, 'finish');
  return { bytes: out.bytesWritten, vulnerabilities, critical };
}
