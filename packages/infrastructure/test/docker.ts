import { execFileSync } from 'node:child_process';

/**
 * Integration specs need a container runtime. Checked synchronously at module load
 * so suites can be declared with `describe.skip` instead of failing in beforeAll.
 * Set SKIP_INTEGRATION=1 to skip them even when Docker is running.
 */
function detectDocker(): boolean {
  if (process.env.SKIP_INTEGRATION === '1') return false;
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export const dockerAvailable = detectDocker();

export const describeWithDocker: jest.Describe = dockerAvailable ? describe : describe.skip;

if (!dockerAvailable) {
  console.warn('Docker is not available: integration specs are skipped.');
}
