import checkFile from 'eslint-plugin-check-file';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const RE_EXPORT_MESSAGE = 're-export 금지: 소스 파일에서 직접 import 하세요.';
const ARROW_MESSAGE = 'function 키워드 대신 화살표 함수를 사용하세요.';
const BLOCK_STATEMENTS = ['if', 'for', 'while', 'do', 'switch', 'try'];
const DECLARATIONS = ['const', 'let', 'var'];

// Next.js App Router convention files keep their required lower-case names.
const NEXT_CONVENTION_NAMES = [
  'page',
  'layout',
  'route',
  'template',
  'default',
  'loading',
  'error',
  'global-error',
  'not-found',
  'forbidden',
  'unauthorized',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'sitemap',
  'robots',
  'manifest',
];
const PASCAL_CASE_GLOB = '+([A-Z])*([a-zA-Z0-9])';

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
        { selector: 'ExportNamedDeclaration[source]', message: RE_EXPORT_MESSAGE },
        { selector: 'ExportAllDeclaration', message: RE_EXPORT_MESSAGE },
        { selector: 'FunctionDeclaration', message: ARROW_MESSAGE },
        {
          selector:
            'FunctionExpression:not(MethodDefinition > FunctionExpression, Property[method=true] > FunctionExpression)',
          message: ARROW_MESSAGE,
        },
        {
          selector: 'TSUnionType > TSLiteralType > Literal[raw=/^[\'"]/]',
          message: '문자열 리터럴 유니언 대신 src/domain/enums/ 의 string enum 을 사용하세요.',
        },
        {
          selector: 'TSEnumMember:not([initializer.type="Literal"][initializer.raw=/^[\'"]/])',
          message: 'enum 멤버는 문자열 값을 명시하세요 (숫자·암묵 enum 금지).',
        },
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: DECLARATIONS },
        { blankLine: 'always', prev: DECLARATIONS, next: '*' },
        { blankLine: 'any', prev: DECLARATIONS, next: DECLARATIONS },
        { blankLine: 'always', prev: '*', next: BLOCK_STATEMENTS },
        { blankLine: 'always', prev: BLOCK_STATEMENTS, next: '*' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/no-index': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'e2e/**/*.ts'],
    // Next.js convention files outside app/: proxy.ts (Next 16, formerly middleware.ts) at the src root.
    ignores: ['src/app/**', 'src/proxy.ts'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx}': `@(${[...NEXT_CONVENTION_NAMES, PASCAL_CASE_GLOB].join('|')})` },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
]);

export default eslintConfig;
