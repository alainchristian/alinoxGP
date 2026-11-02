/** @type {import('jest').Config} */
const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] };
const common = { moduleFileExtensions: ['js', 'json', 'ts'], transform, testEnvironment: 'node', rootDir: '.' };

module.exports = {
  testTimeout: 30000,
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
    {
      ...common,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
    {
      // Steady-traffic smoke test (part of the done-check, not of every `pnpm test`): `pnpm --filter @gps/api test:smoke`.
      ...common,
      displayName: 'smoke',
      testMatch: ['<rootDir>/test/**/*.smoke-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      testTimeout: 360_000,
    },
  ],
};
