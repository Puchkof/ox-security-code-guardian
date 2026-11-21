import { InvalidScanTransitionError } from './errors';
import { RepoUrl } from './repo-url';
import { Scan } from './scan';
import { ScanStatus } from './scan-status';

const t0 = new Date('2026-01-01T00:00:00Z');
const t1 = new Date('2026-01-01T00:01:00Z');
const repo = RepoUrl.create('https://github.com/OWASP/NodeGoat');

describe('Scan state machine', () => {
  it('starts Queued', () => {
    const scan = Scan.queue('s1', repo, t0);
    expect(scan.status).toBe(ScanStatus.Queued);
    expect(scan.isTerminal).toBe(false);
  });

  it('runs the happy path Queued → Scanning → Finished', () => {
    const scan = Scan.queue('s1', repo, t0);
    scan.start('run-1', t0);
    scan.finish(3, t1);
    expect(scan.toSnapshot()).toMatchObject({
      status: ScanStatus.Finished,
      criticalCount: 3,
      startedAt: t0,
      finishedAt: t1,
      failureReason: null,
    });
    expect(scan.isTerminal).toBe(true);
  });

  it('can requeue after a transient failure and keeps the reason', () => {
    const scan = Scan.queue('s1', repo, t0);
    scan.start('run-1', t0);
    scan.requeue('network', t1);
    expect(scan.status).toBe(ScanStatus.Queued);
    expect(scan.toSnapshot().failureReason).toBe('network');
    scan.start('run-1', t1);
    expect(scan.toSnapshot().startedAt).toEqual(t0);
  });

  it('allows a stalled Scanning job to be started again', () => {
    const scan = Scan.queue('s1', repo, t0);
    scan.start('run-1', t0);
    expect(() => {
      scan.start('run-1', t1);
    }).not.toThrow();
  });

  it('can fail from Queued (enqueue failure) and from Scanning', () => {
    const queued = Scan.queue('s1', repo, t0);
    queued.fail('queue down', t1);
    expect(queued.status).toBe(ScanStatus.Failed);

    const scanning = Scan.queue('s2', repo, t0);
    scanning.start('run-1', t0);
    scanning.fail('trivy', t1);
    expect(scanning.toSnapshot()).toMatchObject({
      status: ScanStatus.Failed,
      failureReason: 'trivy',
    });
  });

  it.each([
    [
      'finish from Queued',
      (s: Scan) => {
        s.finish(0, t1);
      },
    ],
    [
      'requeue from Queued',
      (s: Scan) => {
        s.requeue('x', t1);
      },
    ],
  ])('rejects %s', (_label, act) => {
    expect(() => {
      act(Scan.queue('s1', repo, t0));
    }).toThrow(InvalidScanTransitionError);
  });

  it('treats Finished and Failed as terminal', () => {
    const finished = Scan.queue('s1', repo, t0);
    finished.start('run-1', t0);
    finished.finish(0, t1);
    expect(() => {
      finished.start('run-1', t1);
    }).toThrow(InvalidScanTransitionError);
    expect(() => {
      finished.fail('x', t1);
    }).toThrow(InvalidScanTransitionError);
  });
});
