// Runs before any test module is imported: the root module validates env at import time.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
