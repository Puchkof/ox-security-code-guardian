import 'reflect-metadata';
import { bootstrapApi } from './bootstrap';

bootstrapApi().catch((error: unknown) => {
  console.error('API failed to start', error);
  process.exit(1);
});
