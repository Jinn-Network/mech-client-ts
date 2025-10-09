/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // Skip E2E tests in CI (require private keys)
    process.env.CI ? '/__tests__/e2e' : null,
  ].filter(Boolean),
  verbose: true,
  // Keep tests fast; increase if needed for network
  testTimeout: 180000,
};


