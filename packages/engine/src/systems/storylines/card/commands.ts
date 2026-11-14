/**
 * The storyline link commands (CRTV4-01): `storylines.linkSegment` sets which storylines a segment
 * counts for, `storylines.setFinale` marks (or clears) one linked match as a storyline's finale.
 *
 * Both check the show with the calendar's `controlsShow` against the controller that issued them
 * (D-07), so a computer seat can't change the player's card and the player can't change a rival's.
 * A card that can no longer change (the show has run, was cancelled or is past) refuses with
 * booking's own `editBlockOf` reasons. Every refusal is a `Reason`; nothing throws.
 *
 * Rival cards are linked by AIP4's card writer, which writes `segments.storylineIds` itself.
 *
 * Design: docs/design/storylines.md#linking.
 */

import { z } from 'zod';
import { defineCommand } from '../../../core/api/command';
import type { Reason } from '../../../core/api/result';
import type { SegmentId, StorylineId } from '../../../core/ids';
import { controlsPromotion } from '../../../core/api/controller';
import { zId } from '../../../model/primitives';
import type { GameWorldView } from '../../../model/tables';
import {
  cardRefusals,
  linkableReasons,
  segmentPlace,
  segmentWasPlayed,
  segmentWithShow,
  STORYLINE_LINK_REASONS,
  tooManyLinksReason,
} from './links';

const CODES = STORYLINE_LINK_REASONS;

export interface StorylineLinkSegmentArgs {
  segmentId: SegmentId;
  /** The full new list, replacing the old one. */
  storylineIds: StorylineId[];
}

export interface StorylineSetFinaleArgs {
  storylineId: StorylineId;
  /** The linked match to make the finale, or null to clear it. */
  segmentId: SegmentId | null;
}

declare module '../../../core/api/maps' {
  interface CommandMap {
    'storylines.linkSegment': {
      args: StorylineLinkSegmentArgs;
      result: { storylineIds: StorylineId[] };
    };
    'storylines.setFinale': {
      args: StorylineSetFinaleArgs;
      result: { finaleSegmentId: SegmentId | null };
    };
  }
}

/** More ids than any limit parse, so `tooManyLinks` can explain instead of `invalidArgs`. */
const LINK_ARGS_MAX = 50;

const LinkSegmentArgsSchema = z.strictObject({
  segmentId: zId('segment'),
  storylineIds: z
    .array(zId('storyline'))
    .max(LINK_ARGS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'a storyline can be linked only once',
    }),
});

const SetFinaleArgsSchema = z.strictObject({
  storylineId: zId('storyline'),
  segmentId: zId('segment').nullable(),
});

function storylineNotFound(field: string): Reason {
  return { code: CODES.storylineNotFound, message: "That storyline doesn't exist.", field };
}

// ---------------------------------------------------------------------------------------------
// storylines.linkSegment

export const linkSegmentCommand = defineCommand('storylines.linkSegment', {
  args: LinkSegmentArgsSchema,
  validate: (read, args, issuedBy, env) => {
    const found = segmentWithShow(read, args.segmentId);
    if ('code' in found) {
      return [found];
    }
    const { segment, show } = found;
    const refused = cardRefusals(read, show, issuedBy);
    if (refused.length > 0) {
      return refused;
    }
    const limit = env.tunables.get('storylines.link.maxPerSegment');
    const reasons: Reason[] = [];
    args.storylineIds.forEach((storylineId, index) => {
      const field = `storylineIds[${String(index)}]`;
      const storyline = read.tables.storylines.get(storylineId);
      if (storyline === undefined) {
        reasons.push(storylineNotFound(field));
        return;
      }
      if (segment.storylineIds.includes(storylineId) && storyline.status !== 'active') {
        // Keeping a link to a story that has ended since is allowed; it just won't count.
        return;
      }
      reasons.push(...linkableReasons(read, storyline, show, field));
    });
    if (args.storylineIds.length > limit) {
      reasons.push(tooManyLinksReason(limit));
    }
    return reasons;
  },
  apply: (ctx, args) => {
    const segment = ctx.read.tables.segments.require(args.segmentId);
    const storylineIds = [...args.storylineIds];
    const kept = new Set<StorylineId>(storylineIds);
    for (const removedId of segment.storylineIds) {
      if (kept.has(removedId)) {
        continue;
      }
      const removed = ctx.read.tables.storylines.get(removedId);
      if (removed?.finaleSegmentId === segment.id) {
        ctx.tx.update('storylines', removed.id, { finaleSegmentId: null });
      }
    }
    ctx.tx.update('segments', segment.id, { storylineIds });
    return { storylineIds };
  },
});

// ---------------------------------------------------------------------------------------------
// storylines.setFinale

/** `finaleAlreadyPlayed` when the storyline's current finale has been played; else empty. */
function playedFinaleReasons(
  read: GameWorldView,
  storyline: { name: string; finaleSegmentId: SegmentId | null },
): Reason[] {
  if (storyline.finaleSegmentId === null || !segmentWasPlayed(read, storyline.finaleSegmentId)) {
    return [];
  }
  return [
    {
      code: CODES.finaleAlreadyPlayed,
      message: `'${storyline.name}' has already had its finale; it can't be moved now`,
      subject: { kind: 'segment', id: storyline.finaleSegmentId },
    },
  ];
}

export const setFinaleCommand = defineCommand('storylines.setFinale', {
  args: SetFinaleArgsSchema,
  validate: (read, args, issuedBy) => {
    const storyline = read.tables.storylines.get(args.storylineId);
    if (storyline === undefined) {
      return [storylineNotFound('storylineId')];
    }
    if (args.segmentId === null) {
      if (!controlsPromotion(read, storyline.promotionId, issuedBy)) {
        const owner = read.tables.promotions.get(storyline.promotionId)?.name;
        return [
          {
            code: 'storylines.notYours',
            message: `That storyline belongs to ${owner ?? 'another promotion'}.`,
            subject: { kind: 'storyline', id: storyline.id },
          },
        ];
      }
      return playedFinaleReasons(read, storyline);
    }
    const found = segmentWithShow(read, args.segmentId);
    if ('code' in found) {
      return [found];
    }
    const { segment, show } = found;
    const refused = cardRefusals(read, show, issuedBy);
    if (refused.length > 0) {
      return refused;
    }
    const linkable = linkableReasons(read, storyline, show, 'storylineId');
    if (linkable.length > 0) {
      return linkable;
    }
    const subject = { kind: 'segment', id: segment.id } as const;
    if (segment.kind !== 'match') {
      return [
        {
          code: CODES.notAMatch,
          message: `${segmentPlace(segment)} is a talking segment; a storyline's finale must be a match`,
          field: 'segmentId',
          subject,
        },
      ];
    }
    if (!segment.storylineIds.includes(storyline.id)) {
      return [
        {
          code: CODES.notLinked,
          message: `Link ${segmentPlace(segment)} to '${storyline.name}' before making it the finale`,
          field: 'segmentId',
          subject,
        },
      ];
    }
    if (storyline.finaleSegmentId === segment.id) {
      return [];
    }
    return playedFinaleReasons(read, storyline);
  },
  apply: (ctx, args) => {
    const storyline = ctx.read.tables.storylines.require(args.storylineId);
    if (storyline.finaleSegmentId !== args.segmentId) {
      ctx.tx.update('storylines', storyline.id, { finaleSegmentId: args.segmentId });
    }
    return { finaleSegmentId: args.segmentId };
  },
});

export const storylinesCardCommands = [linkSegmentCommand, setFinaleCommand] as const;
