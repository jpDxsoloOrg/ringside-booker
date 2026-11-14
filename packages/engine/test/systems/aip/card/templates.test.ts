// Rival talking segments from angle templates (MTCH5-06). Design:
// docs/design/rival-booking.md#talking-segments and angle-rating.md#angle-templates
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import { RngRegistry } from '../../../../src/core/rng/registry';
import { walkTrace } from '../../../../src/core/trace';
import {
  CARD_PLAN_STREAM,
  planCard,
  storedTaste,
  type CardPlan,
} from '../../../../src/systems/aip';
import { templateLabel } from '../../../../src/systems/aip/card/templates';
import { beatLimitOf } from '../../../../src/systems/match/angles/beatLimit';
import { angleDurationClass } from '../../../../src/systems/match/angles/rateAngle';
import { slotRoleOf } from '../../../../src/systems/match/slots';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { anEventInstance, aStoryline } from '../../../support/builders/creative';
import { flatAttributes } from '../../../support/builders/people';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const TODAY = TEST_START_DATE;
const tunables = createEngineTunables();

/** A computer promotion with 14 wrestlers, a show of `slots` tonight and, maybe, a new feud. */
function templateWorld(options: { readonly slots: number; readonly storyline?: boolean }) {
  return worldBuilder()
    .withGeography('mini')
    .withCatalogs()
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => {
      promotion.withRoster(14, {
        person: (index) => ({ attributes: flatAttributes(Math.max(20, 85 - index * 3)) }),
        employment: (index) => ({ alignment: index % 2 === 0 ? 'face' : 'heel' }),
      });
    })
    .with('tonight', (context) => {
      const promotionId = context.ids.promotions.A;
      const [regionId] = context.ids.regions;
      if (promotionId === undefined || regionId === undefined) {
        throw new Error('needs a promotion and a region');
      }
      const person = (index: number): PersonId => {
        const id = context.ids.people[index];
        if (id === undefined) {
          throw new Error(`no person ${String(index)}`);
        }
        return id;
      };
      if (options.storyline === true) {
        context.insert(
          'storylines',
          aStoryline(
            {
              promotionId,
              heat: 90,
              name: 'Test New Feud',
              startedOn: TODAY,
              members: [
                { personId: person(0), side: 'face' },
                { personId: person(1), side: 'heel' },
              ],
            },
            context.sequence,
          ),
        );
      }
      context.insert(
        'eventInstances',
        anEventInstance(
          {
            promotionId,
            regionId,
            name: 'Tonight',
            format: { slots: options.slots, preShowSlots: 0 },
            date: TODAY,
          },
          context.sequence,
        ),
      );
    })
    .build();
}

function plan(built: BuiltWorld, seed: string): CardPlan {
  const instance = built.world.tables.eventInstances.values().find((row) => row.name === 'Tonight');
  if (instance === undefined) {
    throw new Error('no show tonight');
  }
  return planCard(
    built.world,
    {
      instance,
      today: TODAY,
      mode: 'fresh',
      taste: storedTaste({
        wrestlingFocus: 50,
        entertainmentFocus: 50,
        athleticFocus: 50,
        starFocus: 50,
        talkShare: 100,
        titleFocus: 50,
        youthFocus: 50,
        riskAppetite: 50,
      }),
    },
    { tunables, rng: new RngRegistry(seed).stream(CARD_PLAN_STREAM) },
  );
}

function angles(result: CardPlan) {
  if (result.kind !== 'card') {
    throw new Error('expected a card');
  }
  return result.placements.flatMap((placement) =>
    placement.draft.kind === 'angle' ? [{ placement, draft: placement.draft }] : [],
  );
}

describe('rival talking segments from templates', () => {
  it('builds multi-beat angles where the slot allows, never past the limit', () => {
    let multiBeat = 0;
    for (const slots of [5, 6, 8]) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const built = templateWorld({ slots });
        const found = angles(plan(built, `${seed}-${String(slots)}`));
        expect(found.length).toBeGreaterThan(0);
        for (const { placement, draft } of found) {
          const role = slotRoleOf(
            { slot: placement.slot + 1, slots, preShow: placement.preShow },
            { tunables },
          ).value;
          const limit = beatLimitOf(
            angleDurationClass(role, draft.angle.setting ?? 'ring', tunables),
            tunables,
          ).value;
          const beats = draft.angle.beats ?? [];
          expect(beats.length).toBeGreaterThan(0);
          expect(beats.length).toBeLessThanOrEqual(limit);
          if (beats.length > 1) {
            multiBeat += 1;
          }
          // Everyone in a beat is a speaker on the segment.
          const speakers = new Set(draft.participants.map((participant) => participant.personId));
          for (const beat of beats) {
            for (const personId of beat.personIds) {
              expect(speakers.has(personId)).toBe(true);
            }
          }
          expect(placement.notes.some((line) => line.startsWith('Template: '))).toBe(true);
        }
      }
    }
    expect(multiBeat).toBeGreaterThan(0);
  });

  it('gives the same card for the same seed', () => {
    const first = plan(templateWorld({ slots: 6 }), 'same');
    const second = plan(templateWorld({ slots: 6 }), 'same');
    expect(angles(second).map(({ draft }) => draft)).toEqual(
      angles(first).map(({ draft }) => draft),
    );
  });

  it('opens a new feud with a startFeud template and traces the choice', () => {
    const built = templateWorld({ slots: 6, storyline: true });
    const story = angles(plan(built, 'feud')).find(({ draft }) => draft.storylineIds.length > 0);
    expect(story).toBeDefined();
    if (story === undefined) {
      return;
    }
    expect(story.draft.angle.angleTypeKey).toBe('angle.confrontation');
    const labels: string[] = [];
    walkTrace(story.placement.slotTrace.trace, (node) => {
      labels.push(node.label);
    });
    expect(labels.some((label) => label.startsWith('Template: Feud Opener ('))).toBe(true);
  });

  it('words the decision with the slot when beats were dropped', () => {
    expect(templateLabel('Feud Opener', 2, 3, 'Short')).toBe(
      'Template: Feud Opener (fits short slot: 2 of 3 beats)',
    );
    expect(templateLabel('Solo promo', 1, 1, 'Long')).toBe('Template: Solo promo (1 beat)');
  });
});
