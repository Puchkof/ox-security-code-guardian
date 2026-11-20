export const ScanStatus = {
  Queued: 'Queued',
  Scanning: 'Scanning',
  Finished: 'Finished',
  Failed: 'Failed',
} as const;

export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const TERMINAL_STATUSES: ReadonlySet<ScanStatus> = new Set([
  ScanStatus.Finished,
  ScanStatus.Failed,
]);
