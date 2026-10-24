import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'dist/**', 'script.js', 'work/**'] },
  { ...js.configs.recommended, files: ['src/app/**/*.js', 'scripts/**/*.mjs', 'sw.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker, ...globals.node } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] }
  }
];
