/**
 * Single-process entrypoint: `node --max-old-space-size=150 dist/index.js`
 * (the assignment's self-test command).
 *
 * APP_MODE picks what runs in this process:
 *   all     (default) API + worker together, handy locally and for the OOM self-test
 *   api     HTTP/GraphQL only        (docker-compose `api` service)
 *   worker  BullMQ consumer only     (docker-compose `worker` service)
 *
 * The same build serves every mode, so the Docker image is shared by both services.
 */
import 'reflect-metadata';
import { type INestApplicationContext } from '@nestjs/common';
import { bootstrapApi } from '@code-guardian/api';
import { bootstrapWorker } from '@code-guardian/worker';

type AppMode = 'all' | 'api' | 'worker';

function readMode(raw: string | undefined): AppMode {
  const mode = raw ?? 'all';
  if (mode === 'all' || mode === 'api' || mode === 'worker') return mode;
  throw new Error(`Invalid APP_MODE "${mode}" (expected all | api | worker)`);
}

async function main(): Promise<void> {
  const mode = readMode(process.env.APP_MODE);
  const runApi = mode !== 'worker';
  const runWorker = mode !== 'api';

  // Started in this order, closed in reverse: the worker stops taking jobs (finishing the
  // active one) before the API stops accepting requests.
  const apps: INestApplicationContext[] = [];
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    process.stdout.write(`Received ${signal}, shutting down (${mode})\n`);
    for (const app of [...apps].reverse()) {
      try {
        await app.close();
      } catch (error: unknown) {
        process.stderr.write(`Error during shutdown: ${String(error)}\n`);
      }
    }
    process.exit(0);
  };
  // This process owns signals; the Nest apps must not install their own handlers
  // (Nest re-raises the signal after closing one app, cutting the other one short).
  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));

  if (runApi) {
    apps.push(await bootstrapApi({ handleSignals: false, installGlobalLogger: true }));
  }
  if (runWorker) {
    // Nest's global logger is process-wide: only the first app installs it.
    apps.push(await bootstrapWorker({ handleSignals: false, installGlobalLogger: !runApi }));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
