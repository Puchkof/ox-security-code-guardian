import {
  SCAN_STATUSES,
  type ApiErrorBody,
  type CreateScanResponse,
  type ScanResult,
  type ScanStatus,
  type Vulnerability,
} from './types';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);

const isStatus = (v: unknown): v is ScanStatus =>
  isStr(v) && (SCAN_STATUSES as readonly string[]).includes(v);

const isErrorBody = (v: unknown): v is { error: ApiErrorBody } =>
  isRec(v) && isRec(v.error) && isStr(v.error.code) && isStr(v.error.message);

export const isVulnerability = (v: unknown): v is Vulnerability =>
  isRec(v) &&
  isStr(v.vulnerabilityId) &&
  isStr(v.pkgName) &&
  isStr(v.installedVersion) &&
  isStrOrNull(v.fixedVersion) &&
  isStr(v.severity) &&
  isStrOrNull(v.title) &&
  isStrOrNull(v.primaryUrl) &&
  isStr(v.target);

export const isCreateScanResponse = (v: unknown): v is CreateScanResponse =>
  isRec(v) && isStr(v.scanId) && isStatus(v.status);

export const isScanResult = (v: unknown): v is ScanResult =>
  isRec(v) &&
  isStr(v.id) &&
  isStr(v.repoUrl) &&
  isStatus(v.status) &&
  isStrOrNull(v.failureReason) &&
  (v.criticalCount === null || typeof v.criticalCount === 'number') &&
  isStr(v.createdAt) &&
  isStr(v.updatedAt) &&
  isStrOrNull(v.startedAt) &&
  isStrOrNull(v.finishedAt) &&
  (v.criticalVulnerabilities === null ||
    (Array.isArray(v.criticalVulnerabilities) && v.criticalVulnerabilities.every(isVulnerability))) &&
  isStrOrNull(v.nextCursor);

async function request<T>(
  path: string,
  guard: (v: unknown) => v is T,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection.', 0, 'NETWORK_ERROR');
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    if (isErrorBody(body)) throw new ApiError(body.error.message, res.status, body.error.code);
    throw new ApiError(`Request failed with status ${res.status}`, res.status, 'HTTP_ERROR');
  }
  if (!guard(body)) {
    throw new ApiError('Unexpected response from the server.', res.status, 'INVALID_RESPONSE');
  }
  return body;
}

export function startScan(repoUrl: string, signal?: AbortSignal): Promise<CreateScanResponse> {
  return request('/api/scan', isCreateScanResponse, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
    signal,
  });
}

export function getScan(
  scanId: string,
  options: { cursor?: string | null; signal?: AbortSignal } = {},
): Promise<ScanResult> {
  const qs = options.cursor ? `?cursor=${encodeURIComponent(options.cursor)}` : '';
  return request(`/api/scan/${encodeURIComponent(scanId)}${qs}`, isScanResult, {
    signal: options.signal,
  });
}
