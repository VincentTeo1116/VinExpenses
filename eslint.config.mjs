import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', 'dist-e2e', 'screenshots', 'legacy', 'node_modules', 'supabase', 'tests', 'tools', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts', 'scripts/**/*.{ts,mjs}', '*.ts', '*.mts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Security rules: nothing may turn text into live HTML or code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Never build HTML from text. Use JSX text so React escapes it.' },
        { selector: "MemberExpression[property.name='innerHTML']", message: 'Never write innerHTML.' },
        { selector: "MemberExpression[property.name='outerHTML']", message: 'Never write outerHTML.' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Never insert raw HTML.' },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'document.write is not allowed.' },
        { selector: "JSXAttribute[name.name='style']", message: 'No inline styles: the policy blocks them. Use a CSS class.' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
  },
  {
    // the redirect page script also loads in Node for its tests; the replacement service worker runs in a worker
    files: ['redirect/redirect.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.commonjs }, sourceType: 'script' },
  },
  {
    files: ['redirect/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker }, sourceType: 'script' },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'src/test/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off', 'no-script-url': 'off' },
  },
);
