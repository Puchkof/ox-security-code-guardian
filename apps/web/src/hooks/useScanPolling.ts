import { useEffect, useState } from 'react';
import { ApiError, getScan } from '../api/client';
import type { ScanResult } from '../api/types';

export const POLL_INTERVAL_MS = 2000;

export interface ScanPolling {
  scan: ScanResult | null;
  error: Error | null;
}

/**
 * Polls GET /api/scan/:id until the scan is Finished or Failed.
 * The next poll is scheduled only after the previous request settles,
 * and everything is cancelled on unmount or when scanId changes.
 */
export function useScanPolling(scanId: string | null): ScanPolling {
  const [state, setState] = useState<ScanPolling & { forId: string | null }>({
    scan: null,
    error: null,
    forId: null,
  });

  useEffect(() => {
    if (!scanId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      try {
        const scan = await getScan(scanId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({ scan, error: null, forId: scanId });
        if (scan.status === 'Finished' || scan.status === 'Failed') return;
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          scan: prev.forId === scanId ? prev.scan : null,
          error: err instanceof Error ? err : new Error(String(err)),
          forId: scanId,
        }));
        if (err instanceof ApiError && err.status === 404) return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [scanId]);

  if (!scanId || state.forId !== scanId) return { scan: null, error: null };
  return { scan: state.scan, error: state.error };
}
