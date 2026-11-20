/**
 * DI tokens for every port of @code-guardian/core.
 *
 * `Symbol.for` keys are global, so the API app (which mirrors this file) and the
 * worker resolve the same token if both modules are ever composed into one process.
 * Adapters are chosen only where these tokens are provided: see `src/adapters`.
 */
export const SCAN_REPOSITORY = Symbol.for('code-guardian:ScanRepository');
export const VULNERABILITY_REPOSITORY = Symbol.for('code-guardian:VulnerabilityRepository');
export const SCAN_JOB_QUEUE = Symbol.for('code-guardian:ScanJobQueue');
export const WORKSPACE_PROVIDER = Symbol.for('code-guardian:WorkspaceProvider');
export const REPOSITORY_CLONER = Symbol.for('code-guardian:RepositoryCloner');
export const SECURITY_SCANNER = Symbol.for('code-guardian:SecurityScanner');
export const REPORT_PARSER = Symbol.for('code-guardian:ReportParser');
export const CLOCK = Symbol.for('code-guardian:Clock');
export const ID_GENERATOR = Symbol.for('code-guardian:IdGenerator');
export const LOGGER = Symbol.for('code-guardian:Logger');
export const SCAN_PIPELINE_CONFIG = Symbol.for('code-guardian:ScanPipelineConfig');
