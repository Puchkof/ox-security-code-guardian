/** @type {import('jest').Config} */
module.exports = {
  displayName: 'infrastructure',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@code-guardian/core$': '<rootDir>/../core/src',
    '^@code-guardian/core/testing$': '<rootDir>/../core/src/testing',
  },
  passWithNoTests: true,
};
