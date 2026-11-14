// Who's who and where in talking segments (MTCH5-08): the writer stores talk roles and the
// setting, the card and checklist read them back. Design: docs/design/booking.md#talk-roles.
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import type { PersonId, SegmentId } from '../../../src/core/ids';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  AngleDraftSchema,
  buildCardView,
  draftFromSegment,
  writeSegment,
  type AngleDraft,
  type ParticipantDraft,
} from '../../../src/systems/booking';
import { book, bookRunnable, START, validate, validateWorld, who } from './validate-world';
import type { ValidateWorld } from './validate-world';

const KAI = 5;
const LEO = 7;
const SAM = 10;

function interview(
  built: ValidateWorld,
  people: readonly Omit<ParticipantDraft, 'role' | 'teamId'>[],
  setting?: 'ring' | 'backstage' | 'video',
): AngleDraft {
  return AngleDraftSchema.parse({
    kind: 'angle',
    label: null,
    angle: {
      angleTypeKey: parseContentKey('angle.interview'),
      ...(setting === undefined ? {} : { setting }),
    },
    participants: people.map((person) => ({ ...person, role: 'speaker', teamId: null })),
  });
}

/** Kai with his manager Sam on the guest side, Leo interviewing, backstage. */
function backstageInterview(built: ValidateWorld): AngleDraft {
  const kai = who(built, KAI);
  return interview(
    built,
    [
      { personId: kai, side: 0, talkRole: 'wrestler' },
      { personId: who(built, SAM), side: 0, talkRole: 'manager', forPersonId: kai },
      { personId: who(built, LEO), side: 1, talkRole: 'interviewer' },
    ],
    'backstage',
  );
}

function talkIssues(built: ValidateWorld): { code: string; message: string }[] {
  return validate(built)
    .warnings.filter((issue) => issue.checkId === 'booking.talk')
    .map(({ code, message }) => ({ code, message }));
}

function cardSegment(built: ValidateWorld, segmentId: SegmentId) {
  const instance = built.world.tables.eventInstances.require(built.show);
  const card = buildCardView(built.world, instance, START, {
    viewer: { kind: 'omniscient' },
    tunables: createEngineTunables(),
  });
  const slot = card.sections
    .flatMap((section) => section.slots)
    .find((candidate) => candidate.segment?.segmentId === segmentId);
  if (slot?.segment == null) {
    throw new Error('segment not on the card');
  }
  return { slot, segment: slot.segment };
}

describe('talk roles and settings on the card', () => {
  it('stores each part and the setting, and reads the draft back unchanged', () => {
    const built = validateWorld();
    const draft = backstageInterview(built);
    const segmentId = book(built, 2, draft);
    const segment = built.world.tables.segments.require(segmentId);
    expect(segment.kind === 'angle' ? segment.angle.setting : null).toBe('backstage');
    const rows = built.world.tables.participants.lookup('bySegment', segmentId);
    const sam = rows.find((row) => row.personId === who(built, SAM));
    expect(sam?.talkRole).toBe('manager');
    expect(sam?.forPersonId).toBe(who(built, KAI));
    const back = draftFromSegment(built.world, segmentId);
    expect(back.kind === 'angle' ? back.angle.setting : null).toBe('backstage');
    expect(back.participants.map((person) => [person.personId, person.talkRole])).toEqual(
      expect.arrayContaining([
        [who(built, KAI), 'wrestler'],
        [who(built, SAM), 'manager'],
        [who(built, LEO), 'interviewer'],
      ]),
    );
  });

  it('names who did what and where, and shortens a backstage slot', () => {
    const built = validateWorld();
    const segmentId = book(built, 2, backstageInterview(built));
    const { slot, segment } = cardSegment(built, segmentId);
    expect(segment.setting).toBe('backstage');
    expect(segment.talkLine).toBe('Backstage: Leo Hart interviews Kai Moreno (with Sam Reed)');
    expect(slot.durationClass).toBe('short');
    const leo = segment.sides
      .flatMap((side) => side.people)
      .find((person) => person.ringName === 'Leo Hart');
    expect(leo?.talkRole).toBe('interviewer');
  });

  it('has no warnings for the right people in the right parts', () => {
    const built = validateWorld();
    book(built, 2, backstageInterview(built));
    expect(talkIssues(built)).toEqual([]);
  });

  it('warns, never blocks, for a wrestler as the host', () => {
    const built = validateWorld();
    bookRunnable(built);
    book(
      built,
      3,
      interview(built, [
        { personId: who(built, KAI), side: 0 },
        { personId: who(built, LEO), side: 1 },
      ]),
    );
    expect(talkIssues(built)).toEqual([
      { code: 'angle.wrongRole', message: 'Leo Hart is a wrestler: Host is for an interviewer' },
    ]);
    expect(validate(built).runnable).toBe(true);
  });

  it('leaves old-style drafts as they were: no parts, no setting, in the ring', () => {
    const built = validateWorld();
    const segmentId = book(built, 2, interview(built, [{ personId: who(built, KAI), side: 0 }]));
    const segment = built.world.tables.segments.require(segmentId);
    expect(segment.kind === 'angle' && 'setting' in segment.angle).toBe(false);
    const [row] = built.world.tables.participants.lookup('bySegment', segmentId);
    expect(row !== undefined && 'talkRole' in row).toBe(false);
    expect(cardSegment(built, segmentId).segment.talkLine).toBeNull();
  });

  it('drops a part when the booker takes it away', () => {
    const built = validateWorld();
    const segmentId = book(built, 2, backstageInterview(built));
    const kai: PersonId = who(built, KAI);
    const result = built.world.transact('rebook', (tx) =>
      writeSegment(tx, {
        eventInstanceId: built.show,
        preShow: false,
        slot: 2,
        segmentId,
        draft: interview(built, [{ personId: kai, side: 0 }]),
      }),
    );
    expect(result.ok).toBe(true);
    const [row] = built.world.tables.participants.lookup('bySegment', segmentId);
    expect(row?.personId).toBe(kai);
    expect(row !== undefined && 'talkRole' in row).toBe(false);
  });

  it('starts a type that cannot happen in the ring where it can', () => {
    const built = validateWorld();
    const segmentId = book(
      built,
      2,
      AngleDraftSchema.parse({
        kind: 'angle',
        label: null,
        angle: { angleTypeKey: parseContentKey('angle.video-package') },
        participants: [{ personId: who(built, KAI), side: 0, role: 'speaker', teamId: null }],
      }),
    );
    const segment = built.world.tables.segments.require(segmentId);
    expect(segment.kind === 'angle' ? segment.angle.setting : null).toBe('video');
  });
});
