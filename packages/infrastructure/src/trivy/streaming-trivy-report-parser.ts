import { createReadStream } from 'node:fs';
import { addAbortSignal, type Readable } from 'node:stream';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { ignore } from 'stream-json/filters/Ignore';
import { pick } from 'stream-json/filters/Pick';
import { streamValues } from 'stream-json/streamers/StreamValues';
import {
  isSeverity,
  ReportParseFailedError,
  ScanFailure,
  ScanTimeoutError,
  type Logger,
  type ReportParseOptions,
  type ReportParser,
  type Severity,
  type Vulnerability,
} from '@code-guardian/core';

/**
 * Keeps only each Result's `Target` and its individual vulnerability objects.
 * Matching vulnerabilities one by one (not whole Results) matters: a single
 * Result such as a big package-lock.json can hold tens of thousands of findings.
 */
const PICK_PATH = /^Results\.\d+\.(?:Target|Vulnerabilities\.\d+)$/;

/**
 * Heavy fields we never expose. Dropping them at the token level means they are
 * never assembled into JS objects, which cuts allocations and GC pressure a lot.
 */
const DROP_PATH =
  /^Results\.\d+\.Vulnerabilities\.\d+\.(?:Description|References|CVSS|VendorSeverity|CweIDs|DataSource|Layer|PkgIdentifier)$/;

/**
 * stream-json tokenizes each chunk it receives in one go, emitting every token of that
 * chunk even when downstream is paused. Peak heap therefore scales with
 * chunk size × pipeline stages, not with file size. Measured on a 583MB report:
 * 64KB chunks need about 48MB of heap, 16KB chunks run under a 32MB heap at the same
 * throughput.
 */
export const DEFAULT_READ_CHUNK_BYTES = 16 * 1024;

export interface StreamingTrivyReportParserOptions {
  /** Read chunk size; peak memory scales with it (see DEFAULT_READ_CHUNK_BYTES). */
  readonly highWaterMark?: number;
  readonly logger?: Logger;
}

interface StreamValuesChunk {
  readonly key: number;
  readonly value: unknown;
}

function isStreamValuesChunk(chunk: unknown): chunk is StreamValuesChunk {
  return typeof chunk === 'object' && chunk !== null && 'value' in chunk;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Streams vulnerabilities out of a Trivy JSON report of any size, with memory
 * bounded by the read buffer plus one vulnerability object.
 *
 * Pipeline: fs.ReadStream → tokenizer → Ignore(heavy fields) → Pick(Target | vuln) → StreamValues
 *
 * Values arrive in document order, so a string is the Target of the Result
 * that the following vulnerability objects belong to. (Trivy always writes
 * `Target` before `Vulnerabilities`.)
 */
export class StreamingTrivyReportParser implements ReportParser {
  private readonly highWaterMark: number;
  private readonly logger: Logger | undefined;

  constructor(options: StreamingTrivyReportParserOptions = {}) {
    this.highWaterMark = options.highWaterMark ?? DEFAULT_READ_CHUNK_BYTES;
    this.logger = options.logger;
  }

  async *stream(reportFile: string, options: ReportParseOptions): AsyncGenerator<Vulnerability> {
    const source: Readable = createReadStream(reportFile, { highWaterMark: this.highWaterMark });
    if (options.signal) addAbortSignal(options.signal, source);

    const pipeline = chain([
      source,
      parser({ streamValues: false }),
      ignore({ filter: DROP_PATH }),
      pick({ filter: PICK_PATH }),
      streamValues(),
    ]);
    // stream-chain does not forward errors from the first stream; do it explicitly.
    source.on('error', (error) => pipeline.destroy(error));

    let currentTarget = '';
    let skipped = 0;
    try {
      for await (const chunk of pipeline as AsyncIterable<unknown>) {
        if (!isStreamValuesChunk(chunk)) continue;
        const { value } = chunk;
        if (typeof value === 'string') {
          currentTarget = value;
          continue;
        }
        const vulnerability = this.toVulnerability(value, currentTarget, options.severities);
        if (vulnerability === 'skip') continue;
        if (vulnerability === 'invalid') {
          skipped += 1;
          continue;
        }
        yield vulnerability;
      }
    } catch (error: unknown) {
      throw this.mapError(error, reportFile, options.signal);
    } finally {
      pipeline.destroy();
      source.destroy();
      if (skipped > 0) {
        this.logger?.warn('Skipped malformed vulnerability entries', { reportFile, skipped });
      }
    }
  }

  private toVulnerability(
    value: unknown,
    target: string,
    severities: ReadonlySet<Severity>,
  ): Vulnerability | 'skip' | 'invalid' {
    if (!isRecord(value)) return 'invalid';
    const severity = value.Severity;
    if (!isSeverity(severity)) return 'invalid';
    // Filter before validating the rest: most findings are discarded here.
    if (!severities.has(severity)) return 'skip';

    const { VulnerabilityID, PkgName, InstalledVersion } = value;
    if (
      typeof VulnerabilityID !== 'string' ||
      typeof PkgName !== 'string' ||
      typeof InstalledVersion !== 'string'
    ) {
      return 'invalid';
    }
    return {
      vulnerabilityId: VulnerabilityID,
      pkgName: PkgName,
      installedVersion: InstalledVersion,
      fixedVersion: optionalString(value.FixedVersion),
      severity,
      title: optionalString(value.Title),
      primaryUrl: optionalString(value.PrimaryURL),
      target,
    };
  }

  private mapError(error: unknown, reportFile: string, signal?: AbortSignal): ScanFailure {
    if (error instanceof ScanFailure) return error;
    if (signal?.aborted) return new ScanTimeoutError('parse', { cause: error });
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'ENOENT') {
        return new ReportParseFailedError(`Report file not found: ${reportFile}`, { cause: error });
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new ReportParseFailedError(`Invalid Trivy report: ${detail}`, { cause: error });
  }
}
