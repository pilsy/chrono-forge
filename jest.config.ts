import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: [],
  setupFilesAfterEnv: ['./src/tests/jest.setup.ts'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/utils/instrumentation.ts',
    '<rootDir>/src/tests/testWorkflows/'
  ],
  coverageProvider: 'babel',
  coverageReporters: ['json', 'lcov', 'text', 'clover'],
  testEnvironmentOptions: {
    nodeOptions: ['--expose-gc']
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json'
      }
    ]
  },
  maxWorkers: 5,
  maxConcurrency: 10
};

export default config;
