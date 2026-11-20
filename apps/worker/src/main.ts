import 'reflect-metadata';
import { bootstrapWorker } from './bootstrap';

bootstrapWorker().catch((error: unknown) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
