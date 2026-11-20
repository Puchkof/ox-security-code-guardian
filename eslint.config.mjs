// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * The assignment forbids loading Trivy scan results into memory in one go.
 * These rules enforce that across the backend instead of relying on discipline:
 * results must be consumed through a stream pipeline.
 */
const MEMORY_SAFETY_MESSAGE =
  'Forbidden: scan results must be processed with a stream pipeline (see StreamingTrivyReportParser).';

const forbiddenFsImports = ['readFile', 'readFileSync'].map((name) => name);

export default tseslint.config(
  {
    ignores: ['.claude/**', '**/dist/**', '**/coverage/**', 'apps/web/**', '**/*.js', '**/*.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      'no-restricted-properties': [
        'error',
        { object: 'JSON', property: 'parse', message: MEMORY_SAFETY_MESSAGE },
        ...forbiddenFsImports.flatMap((property) => [
          { object: 'fs', property, message: MEMORY_SAFETY_MESSAGE },
          { object: 'fsp', property, message: MEMORY_SAFETY_MESSAGE },
        ]),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].map((name) => ({
            name,
            importNames: forbiddenFsImports,
            message: MEMORY_SAFETY_MESSAGE,
          })),
        },
      ],
    },
  },
  {
    // Tests may use relaxed typing helpers on mocks.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
