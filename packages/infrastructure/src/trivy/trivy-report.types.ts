/**
 * The subset of Trivy's JSON report (SchemaVersion 2) this service reads.
 * Full schema: https://trivy.dev/latest/docs/configuration/reporting/#json
 *
 *   { "Results": [ { "Target": "...", "Vulnerabilities": [ TrivyVulnerability, ... ] }, ... ] }
 */
export interface TrivyVulnerability {
  readonly VulnerabilityID: string;
  readonly PkgName: string;
  readonly InstalledVersion: string;
  readonly FixedVersion?: string;
  readonly Severity: string;
  readonly Title?: string;
  readonly PrimaryURL?: string;
}
