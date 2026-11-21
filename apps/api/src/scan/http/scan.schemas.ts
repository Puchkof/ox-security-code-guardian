import { MAX_PAGE_SIZE } from '@code-guardian/core';
import { z } from 'zod';

export const startScanBodySchema = z.object({
  repoUrl: z.string().trim().min(1).max(2048),
});
export type StartScanBody = z.output<typeof startScanBodySchema>;

export const scanIdSchema = z.string().trim().min(1).max(128);

export const getScanQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(256).optional(),
});
export type GetScanQueryParams = z.output<typeof getScanQuerySchema>;
