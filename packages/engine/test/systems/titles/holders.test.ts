// Who holds a title now (CRTV1-01). Design: docs/design/titles.md#holders
import { describe, expect, it } from 'vitest';
import {
  closeReign,
  currentHolders,
  currentReign,
  openReign,
  reignLabel,
  titlesHeldBy,
} from '../../../src/systems/titles';
import { LATER, START, titleIdAt, titlesWorld, writeOn } from './titles-world';

describe('holder helpers', () => {
  it('reads a vacant title as no reign and no holders', () => {
    const built = titlesWorld();
    const vacant = titleIdAt(built, 0);
    expect(currentReign(built.world, vacant)).toBeNull();
    expect(currentHolders(built.world, vacant)).toEqual([]);
  });

  it('reads a singles champion from the open reign', () => {
    const built = titlesWorld();
    const held = titleIdAt(built, 1);
    expect(currentHolders(built.world, held)).toEqual([built.ids.people[0]]);
    expect(currentReign(built.world, held)?.lostOn).toBeNull();
  });

  it('lists the titles a person holds, open reigns only, in ID order', () => {
    const built = titlesWorld();
    const [champion] = built.ids.people;
    if (champion === undefined) {
      throw new Error('no roster');
    }
    const vacant = titleIdAt(built, 0);
    const held = titleIdAt(built, 1);
    writeOn(built.world, START, (ctx) =>
      openReign(ctx, {
        titleId: vacant,
        holderIds: [champion],
        teamId: null,
        wonInSegmentId: null,
      }),
    );
    expect(titlesHeldBy(built.world, champion)).toEqual([vacant, held].sort());
    const reign = currentReign(built.world, held);
    if (reign === null) {
      throw new Error('expected a reign');
    }
    writeOn(built.world, LATER, (ctx) =>
      closeReign(ctx, { reignId: reign.id, endReason: 'vacated', endedInSegmentId: null }),
    );
    expect(titlesHeldBy(built.world, champion)).toEqual([vacant]);
    expect(titlesHeldBy(built.world, champion, built.ids.promotions.A)).toEqual([vacant]);
  });

  it('labels a tag reign with the team name while the team exists', () => {
    const built = titlesWorld();
    const [, , third, fourth] = built.ids.people;
    const [teamId] = built.ids.teams;
    if (third === undefined || fourth === undefined || teamId === undefined) {
      throw new Error('missing fixtures');
    }
    const reign = writeOn(built.world, START, (ctx) =>
      openReign(ctx, {
        titleId: titleIdAt(built, 2),
        holderIds: [third, fourth],
        teamId,
        wonInSegmentId: null,
      }),
    );
    expect(reignLabel(built.world, reign)).toBe('The Night Shift');
    expect(reignLabel(built.world, { ...reign, teamId: null })).toBe(
      reign.holderNamesAtTime.join(' & '),
    );
  });

  it('keeps the name a champion won under after they are renamed', () => {
    const built = titlesWorld();
    const reign = currentReign(built.world, titleIdAt(built, 1));
    const [employmentId] = built.ids.employments;
    if (reign === null || employmentId === undefined) {
      throw new Error('missing fixtures');
    }
    const before = reignLabel(built.world, reign);
    writeOn(built.world, LATER, (ctx) =>
      ctx.tx.update('employments', employmentId, { ringName: 'The Renamed One' }),
    );
    expect(reignLabel(built.world, reign)).toBe(before);
    expect(before).not.toBe('The Renamed One');
  });
});
