import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // 対象外ディレクトリ・ファイル
  // src/**/*.js は tsc が出力するコンパイル済みファイルで TypeScript ソースと二重管理になるため除外
  { ignores: ['dist', 'coverage', 'e2e', '*.config.{js,ts}', 'src/**/*.js'] },

  // TypeScript + React ルール
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // 一般
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // テストファイルの緩和ルール
  {
    files: ['src/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Prettier との競合ルールを無効化 (必ず最後に配置)
  prettierConfig,
);
