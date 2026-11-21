export interface SecurityScanner {
  /**
   * Scans `sourceDir` and writes the raw JSON report to `reportFile`.
   * The report can be very large, so it goes to disk and is never returned in memory.
   */
  scan(sourceDir: string, reportFile: string, signal: AbortSignal): Promise<void>;
}
