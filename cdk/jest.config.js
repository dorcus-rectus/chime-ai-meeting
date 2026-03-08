/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // テスト用に esModuleInterop を有効化
          esModuleInterop: true,
          strict: true,
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020'],
          skipLibCheck: true,
        },
      },
    ],
  },
};
