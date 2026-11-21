import { ReapStuckScansCommand } from '@code-guardian/core';
import { SilentLogger } from '@code-guardian/core/testing';
import { type CommandBus } from '@nestjs/cqrs';
import { ScanReaper } from '../src/scan/scan-reaper';

describe('ScanReaper', () => {
  it('dispatches ReapStuckScansCommand and survives a failing pass', async () => {
    const execute = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ inspected: 0, failed: 0 });
    const reaper = new ScanReaper({ execute } as unknown as CommandBus, 60_000, new SilentLogger());

    await expect(reaper.tick()).resolves.toBeUndefined();
    await expect(reaper.tick()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(ReapStuckScansCommand);
  });

  it('stops its timer on shutdown', async () => {
    const reaper = new ScanReaper(
      { execute: jest.fn() } as unknown as CommandBus,
      60_000,
      new SilentLogger(),
    );
    reaper.onApplicationBootstrap();
    await expect(reaper.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
