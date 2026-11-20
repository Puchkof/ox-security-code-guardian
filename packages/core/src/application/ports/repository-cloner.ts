import { type RepoUrl } from '../../domain';

export interface RepositoryCloner {
  /**
   * Shallow-clones the repository into `destination`.
   * Rejects with a ScanFailure (CloneFailedError / ScanTimeoutError / InsufficientStorageError).
   */
  clone(repoUrl: RepoUrl, destination: string, signal: AbortSignal): Promise<void>;
}
