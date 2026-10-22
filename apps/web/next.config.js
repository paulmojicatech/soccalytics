//@ts-check
const path = require('node:path');


/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace libs ship TypeScript source; let Next compile them.
  transpilePackages: ['@soccalytics/contracts'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
    // Resolve the workspace lib to its TS source (the `@soccalytics/source`
    // export condition) so no `nx build contracts` step is required.
    resolveAlias: {
      '@soccalytics/contracts': './libs/contracts/src/index.ts',
    },
  },
  webpack: (config) => {
    config.resolve.conditionNames = ['@soccalytics/source', '...'];
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

module.exports = nextConfig;
