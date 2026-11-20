import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult, ScanStatus } from '../api/types';
import { useScanPolling } from './useScanPolling';

const scan = (status: ScanStatus): ScanResult => ({
  id: 's1',
  repoUrl: 'https://github.com/x/y',
  status,
  failureReason: null,
  criticalCount: status === 'Finished' ? 0 : null,
  createdAt: 't',
  updatedAt: 't',
  startedAt: null,
  finishedAt: null,
  criticalVulnerabilities: status === 'Finished' ? [] : null,
  nextCursor: null,
});

const ok = (s: ScanResult): Response => new Response(JSON.stringify(s));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useScanPolling', () => {
  it('polls every 2s and stops on Finished', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(scan('Queued')))
      .mockResolvedValueOnce(ok(scan('Scanning')))
      .mockResolvedValue(ok(scan('Finished')));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useScanPolling('s1'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.scan?.status).toBe('Queued');

    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.scan?.status).toBe('Finished');

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not overlap requests when a response is slow', async () => {
    let resolve: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useScanPolling('s1'));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => resolve(ok(scan('Scanning'))));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts and stops polling on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(scan('Scanning')));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = renderHook(() => useScanPolling('s1'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
