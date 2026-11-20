import { type Severity, type Vulnerability } from '../../domain';

export interface ReportParseOptions {
  /** Only findings with one of these severities are yielded. */
  readonly severities: ReadonlySet<Severity>;
  readonly signal?: AbortSignal;
}

export interface ReportParser {
  /**
   * Streams findings from a report file one at a time.
   * Implementations must keep memory use bounded whatever the file size,
   * so the whole document is never loaded.
   */
  stream(reportFile: string, options: ReportParseOptions): AsyncIterable<Vulnerability>;
}
