/**
 * DI tokens for every port of @code-guardian/core.
 *
 * Shared by the API and the worker. `Symbol.for` keys are process-global, so tokens
 * stay equal even if a package ends up loaded twice. Adapters are chosen only where
 * these tokens are provided (the persistence/system modules here, plus each app's own adapters).
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
/** The PrismaClient owned by PrismaPersistenceModule. */
export const PRISMA_CLIENT = Symbol.for('code-guardian:PrismaClient');
