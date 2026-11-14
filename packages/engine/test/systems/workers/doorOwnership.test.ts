// The doors own push, alignment, role, popularity, momentum and morale.
// Design: docs/design/workers.md#doors
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('../../../src/', import.meta.url));

/** The one file allowed to write the guarded fields after the world exists. */
const DOORS_FILE = 'systems/workers/doors.ts';

/**
 * Code that builds a world rather than changing one: new-game setup, world generation and turning
 * a data pack into rows. These create people, promotions and employments with their first values.
 */
/**
 * Plus the `offered` employment of a contract offer (ECO5-04): an offer pays nothing and puts
 * nobody on a card, so its first values and the offer's later changes are written directly; once
 * signed, the doors own them again.
 */
const CREATION_PATHS = [
  'systems/newgame/',
  'systems/world/',
  'persistence/packs/',
  'systems/negotiation/offeredEmployment.ts',
] as const;

const GUARDED_TABLES = ['employments', 'people', 'promotions'] as const;
const GUARDED_FIELDS = ['push', 'alignment', 'role', 'morale', 'momentum', 'regionalPop'] as const;

const WRITE_CALL = new RegExp(
  `\\.(?:update|create|insert)\\(\\s*['"\`](?:${GUARDED_TABLES.join('|')})['"\`]`,
  'g',
);
/** A guarded field used as an object key: `{ push: ... }`, `{ push }` or `, push,`. */
const GUARDED_KEY = new RegExp(`[{,]\\s*(${GUARDED_FIELDS.join('|')})\\s*[:,}]`);

interface Violation {
  file: string;
  line: number;
  field: string;
}

/** The text of a call from its opening bracket to the bracket that closes it. */
function callText(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }
  return source.slice(openIndex);
}

/** Every write to a guarded table in `source` that names a guarded field in its patch. */
function findViolations(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  for (const match of source.matchAll(WRITE_CALL)) {
    const openIndex = source.indexOf('(', match.index);
    const field = GUARDED_KEY.exec(callText(source, openIndex))?.[1];
    if (field !== undefined) {
      violations.push({ file, line: source.slice(0, match.index).split('\n').length, field });
    }
  }
  return violations;
}

function sourceFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      return sourceFiles(`${directory}${entry.name}/`, `${relativePath}/`);
    }
    return relativePath.endsWith('.ts') ? [relativePath] : [];
  });
}

function isExempt(file: string): boolean {
  return file === DOORS_FILE || CREATION_PATHS.some((path) => file.startsWith(path));
}

describe('door ownership', () => {
  it('finds the engine source', () => {
    const files = sourceFiles(SOURCE_ROOT);
    expect(files).toContain(DOORS_FILE);
    expect(files.length).toBeGreaterThan(50);
  });

  it('only the doors write push, alignment, role, popularity, momentum and morale', () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .filter((file) => !isExempt(file))
      .flatMap((file) => findViolations(file, readFileSync(`${SOURCE_ROOT}${file}`, 'utf8')));
    const report = violations.map(
      ({ file, line, field }) =>
        `packages/engine/src/${file}:${String(line)} writes "${field}" directly. ` +
        `Use the door in systems/workers/doors.ts instead (setPush, setAlignment, setRole, ` +
        `applyPopularityChange, applyMomentumChange or applyMoraleChange), so the change is ` +
        `clamped, traced and published. See docs/design/workers.md#doors.`,
    );
    expect(report).toEqual([]);
  });

  it('sees the writes the doors themselves make, so the scan reads real code', () => {
    const fields = findViolations(
      DOORS_FILE,
      readFileSync(`${SOURCE_ROOT}${DOORS_FILE}`, 'utf8'),
    ).map((violation) => violation.field);
    expect(new Set(fields)).toEqual(new Set(GUARDED_FIELDS));
  });

  describe('the scan itself', () => {
    const cases: readonly (readonly [string, string, string | null])[] = [
      ['a patch', `ctx.tx.update('employments', id, { push: 'none' });`, 'push'],
      ['a shorthand key', `tx.update('employments', id, { morale });`, 'morale'],
      ['a later key', `tx.update('employments', id, { leave: null, momentum: 5 });`, 'momentum'],
      [
        'a patch over several lines',
        `tx.update(\n  'people',\n  id,\n  {\n    regionalPop,\n  },\n);`,
        'regionalPop',
      ],
      ['a created row', `tx.create('employments', { ...terms, alignment: 'heel' });`, 'alignment'],
      [
        'an updater',
        `tx.update('employments', id, (row) => ({ ...row, role: 'referee' }));`,
        'role',
      ],
      ['an unguarded field', `ctx.tx.update('people', id, { fatigue: 0 });`, null],
      ['a field with a longer name', `tx.update('people', id, { roles: [...roles] });`, null],
      ['another table', `tx.update('titles', id, { role: 'x' });`, null],
      ['a read', `const { push } = read.tables.employments.require(id);`, null],
    ];

    it.each(cases)('handles %s', (_name, source, expected) => {
      expect(findViolations('sample.ts', source).map((violation) => violation.field)).toEqual(
        expected === null ? [] : [expected],
      );
    });

    it('reports the line of the write', () => {
      const source = `const a = 1;\n\ntx.update('employments', id, { push: 'none' });\n`;
      expect(findViolations('sample.ts', source)).toEqual([
        { file: 'sample.ts', line: 3, field: 'push' },
      ]);
    });

    it('lets the doors and the creation paths through, and nothing else', () => {
      expect(isExempt('systems/workers/doors.ts')).toBe(true);
      expect(isExempt('systems/newgame/foundPromotion.ts')).toBe(true);
      expect(isExempt('systems/world/people/generate.ts')).toBe(true);
      expect(isExempt('persistence/packs/materialise.ts')).toBe(true);
      expect(isExempt('systems/workers/helpers/employment.ts')).toBe(false);
      expect(isExempt('systems/health/phases.ts')).toBe(false);
    });
  });
});
