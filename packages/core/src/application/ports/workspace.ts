/** A private temp directory for one scan run. */
export interface ScanWorkspace {
  /** Directory the repository is cloned into. */
  readonly sourceDir: string;
  /** Path the scanner writes its JSON report to. */
  readonly reportFile: string;
  /** Removes everything in the workspace. Safe to call more than once. */
  dispose(): Promise<void>;
}

export interface WorkspaceProvider {
  /** Creates a workspace. Rejects with InsufficientStorageError when free disk space is below the threshold. */
  create(scanId: string): Promise<ScanWorkspace>;
}
