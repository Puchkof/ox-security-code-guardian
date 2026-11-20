import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getScan, startScan } from './client';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('client', () => {
  it('returns a validated start response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ scanId: 'a', status: 'Queued' }, 202)));
    await expect(startScan('https://github.com/x/y')).resolves.toEqual({
      scanId: 'a',
      status: 'Queued',
    });
  });

  it('maps API error bodies to ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ error: { code: 'INVALID_URL', message: 'Bad URL' } }, 400)),
    );
    await expect(startScan('x')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_URL',
      message: 'Bad URL',
    });
  });

  it('handles 404 without an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(getScan('missing')).rejects.toMatchObject({ status: 404, code: 'HTTP_ERROR' });
  });

  it('rejects malformed success payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ id: 1 })));
    await expect(getScan('a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('wraps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    const err = await getScan('a').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
