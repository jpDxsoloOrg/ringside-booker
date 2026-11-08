/**
 * Entry point: `npm run validate:world -- [options]` from the repository root, or
 * `npm run validate -w @ringside/validate-world -- <packDir...> [options]`.
 * See `run.ts` for the options and exit codes.
 */

import { fileURLToPath } from 'node:url';
import { runValidateWorld } from './run';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

process.exitCode = await runValidateWorld(process.argv.slice(2), {
  repoRoot: REPO_ROOT,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
