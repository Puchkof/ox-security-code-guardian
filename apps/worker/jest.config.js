/** @type {import('jest').Config} */
module.exports = {
  displayName: 'worker',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  moduleNameMapper: {
    '^@code-guardian/core$': '<rootDir>/../../packages/core/src',
    '^@code-guardian/core/testing$': '<rootDir>/../../packages/core/src/testing',
    '^@code-guardian/infrastructure$': '<rootDir>/../../packages/infrastructure/src',
    '^@code-guardian/nest-common$': '<rootDir>/../../packages/nest-common/src',
  },
};
