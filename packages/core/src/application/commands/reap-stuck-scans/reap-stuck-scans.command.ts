export class ReapStuckScansCommand {
  constructor(readonly limit = 100) {}
}

export interface ReapStuckScansResult {
  readonly inspected: number;
  readonly failed: number;
}
