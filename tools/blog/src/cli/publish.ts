import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { runPublishCommand } from '../publish/command';
import { ENV_FILE_REPO_PATH, loadEnvFile } from '../publish/env';

// `npm run blog:publish -- <file> | --all | --index-only [--dry-run] [--no-write-back] [--allow-new-slug]`
// See tools/blog/README.md. Publishing is a local command only: it refuses to run when CI is set,
// and the database URL is read from the gitignored tools/blog/.env.local and nowhere else.

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

process.exitCode = await runPublishCommand(process.argv.slice(2), {
  repoRoot: REPO_ROOT,
  processEnv: process.env,
  loadEnvFile: async () => loadEnvFile(join(REPO_ROOT, ENV_FILE_REPO_PATH), ENV_FILE_REPO_PATH),
  connect: async (databaseUrl) => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return client;
  },
  now: () => new Date(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
