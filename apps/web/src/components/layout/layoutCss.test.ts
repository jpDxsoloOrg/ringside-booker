/**
 * @vitest-environment node
 *
 * The layout helpers map each spacing step to a class; this checks every class points at the
 * matching token, so a gap can never drift from the spacing scale.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPACE_STEPS } from './space';

const layoutCss = readFileSync(new URL('./layout.module.css', import.meta.url), 'utf8');

describe('layout.module.css', () => {
  it.each(SPACE_STEPS)('maps gap step %i to its spacing token', (step) => {
    const rule = new RegExp(
      `\\.gap-${String(step)} \\{\\s*gap: var\\(--space-${String(step)}\\);\\s*\\}`,
    );
    expect(layoutCss).toMatch(rule);
  });
});
