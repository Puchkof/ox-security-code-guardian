import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CloneFailedError,
  InsufficientStorageError,
  RepoUrl,
  ScanTimeoutError,
} from '@code-guardian/core';
import { FakeBinaries, readSmallFile } from '../../test/fake-binary';
import { GitCliCloner } from './git-cli-cloner';

const repo = RepoUrl.create('https://github.com/OWASP/NodeGoat');

describe('GitCliCloner', () => {
  let bins: FakeBinaries;
  let workDir: string;

  beforeAll(async () => {
    bins = await FakeBinaries.create();
  });
  afterAll(async () => {
    await bins.dispose();
  });
  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'cg-clone-'));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const failingGit = (name: string, stderr: string, code = 128): Promise<string> =>
    bins.script(name, `printf '%s\\n' "${stderr}" >&2\nexit ${code}`);

  const neverAbort = (): AbortSignal => new AbortController().signal;

  it('passes a shallow, option-safe clone command and disables prompts', async () => {
    const argsFile = path.join(workDir, 'args');
    const envFile = path.join(workDir, 'env');
    const git = await bins.script(
      'git-ok',
      `for a in "$@"; do printf '%s\\n' "$a"; done > "${argsFile}"\nprintf '%s' "$GIT_TERMINAL_PROMPT" > "${envFile}"`,
    );

    await new GitCliCloner({ gitBinary: git }).clone(repo, path.join(workDir, 'src'), neverAbort());

    const args = (await readSmallFile(argsFile)).trim().split('\n');
    expect(args).toEqual([
      'clone',
      '--depth',
      '1',
      '--single-branch',
      '--no-tags',
      '--',
      'https://github.com/OWASP/NodeGoat.git',
      path.join(workDir, 'src'),
    ]);
    expect(await readSmallFile(envFile)).toBe('0');
  });

  it.each([
    [
      'missing repo',
      "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found",
    ],
    [
      'private repo',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ],
  ])('maps %s to a non-retryable CloneFailedError', async (_case, stderr) => {
    const git = await failingGit(`git-${_case.replace(' ', '-')}`, stderr);
    const error = await new GitCliCloner({ gitBinary: git })
      .clone(repo, path.join(workDir, 'src'), neverAbort())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error).toMatchObject({ retryable: false });
  });

  it.each([
    [
      'dns',
      "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com",
    ],
    ['eof', 'error: RPC failed; curl 92 HTTP/2 stream 0 was not closed cleanly\nfatal: early EOF'],
  ])('maps a %s network error to a retryable CloneFailedError', async (name, stderr) => {
    const git = await failingGit(`git-net-${name}`, stderr);
    const error = await new GitCliCloner({ gitBinary: git })
      .clone(repo, path.join(workDir, 'src'), neverAbort())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error).toMatchObject({ retryable: true });
  });

  it('maps "No space left on device" to InsufficientStorageError', async () => {
    const git = await failingGit(
      'git-enospc',
      'fatal: write error: No space left on device\nfatal: index-pack failed',
    );
    await expect(
      new GitCliCloner({ gitBinary: git }).clone(repo, path.join(workDir, 'src'), neverAbort()),
    ).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('maps an unknown failure to a retryable CloneFailedError with the stderr tail', async () => {
    const git = await failingGit('git-weird', 'fatal: something odd', 1);
    const error = await new GitCliCloner({ gitBinary: git })
      .clone(repo, path.join(workDir, 'src'), neverAbort())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: true });
    expect(String(error)).toContain('something odd');
  });

  it('kills git and throws ScanTimeoutError("clone") when the signal aborts', async () => {
    const git = await bins.script('git-slow', 'sleep 30');
    const started = Date.now();
    const error = await new GitCliCloner({ gitBinary: git })
      .clone(repo, path.join(workDir, 'src'), AbortSignal.timeout(200))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanTimeoutError);
    expect(error).toMatchObject({ stage: 'clone' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reports a missing git binary as a non-retryable failure', async () => {
    const error = await new GitCliCloner({ gitBinary: path.join(workDir, 'no-git') })
      .clone(repo, path.join(workDir, 'src'), neverAbort())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error).toMatchObject({ retryable: false });
    expect(String(error)).toContain('not installed');
  });
});
