// Flat ESLint config for nadstore-core.
// Enforces the module boundary table from the architecture document (section 4)
// with eslint-plugin-boundaries v7 (`boundaries/dependencies`), plus the code
// rules from section 20.
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const MODULE_TYPES = [
  'main',
  'config',
  'logger',
  'crypto',
  'http',
  'registry',
  'tenancy',
  'keys',
  'provisioning',
  'migrations',
  'jobs',
  'services',
  'admin',
  'audit',
];

// Shared infrastructure every module may rely on (see DECISIONS.md D2/D3):
// - config: the single validated view of the environment
// - logger: the only sanctioned way to log
const SHARED = ['config', 'logger'];

/** Internal imports each module may depend on (first-match policy list). */
const INTERNAL_OF = {
  config: [],
  logger: ['config'],
  crypto: [],
  http: [...SHARED, 'crypto', 'registry', 'tenancy', 'keys', 'audit'],
  registry: [...SHARED, 'crypto'],
  tenancy: [...SHARED, 'crypto', 'registry', 'keys'],
  keys: [...SHARED, 'crypto', 'registry', 'audit'],
  provisioning: [...SHARED, 'crypto', 'registry', 'audit'],
  migrations: [...SHARED, 'crypto', 'registry', 'audit'],
  jobs: [...SHARED, 'registry'],
  services: [...SHARED, 'crypto', 'registry', 'jobs', 'audit', 'http'],
  admin: [...SHARED, 'crypto', 'registry', 'keys', 'provisioning', 'migrations', 'audit', 'http'],
  audit: [...SHARED, 'registry'],
};

const DB_MODULES = ['registry', 'provisioning', 'migrations'];
const OTHER_MODULES = MODULE_TYPES.filter((type) => type !== 'main' && !DB_MODULES.includes(type));

const ELEMENTS = [
  { type: 'main', pattern: 'src/main.*.ts' },
  { type: 'config', pattern: 'src/config/**' },
  { type: 'logger', pattern: 'src/logger/**' },
  { type: 'crypto', pattern: 'src/crypto/**' },
  { type: 'http', pattern: 'src/http/**' },
  { type: 'registry', pattern: 'src/registry/**' },
  { type: 'tenancy', pattern: 'src/tenancy/**' },
  { type: 'keys', pattern: 'src/keys/**' },
  { type: 'provisioning', pattern: 'src/provisioning/**' },
  { type: 'migrations', pattern: 'src/migrations/**' },
  { type: 'jobs', pattern: 'src/jobs/**' },
  { type: 'services', pattern: 'src/services/**' },
  { type: 'admin', pattern: 'src/admin/**' },
  { type: 'audit', pattern: 'src/audit/**' },
];

function toElementSelector(types) {
  return types.length > 0 ? { to: { element: { types: { anyOf: types } } } } : null;
}

const POLICIES = [
  // Test files (colocated unit tests + integration suite) may import anything.
  {
    from: { file: { categories: 'test' } },
    allow: [
      { to: { element: { types: { anyOf: MODULE_TYPES } } } },
      { to: { file: { categories: 'test' } } },
      { to: { module: { origin: 'external', source: '*' } } },
    ],
  },
  // main.*.ts are the composition roots — they wire every module together.
  {
    from: { element: { type: 'main' } },
    allow: [
      { to: { element: { types: { anyOf: MODULE_TYPES } } } },
      { to: { module: { origin: 'external', source: '*' } } },
    ],
  },
  // Only registry, provisioning and migrations may touch kysely/mysql2
  // (architecture document, section 4 "قوانین اضافه").
  {
    from: { element: { types: { anyOf: DB_MODULES } } },
    allow: [
      toElementSelector(DB_MODULES.flatMap((type) => INTERNAL_OF[type])) ?? {
        to: { element: { types: { anyOf: [] } } },
      },
      { to: { module: { origin: 'external', source: '*' } } },
    ],
  },
  // Every other module: per-module internal imports, all externals except
  // kysely/mysql2.
  ...OTHER_MODULES.map((type) => ({
    from: { element: { type } },
    allow: [
      ...(toElementSelector(INTERNAL_OF[type]) !== null ? [toElementSelector(INTERNAL_OF[type])] : []),
      { to: { module: { origin: 'external', source: '!(kysely|mysql2)' } } },
    ].filter((selector) => selector !== null),
  })),
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENTS,
      'boundaries/files': [
        { pattern: ['test/**/*', 'src/**/*.test.ts'], category: 'test' },
      ],
      'import/resolver': { typescript: { alwaysTryTypes: true } },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: POLICIES }],
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'default exports are forbidden (except in tool config files)',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Tool config files keep their conventional default export.
  { files: ['vitest.config.ts'], rules: { 'no-restricted-syntax': 'off' } },
);
