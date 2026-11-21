import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';

/** A scratch directory holding tiny shell scripts that stand in for git/trivy. */
export class FakeBinaries {
  private constructor(readonly dir: string) {}

  static async create(): Promise<FakeBinaries> {
    return new FakeBinaries(await mkdtemp(path.join(tmpdir(), 'cg-fake-bin-')));
  }

  /** Writes an executable `sh` script and returns its path. */
  async script(name: string, body: string): Promise<string> {
    const file = path.join(this.dir, name);
    await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
    await chmod(file, 0o755);
    return file;
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/** Reads a tiny test artefact through a stream (the codebase bans readFile on purpose). */
export function readSmallFile(file: string): Promise<string> {
  return text(createReadStream(file, { encoding: 'utf8' }));
}
