// Bundles the Lambda entry points into dist/lambda.js (CommonJS, Node 20). The AWS SDK v3 is part
// of the Lambda runtime, so it stays out of the bundle.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/lambda.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@aws-sdk/*'],
  legalComments: 'none',
  logLevel: 'info',
});
