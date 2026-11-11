import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// typescript-eslint is used only as the parser/rules that understand JSX (so components used only in markup count as used).
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri', 'backend', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,jsx,mjs}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
);
