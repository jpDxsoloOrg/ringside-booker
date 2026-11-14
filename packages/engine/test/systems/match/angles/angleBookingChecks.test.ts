// MTCH5's booking checks (MTCH5-06): beat limits per slot and the angle warnings on a card.
// Design: docs/design/angle-rating.md#booking
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import type { PersonId } from '../../../../src/core/ids';
import { AngleDraftSchema, type AngleDraft } from '../../../../src/systems/booking';
import {
  ANGLE_BEAT_LIMIT_CHECK_ID,
  ANGLE_WARNINGS_CHECK_ID,
  angleBeatLimitText,
} from '../../../../src';
import {
  book,
  bookRunnable,
  change,
  speaker,
  validate,
  validateWorld,
  who,
} from '../../booking/validate-world';

/** An angle of `type` with one beat per entry, every person a speaker on side 0. */
function beatAngle(
  beats: readonly { readonly key: string; readonly people: readonly PersonId[] }[],
  type = 'angle.promo',
): AngleDraft {
  const speakers = [...new Set(beats.flatMap((beat) => beat.people))];
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: {
      angleTypeKey: parseContentKey(type),
      beats: beats.map((beat) => ({
        beatKey: parseContentKey(`beat.${beat.key}`),
        personIds: [...beat.people],
      })),
    },
    participants: speakers.map((personId) => speaker(personId)),
  });
}

function threePromos(personId: PersonId): AngleDraft {
  return beatAngle([
    { key: 'promo', people: [personId] },
    { key: 'promo', people: [personId] },
    { key: 'celebration', people: [personId] },
  ]);
}

describe('match.angleBeatLimit', () => {
  it('refuses a 3-beat angle on the pre-show (a short slot, up to 2 beats)', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(built, 0, threePromos(who(built, 5)), { preShow: true });
    const result = validate(built);
    const issue = result.errors.find((error) => error.checkId === ANGLE_BEAT_LIMIT_CHECK_ID);
    expect(issue).toMatchObject({
      code: 'angle.tooManyBeats',
      severity: 'error',
      slot: { preShow: true, slot: 0 },
    });
    expect(issue?.message).toMatch(
      /: short slot, up to 2 beats\. Remove a beat or move this angle\.$/,
    );
    expect(result.runnable).toBe(false);
  });

  it('accepts the same 3 beats in the main event (a long slot)', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    change(built, (tx) => {
      tx.delete('segments', card.mainEvent);
    });
    book(built, 5, threePromos(who(built, 5)));
    const result = validate(built);
    expect(result.errors.filter((error) => error.checkId === ANGLE_BEAT_LIMIT_CHECK_ID)).toEqual(
      [],
    );
  });

  it('catches an angle moved into a shorter slot', () => {
    const built = validateWorld();
    const card = bookRunnable(built);
    change(built, (tx) => {
      tx.delete('segments', card.promo);
    });
    const promo = book(built, 2, threePromos(who(built, 5)));
    expect(validate(built).errors.map((error) => error.checkId)).not.toContain(
      ANGLE_BEAT_LIMIT_CHECK_ID,
    );
    change(built, (tx) => {
      tx.update('segments', promo, { preShow: true, slot: 0 });
    });
    expect(validate(built).errors.map((error) => error.checkId)).toContain(
      ANGLE_BEAT_LIMIT_CHECK_ID,
    );
  });

  it('words the error with the slot, the limit and what to do', () => {
    expect(angleBeatLimitText('Opener', 'Short slot: up to 2 beats', 1)).toBe(
      'Opener: short slot, up to 2 beats. Remove a beat or move this angle.',
    );
    expect(angleBeatLimitText('Slot 3', 'Standard slot: up to 4 beats', 2)).toBe(
      'Slot 3: standard slot, up to 4 beats. Remove 2 beats or move this angle.',
    );
  });
});

describe('match.angleWarnings', () => {
  it('warns about a hurt worker in a physical beat, and never blocks for it', () => {
    const built = validateWorld();
    bookRunnable(built);
    // Roster 3 is injured but may still work angles.
    book(
      built,
      3,
      beatAngle([{ key: 'brawl', people: [who(built, 3), who(built, 1)] }], 'angle.attack'),
    );
    const result = validate(built);
    const warning = result.warnings.find((issue) => issue.checkId === ANGLE_WARNINGS_CHECK_ID);
    expect(warning).toMatchObject({
      code: 'angle.injuredInPhysicalBeat',
      severity: 'warning',
      personId: who(built, 3),
    });
    expect(result.errors.filter((issue) => issue.checkId === ANGLE_WARNINGS_CHECK_ID)).toEqual([]);
  });

  it('warns when a beat group has more people than it holds', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      3,
      beatAngle([{ key: 'promo', people: [0, 1, 2, 6, 7].map((index) => who(built, index)) }]),
    );
    const codes = validate(built)
      .warnings.filter((issue) => issue.checkId === ANGLE_WARNINGS_CHECK_ID)
      .map((issue) => issue.code);
    expect(codes).toContain('angle.groupTooBig');
  });

  it('refuses someone in a beat who is not booked on the segment and cannot appear', () => {
    const built = validateWorld();
    bookRunnable(built);
    // Roster 4 is injured and may not work angles; written into the beat but not as a speaker.
    book(
      built,
      3,
      AngleDraftSchema.parse({
        kind: 'angle',
        label: null,
        angle: {
          angleTypeKey: parseContentKey('angle.promo'),
          beats: [
            { beatKey: parseContentKey('beat.promo'), personIds: [who(built, 1), who(built, 4)] },
          ],
        },
        participants: [speaker(who(built, 1))],
      }),
    );
    const errors = validate(built).errors.filter(
      (issue) => issue.checkId === ANGLE_WARNINGS_CHECK_ID,
    );
    expect(errors).toMatchObject([
      { code: 'angle.cannotWorkAngles', severity: 'error', personId: who(built, 4) },
    ]);
  });

  it('adds nothing to a clean card', () => {
    const built = validateWorld();
    bookRunnable(built);
    const result = validate(built);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
