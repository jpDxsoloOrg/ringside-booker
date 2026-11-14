// The only reign writers (CRTV1-01). Design: docs/design/titles.md#writing-reigns
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InvariantError } from '../../../src/core/errors';
import { addDefence, closeReign, currentReign, openReign } from '../../../src/systems/titles';
import { integrityCodes, LATER, START, titleIdAt, titlesWorld, writeOn } from './titles-world';

function people(built: ReturnType<typeof titlesWorld>) {
  const [first, second] = built.ids.people;
  if (first === undefined || second === undefined) {
    throw new Error('no roster');
  }
  return { first, second };
}

describe('openReign and closeReign', () => {
  it('opens a reign on the day with no defences and the employment ring name', () => {
    const built = titlesWorld();
    const { second } = people(built);
    const [, secondEmployment] = built.ids.employments;
    if (secondEmployment === undefined) {
      throw new Error('no employment');
    }
    writeOn(built.world, START, (ctx) =>
      ctx.tx.update('employments', secondEmployment, { ringName: 'Storm Chaser' }),
    );
    const reign = writeOn(built.world, LATER, (ctx) =>
      openReign(ctx, {
        titleId: titleIdAt(built, 0),
        holderIds: [second],
        teamId: null,
        wonInSegmentId: null,
      }),
    );
    expect(reign).toMatchObject({
      holderIds: [second],
      wonOn: LATER,
      lostOn: null,
      endReason: null,
      defences: 0,
      holderNamesAtTime: ['Storm Chaser'],
    });
    expect(built.world.tables.people.get(second)?.defaultRingName).not.toBe('Storm Chaser');
  });

  it('falls back to the default ring name for someone who no longer works there', () => {
    const built = titlesWorld();
    const { second } = people(built);
    const [, secondEmployment] = built.ids.employments;
    if (secondEmployment === undefined) {
      throw new Error('no employment');
    }
    writeOn(built.world, START, (ctx) =>
      ctx.tx.update('employments', secondEmployment, {
        ringName: 'Storm Chaser',
        status: 'released',
        endedOn: START,
      }),
    );
    const reign = writeOn(built.world, LATER, (ctx) =>
      openReign(ctx, {
        titleId: titleIdAt(built, 0),
        holderIds: [second],
        teamId: null,
        wonInSegmentId: null,
      }),
    );
    expect(reign.holderNamesAtTime).toEqual([
      built.world.tables.people.get(second)?.defaultRingName,
    ]);
  });

  it('hands a title over on one day: close then open passes reignsDoNotOverlap', () => {
    const built = titlesWorld();
    const { second } = people(built);
    const titleId = titleIdAt(built, 1);
    const old = currentReign(built.world, titleId);
    if (old === null) {
      throw new Error('expected a champion');
    }
    writeOn(built.world, LATER, (ctx) => {
      closeReign(ctx, { reignId: old.id, endReason: 'lost', endedInSegmentId: null });
      openReign(ctx, { titleId, holderIds: [second], teamId: null, wonInSegmentId: null });
    });
    expect(built.world.tables.titleReigns.get(old.id)).toMatchObject({
      lostOn: LATER,
      endReason: 'lost',
    });
    expect(currentReign(built.world, titleId)?.holderIds).toEqual([second]);
    expect(integrityCodes(built.world)).toEqual([]);
  });

  it('refuses to open a second current reign', () => {
    const built = titlesWorld();
    const { second } = people(built);
    expect(() =>
      writeOn(built.world, LATER, (ctx) =>
        openReign(ctx, {
          titleId: titleIdAt(built, 1),
          holderIds: [second],
          teamId: null,
          wonInSegmentId: null,
        }),
      ),
    ).toThrow(InvariantError);
  });

  it('refuses to close a reign that has already ended', () => {
    const built = titlesWorld();
    const old = currentReign(built.world, titleIdAt(built, 1));
    if (old === null) {
      throw new Error('expected a champion');
    }
    writeOn(built.world, LATER, (ctx) =>
      closeReign(ctx, { reignId: old.id, endReason: 'vacated', endedInSegmentId: null }),
    );
    expect(() =>
      writeOn(built.world, LATER, (ctx) =>
        closeReign(ctx, { reignId: old.id, endReason: 'vacated', endedInSegmentId: null }),
      ),
    ).toThrow(InvariantError);
  });
});

describe('addDefence', () => {
  it('counts one more defence on the current reign', () => {
    const built = titlesWorld();
    const old = currentReign(built.world, titleIdAt(built, 1));
    if (old === null) {
      throw new Error('expected a champion');
    }
    const updated = writeOn(built.world, LATER, (ctx) => addDefence(ctx, old.id));
    expect(updated.defences).toBe(old.defences + 1);
    expect(updated.lostOn).toBeNull();
  });

  it('refuses a reign that has already ended', () => {
    const built = titlesWorld();
    const old = currentReign(built.world, titleIdAt(built, 1));
    if (old === null) {
      throw new Error('expected a champion');
    }
    writeOn(built.world, LATER, (ctx) =>
      closeReign(ctx, { reignId: old.id, endReason: 'vacated', endedInSegmentId: null }),
    );
    expect(() => writeOn(built.world, LATER, (ctx) => addDefence(ctx, old.id))).toThrow(
      InvariantError,
    );
  });
});

const ENGINE_SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('one writer for reigns (CRTV1-06)', () => {
  it('only systems/titles/reigns.ts creates or changes titleReigns rows', () => {
    const writes = /\.(create|update|delete|upsert)\(\s*['"]titleReigns['"]/;
    const writers = sourceFiles(ENGINE_SRC)
      .filter((path) => writes.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ENGINE_SRC, path).split('\\').join('/'));
    expect(writers).toEqual(['systems/titles/reigns.ts']);
  });
});
