import { useState, type FormEvent } from 'react';
import { ApiError, getScan, startScan } from './api/client';
import type { ScanStatus, Vulnerability } from './api/types';
import { VulnerabilityTable } from './components/VulnerabilityTable';
import { useScanPolling } from './hooks/useScanPolling';

const isActive = (status: ScanStatus | undefined): boolean =>
  status === 'Queued' || status === 'Scanning';

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : 'Something went wrong.';

export function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [scanId, setScanId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [extra, setExtra] = useState<Vulnerability[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const { scan, error: pollError } = useScanPolling(scanId);

  const running =
    submitting || (scanId !== null && (scan === null ? !pollError : isActive(scan.status)));
  const nextCursor = cursor === undefined ? (scan?.nextCursor ?? null) : cursor;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (running) return;
    setSubmitting(true);
    setStartError(null);
    setScanId(null);
    setExtra([]);
    setCursor(undefined);
    setMoreError(null);
    try {
      const res = await startScan(repoUrl.trim());
      setScanId(res.scanId);
    } catch (err) {
      setStartError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!scanId || !nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await getScan(scanId, { cursor: nextCursor });
      setExtra((prev) => [...prev, ...(page.criticalVulnerabilities ?? [])]);
      setCursor(page.nextCursor);
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : messageOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = [...(scan?.criticalVulnerabilities ?? []), ...extra];
  const retryPending = scan?.status === 'Queued' && scan.failureReason !== null;

  return (
    <main>
      <h1>Code Guardian</h1>
      <p className="lead">Scan a public Git repository for critical vulnerabilities.</p>

      <form onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="repo-url">Repository URL</label>
        <div className="row">
          <input
            id="repo-url"
            type="url"
            required
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/<you>/NodeGoat"
          />
          <button type="submit" disabled={running}>
            {running ? 'Scanning…' : 'Start'}
          </button>
        </div>
      </form>

      {startError && (
        <p role="alert" className="error">
          {startError}
        </p>
      )}
      {pollError && (
        <p role="alert" className="error">
          {pollError.message}
        </p>
      )}

      {scan && (
        <section aria-live="polite" aria-label="Scan status">
          <p>
            Status:{' '}
            <span className={`badge badge-${scan.status.toLowerCase()}`}>{scan.status}</span>
          </p>
          {retryPending && (
            <p className="note">
              A previous attempt failed ({scan.failureReason}). A retry is pending.
            </p>
          )}
          {scan.status === 'Failed' && (
            <p role="alert" className="error">
              Scan failed: {scan.failureReason ?? 'unknown reason'}
            </p>
          )}
          {scan.status === 'Finished' && (
            <>
              <h2>Critical vulnerabilities: {scan.criticalCount ?? rows.length}</h2>
              <VulnerabilityTable items={rows} />
              {moreError && (
                <p role="alert" className="error">
                  {moreError}
                </p>
              )}
              {nextCursor && (
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
