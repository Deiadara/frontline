// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Scratch space. `apps/client/.tmp` is where a throwaway Playwright config or a one-off probe
      // spec lands during a debugging run: gitignored, outside every tsconfig, and therefore a
      // parse error the moment lint walks it. Nothing in here is shipped code.
      '**/.tmp/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // ADR 0001 §5.4: the barrel drags all 40+ shaders into the bundle. Import the subpath.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pixi-filters',
              message:
                'Import the filter from its subpath (e.g. `pixi-filters/advanced-bloom`); the barrel is not tree-shakeable.',
            },
          ],
        },
      ],
    },
  },
);
