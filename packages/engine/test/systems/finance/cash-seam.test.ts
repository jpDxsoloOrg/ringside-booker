// No code but postMoney moves a promotion's cash (ECO1-01). Design: docs/design/finances.md#postmoney
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/**
 * Files allowed to write `promotions.cash`, relative to `packages/engine/src`.
 *
 * Opening balances are not movements: a new world's promotions get their starting cash when they
 * are created (pack materialisation, founding a promotion) or reset by the "Equal start" new-game
 * step. Every movement after day one goes through `postMoney`.
 */
const CASH_WRITERS: readonly string[] = [
  'systems/finance/post.ts',
  // Opening balances only.
  'systems/newgame/builtinSteps.ts',
  'systems/newgame/foundPromotion.ts',
  'persistence/packs/materialise.ts',
];

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

/** The text of the call whose `(` is at `open`, up to its matching `)`. */
function callText(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }
  return source.slice(open);
}

const PROMOTION_WRITE = /\.(?:update|insert|create|_put)\(\s*['"`]promotions['"`]/g;
const CASH_ASSIGNMENT = /\.cash\s*(?:[-+*/]?=)(?!=)/;

/** The ways `source` writes a promotion's cash, as short descriptions; empty when it does not. */
function cashWrites(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(PROMOTION_WRITE)) {
    const open = match.index + match[0].indexOf('(');
    if (/\bcash\b/.test(callText(source, open))) {
      found.push(`a promotions write that sets cash (${match[0].trim()})`);
    }
  }
  if (CASH_ASSIGNMENT.test(source)) {
    found.push('an assignment to .cash');
  }
  return found;
}

describe('the cash seam', () => {
  it('finds the ways code can write cash', () => {
    expect(
      cashWrites("tx.update('promotions', id, (p) => ({ ...p, cash: add(p.cash, amount) }));"),
    ).toHaveLength(1);
    expect(cashWrites("ctx.tx.update(\n  'promotions',\n  id,\n  { cash },\n);")).toHaveLength(1);
    expect(cashWrites("tx.create('promotions', { name, cash: cents(5) })")).toHaveLength(1);
    expect(cashWrites('promotion.cash -= 100;')).toHaveLength(1);
    expect(cashWrites("tx.update('promotions', id, { regionalPop: after });")).toEqual([]);
    expect(cashWrites('if (promotion.cash === 0) { return; }')).toEqual([]);
  });

  it('lets only postMoney and the opening-balance writers change promotions.cash', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !CASH_WRITERS.includes(file))
      .flatMap((file) =>
        cashWrites(readFileSync(join(SRC, file), 'utf8')).map((write) => `${file}: ${write}`),
      );
    expect(offenders).toEqual([]);
  });

  it('allow-lists only files that exist, and postMoney does write cash', () => {
    const files = sourceFiles(SRC);
    for (const file of CASH_WRITERS) {
      expect(files, file).toContain(file);
    }
    expect(cashWrites(readFileSync(join(SRC, 'systems/finance/post.ts'), 'utf8'))).not.toEqual([]);
  });
});
