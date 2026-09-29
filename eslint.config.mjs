import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'drizzle/**',
    '.data/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      curly: ['error', 'all'],
      'func-style': ['error', 'expression'],
      'prefer-arrow-callback': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[source]',
          message: 're-export 금지: 소스 파일에서 직접 import 하세요.',
        },
        {
          selector: 'ExportAllDeclaration',
          message: 're-export 금지: 소스 파일에서 직접 import 하세요.',
        },
        {
          selector: 'FunctionDeclaration',
          message: 'function 키워드 대신 화살표 함수를 사용하세요.',
        },
        {
          selector:
            'FunctionExpression:not(MethodDefinition > FunctionExpression, Property[method=true] > FunctionExpression)',
          message: 'function 키워드 대신 화살표 함수를 사용하세요.',
        },
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: 'if' },
        { blankLine: 'always', prev: 'if', next: '*' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]);

export default eslintConfig;
