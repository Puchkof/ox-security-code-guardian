import { type Scan } from '../../domain';

export interface ScanRepository {
  /**
   * Inserts a new scan (version 0) or updates it only if the stored version still equals
   * `scan.version`; on success the aggregate is marked with the new version.
   * Rejects with ConcurrentScanUpdateError when another writer got there first.
   */
  save(scan: Scan): Promise<void>;
  findById(id: string): Promise<Scan | null>;
  /** Queued/Scanning scans last updated before `before`, oldest first (used by the reaper). */
  findNonTerminalUpdatedBefore(before: Date, limit: number): Promise<Scan[]>;
}
