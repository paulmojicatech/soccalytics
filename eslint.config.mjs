import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Layering: contracts ← domain ← (data | ai | platform) ← apps
            { sourceTag: 'type:contracts', onlyDependOnLibsWithTags: [] },
            { sourceTag: 'type:domain', onlyDependOnLibsWithTags: ['type:contracts'] },
            { sourceTag: 'type:data', onlyDependOnLibsWithTags: ['type:contracts'] },
            { sourceTag: 'type:ai', onlyDependOnLibsWithTags: ['type:contracts'] },
            { sourceTag: 'type:platform', onlyDependOnLibsWithTags: ['type:contracts'] },
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:contracts', 'type:domain', 'type:data', 'type:ai', 'type:platform'] },
            // The browser bundle may only use shared, side-effect-free libs.
            { sourceTag: 'scope:frontend', onlyDependOnLibsWithTags: ['scope:shared'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
