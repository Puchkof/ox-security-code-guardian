import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InsufficientStorageError } from '@code-guardian/core';
import { TmpWorkspaceProvider, WORKSPACE_PREFIX } from './tmp-workspace-provider';

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe('TmpWorkspaceProvider', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = path.join(await mkdtemp(path.join(tmpdir(), 'cg-ws-')), 'nested', 'base');
  });
  afterEach(async () => {
    await rm(path.dirname(path.dirname(baseDir)), { recursive: true, force: true });
  });

  it('creates a private workspace under the base dir (creating the base dir)', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    const workspace = await provider.create('3f1c9d2e-0000-4000-8000-000000000001');

    const root = path.dirname(workspace.sourceDir);
    expect(path.dirname(root)).toBe(baseDir);
    expect(path.basename(root).startsWith(`${WORKSPACE_PREFIX}3f1c9d2e-`)).toBe(true);
    expect(path.dirname(workspace.reportFile)).toBe(root);
    expect(await exists(root)).toBe(true);
    // git clone needs a missing (or empty) destination.
    expect(await exists(workspace.sourceDir)).toBe(false);
  });

  it('gives two runs of the same scan different directories', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    const a = await provider.create('same');
    const b = await provider.create('same');
    expect(a.sourceDir).not.toBe(b.sourceDir);
  });

  it('sanitises the scan id used in the directory name', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    const workspace = await provider.create('../../etc/passwd');
    expect(path.dirname(path.dirname(workspace.sourceDir))).toBe(baseDir);
  });

  it('dispose removes everything and is idempotent', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    const workspace = await provider.create('scan');
    await mkdir(workspace.sourceDir, { recursive: true });
    await writeFile(path.join(workspace.sourceDir, 'package.json'), '{}');
    await writeFile(workspace.reportFile, '{}');

    await workspace.dispose();
    await workspace.dispose();

    expect(await exists(path.dirname(workspace.sourceDir))).toBe(false);
  });

  it('refuses with InsufficientStorageError when free space is below the threshold', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: Number.MAX_SAFE_INTEGER });
    await expect(provider.create('scan')).rejects.toBeInstanceOf(InsufficientStorageError);
  });

  it('reports positive free space', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    await provider.create('scan');
    expect(await provider.freeBytes()).toBeGreaterThan(0);
  });

  it('sweepOrphans removes only old workspace directories', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    const old = await provider.create('old');
    const fresh = await provider.create('fresh');
    const oldRoot = path.dirname(old.sourceDir);
    const freshRoot = path.dirname(fresh.sourceDir);
    const foreign = path.join(baseDir, 'not-ours');
    await mkdir(foreign);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(oldRoot, twoHoursAgo, twoHoursAgo);
    await utimes(foreign, twoHoursAgo, twoHoursAgo);

    const removed = await provider.sweepOrphans(60 * 60 * 1000);

    expect(removed).toBe(1);
    expect(await exists(oldRoot)).toBe(false);
    expect(await exists(freshRoot)).toBe(true);
    expect(await exists(foreign)).toBe(true);
  });

  it('sweepOrphans tolerates a missing base dir', async () => {
    const provider = new TmpWorkspaceProvider({ baseDir, minFreeBytes: 0 });
    await expect(provider.sweepOrphans(0)).resolves.toBe(0);
  });
});
