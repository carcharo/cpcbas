// ESLint flat config. The library (packages/cpcbas/src) must stay pure: no Node or
// VS Code imports, no clock, no randomness (see CLAUDE.md). bin/ and tests may use Node.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeModules = ['fs', 'path', 'os', 'child_process', 'process', 'url', 'crypto', 'util', 'module'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'lib/**', 'tests/**', '.worktrees/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/cpcbas/src/**/*.ts'],
    ignores: ['packages/cpcbas/src/**/*.test.ts', 'packages/cpcbas/src/node/**'], // src/node is the Node-only `./node` entry
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'The library is pure: no Node imports (files come in as a virtual tree).' },
            { group: ['vscode'], message: 'The library never imports vscode.' },
          ],
          paths: nodeModules.map((name) => ({ name, message: 'The library is pure: no Node imports.' })),
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'The library never reads the process; the host passes options.' },
        { name: 'Date', message: 'Deterministic output: no clock in the library (the host passes buildDate / now).' },
        { name: 'require', message: 'ES modules only.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Deterministic output: no randomness in the compiler.' },
      ],
    },
  },
);
