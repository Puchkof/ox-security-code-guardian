import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type App } from 'supertest/types';
import { bootstrapApi } from '../src';

describe('bootstrapApi', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('starts a listening app without touching process signal handlers', async () => {
    const sigtermListeners = process.listenerCount('SIGTERM');
    app = await bootstrapApi({ port: 0, handleSignals: false, installGlobalLogger: false });

    await request(app.getHttpServer()).get('/health').expect(200);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
  });
});
