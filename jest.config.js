/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  verbose: true,
  // Keep tests fast; increase if needed for network
  testTimeout: 180000,
};


