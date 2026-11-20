export class StartScanCommand {
  constructor(readonly repoUrl: string) {}
}

export interface StartScanResult {
  readonly scanId: string;
  readonly status: 'Queued';
}
