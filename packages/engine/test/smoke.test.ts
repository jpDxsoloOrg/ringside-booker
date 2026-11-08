import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ENGINE_VERSION } from '@ringside/engine';

const packageManifestSchema = z.object({ version: z.string() });

async function readEnginePackageVersion(): Promise<string> {
  const manifestText = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const manifestJson: unknown = JSON.parse(manifestText);
  return packageManifestSchema.parse(manifestJson).version;
}

describe('engine smoke test', () => {
  it('exposes a semver ENGINE_VERSION', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps ENGINE_VERSION in step with package.json', async () => {
    expect(ENGINE_VERSION).toBe(await readEnginePackageVersion());
  });
});
