import { base } from '@gps/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
];
