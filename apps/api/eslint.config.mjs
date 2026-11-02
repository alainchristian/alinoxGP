import { base } from '@gps/config/eslint';

export default [
  ...base,
  { rules: { '@typescript-eslint/no-extraneous-class': 'off' } },
  {
    // Plain CommonJS scripts (fixture capture, jest config) legitimately use require().
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
