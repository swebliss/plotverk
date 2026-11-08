module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // The real `obsidian` package is types-only (esbuild marks it external and the host
  // supplies it at runtime), so anything value-importing from it cannot load under Node.
  // See src/__mocks__/obsidian.ts.
  moduleNameMapper: { '^obsidian$': '<rootDir>/src/__mocks__/obsidian.ts' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__mocks__/**'],
};
