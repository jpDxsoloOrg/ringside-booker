// Only health.injure hurts anyone (WRK6-03). Design: docs/design/health.md#injuries
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/** Every `.ts` file under `dir`, as paths relative to `SRC` with `/` separators. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      files.push(relative(SRC, path).split(sep).join('/'));
    }
  }
  return files;
}

/** The files whose text matches `pattern`, sorted. */
function filesMatching(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(join(SRC, file), 'utf8')))
    .sort();
}

describe('who writes injuries', () => {
  it('only health.injure inserts into the injuries table', () => {
    expect(filesMatching(/\.(?:insert|create|_put)\(\s*['"`]injuries['"`]/)).toEqual([
      'systems/health/injure.ts',
    ]);
  });

  it('only health.injure sets a current injury on a person', () => {
    // An injury pointer is written as `injury: { kindKey, ... }`; nothing else builds one. (Other
    // objects may have a field called `injury`, such as the physical toll's per-worker result.)
    expect(filesMatching(/\binjury\s*:\s*\{\s*kindKey\b/)).toEqual(['systems/health/injure.ts']);
  });

  it('only the return step closes an injury or clears the pointer of an existing person', () => {
    expect(filesMatching(/\.update\(\s*['"`]injuries['"`]/)).toEqual(['systems/health/returns.ts']);
    // New people start uninjured; after that only a return clears the pointer.
    expect(filesMatching(/\binjury\s*:\s*null\b/)).toEqual([
      'persistence/packs/materialise.ts',
      'systems/health/returns.ts',
      'systems/world/people/generate.ts',
    ]);
  });
});
