import { type Scan } from '../../domain';

export interface ScanRepository {
  /** Inserts or updates the aggregate. */
  save(scan: Scan): Promise<void>;
  findById(id: string): Promise<Scan | null>;
}
