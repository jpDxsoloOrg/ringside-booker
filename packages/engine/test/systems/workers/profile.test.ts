// The worker profile query and its viewer rules. Design: docs/design/workers.md#the-profile-query
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine, type Viewer } from '../../../src/core/api';
import { simSystem } from '../../../src/core/api/builtins';
import { addDays, addYears } from '../../../src/core/date';
import type { PersonId, PromotionId } from '../../../src/core/ids';
import { cents } from '../../../src/core/money';
import { ATTRIBUTE_KEYS, type Person } from '../../../src/model/entities/person';
import {
  RATING_ROLES,
  workersSystem,
  type WorkerProfile,
  type WorkerProfileContract,
} from '../../../src/systems/workers';
import { TEST_PLAYER_ID, TEST_START_DATE } from '../../support/builders/build-row';
import type { DeepPartial } from '../../support/builders/build-row';
import { anEmployment, aTeam } from '../../support/builders/promotions';
import { aTitleReign } from '../../support/builders/creative';
import { testId } from '../../support/ids';
import { expectSerialisable } from '../../support/trace';
import { worldBuilder } from '../../support/world-builder';

const OMNISCIENT: Viewer = { kind: 'omniscient' };
const PLAYER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: TEST_PLAYER_ID },
};
/** A human who runs no promotion in this world. */
const BYSTANDER: Viewer = {
  kind: 'controller',
  controller: { kind: 'human', playerId: 'player-nobody' },
};
const COMPUTER: Viewer = { kind: 'controller', controller: { kind: 'computer' } };
const EVERY_VIEWER: readonly Viewer[] = [OMNISCIENT, PLAYER, BYSTANDER, COMPUTER];

const TODAY = addDays(TEST_START_DATE, 100);
const OWN_WAGE = cents(450_000);
const RIVAL_WAGE = cents(990_000);

/** Roster index → person overrides for the player's promotion. */
const OWN_ROSTER: readonly DeepPartial<Person>[] = [
  {
    givenName: 'Test',
    familyName: 'Legal',
    weightKg: 104,
    heightCm: 183,
    traits: ['workhorse', 'leader'],
    vices: { alcohol: 'known', substances: 'hidden' },
    development: { potential: 640, ceilings: { ringwork: 91 } },
    attributes: { ringwork: 74, mic: 38 },
    // South 1 only: best known in the smaller of the two countries.
    regionalPop: { [testId('region', 3)]: 60 },
  },
  { vices: { alcohol: 'none', substances: 'recovering' } },
  {},
];

interface ProfileWorld {
  engine: Engine;
  own: PersonId;
  ownPartner: PersonId;
  rival: PersonId;
  freeAgent: PersonId;
  ownPromotionId: PromotionId;
  rivalPromotionId: PromotionId;
}

/**
 * Two promotions in the mini map, 100 days in. Promotion A is run by the human player and has
 * three wrestlers; promotion B is computer-run and has two. Person 0 of A holds A's title, is in a
 * team with person 1, once worked for B and has an open offer from B. A sixth person is a free
 * agent.
 */
function profileWorld(): ProfileWorld {
  const { world, ids } = worldBuilder({
    startDate: TEST_START_DATE,
    currentDate: TODAY,
  })
    .withGeography('mini')
    .withPromotion(
      { name: 'Test Promotion A', controller: { kind: 'human', playerId: TEST_PLAYER_ID } },
      (promotion) =>
        promotion
          .withRoster(3, {
            person: (rosterIndex) => OWN_ROSTER[rosterIndex] ?? {},
            employment: (rosterIndex) =>
              rosterIndex === 0
                ? {
                    ringName: 'Test Ring Name Own',
                    push: 'upperCard',
                    alignment: 'heel',
                    morale: 35,
                    momentum: 12,
                    terms: { monthlyWage: OWN_WAGE, exclusive: false },
                  }
                : { terms: { exclusive: false } },
          })
          .withTitle({ name: 'Test Heavyweight Title' }, { holder: 0, wonOn: addDays(TODAY, -30) }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) =>
      promotion.withRoster(2, {
        person: () => ({ vices: { alcohol: 'hidden', substances: 'known' } }),
        employment: () => ({
          push: 'mainEvent',
          morale: -40,
          momentum: 55,
          terms: { monthlyWage: RIVAL_WAGE },
        }),
      }),
    )
    .with('history', (context) => {
      const [own, ownPartner] = context.ids.people;
      const [ownTitle] = context.ids.titles;
      const rivalPromotionId = context.ids.promotions.B;
      if (
        own === undefined ||
        ownPartner === undefined ||
        ownTitle === undefined ||
        rivalPromotionId === undefined
      ) {
        throw new Error('The profile world is missing its people');
      }
      // An ended spell with the rival, long before the current contract.
      context.insert(
        'employments',
        anEmployment(
          {
            personId: own,
            promotionId: rivalPromotionId,
            status: 'released',
            offeredOn: addYears(TEST_START_DATE, -3),
            startsOn: addYears(TEST_START_DATE, -3),
            endedOn: addYears(TEST_START_DATE, -1),
            ringName: 'Test Ring Name Old',
            morale: -70,
            terms: { exclusive: false, monthlyWage: RIVAL_WAGE },
          },
          context.sequence,
        ),
      );
      // An offer from the rival that is still on the table.
      context.insert(
        'employments',
        anEmployment(
          {
            personId: own,
            promotionId: rivalPromotionId,
            status: 'offered',
            offeredOn: TODAY,
            startsOn: addDays(TODAY, 14),
            terms: { exclusive: false, monthlyWage: RIVAL_WAGE },
          },
          context.sequence,
        ),
      );
      // An earlier reign, lost after 40 days.
      context.insert(
        'titleReigns',
        aTitleReign(
          {
            titleId: ownTitle,
            holderIds: [own],
            holderNamesAtTime: ['Test Ring Name Earlier'],
            wonOn: addDays(TODAY, -90),
            lostOn: addDays(TODAY, -50),
            defences: 3,
          },
          context.sequence,
        ),
      );
      context.insert(
        'teams',
        aTeam(
          { name: 'Test Team One', memberIds: [own, ownPartner], formedOn: TEST_START_DATE },
          context.sequence,
        ),
      );
      // The free agent: the last person in the world.
      context.insert('people', {
        ...context.tx.view.tables.people.require(own),
        id: context.sequence.id('person'),
        defaultRingName: 'Test Free Agent',
        vices: { alcohol: 'none', substances: 'none' },
        traits: [],
      });
    })
    .build();

  const [own, ownPartner, , rival] = ids.people;
  const freeAgent = ids.people.at(-1);
  const ownPromotionId = ids.promotions.A;
  const rivalPromotionId = ids.promotions.B;
  if (
    own === undefined ||
    ownPartner === undefined ||
    rival === undefined ||
    freeAgent === undefined ||
    ownPromotionId === undefined ||
    rivalPromotionId === undefined
  ) {
    throw new Error('The profile world is missing its people');
  }
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [simSystem, workersSystem],
    debugChecks: true,
  });
  return { engine, own, ownPartner, rival, freeAgent, ownPromotionId, rivalPromotionId };
}

function profileOf(engine: Engine, personId: PersonId, viewer: Viewer): WorkerProfile {
  const result = engine.query('workers.profile', { personId }, viewer);
  if (!result.ok) {
    throw new Error(`workers.profile was refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function contractWith(profile: WorkerProfile, promotionId: PromotionId): WorkerProfileContract[] {
  return profile.career.contracts.filter((contract) => contract.promotionId === promotionId);
}

/** Every object key anywhere in `value`. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      keysIn(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysIn(nested, found);
    }
  }
  return found;
}

describe('workers.profile: the header', () => {
  it('describes the person as they are today', () => {
    const { engine, own, ownPromotionId } = profileWorld();
    const { header } = profileOf(engine, own, PLAYER);

    expect(header).toMatchObject({
      personId: own,
      ringName: 'Test Ring Name Own',
      legalName: 'Test Legal',
      heightCm: 183,
      weightKg: 104,
      mainRole: 'wrestler',
      push: 'upperCard',
      alignment: 'heel',
      employer: { promotionId: ownPromotionId, name: 'Test Promotion A', isViewers: true },
      basedIn: { regionName: 'Test Region North 1', countryName: 'Test Country North' },
      born: { regionName: 'Test Region North 1', countryName: 'Test Country North' },
    });
    expect(header.weightClass.value).toBe('lightHeavyweight');
    expect(header.weightClass.trace.label).toBe('Weight class');
    expect(header.availability.status).toBe('available');
    expect(header.age).toBeGreaterThan(17);
  });

  it('gives a free agent their default ring name and no employer, push or alignment', () => {
    const { engine, freeAgent } = profileWorld();
    const { header, career } = profileOf(engine, freeAgent, PLAYER);

    expect(header.ringName).toBe('Test Free Agent');
    expect(header.employer).toBeNull();
    expect(header.push).toBeNull();
    expect(header.alignment).toBeNull();
    expect(career.contracts).toEqual([]);
    expect(career.reigns).toEqual([]);
    expect(career.teams).toEqual([]);
  });

  it('says the employer is not the viewer’s for a rival worker', () => {
    const { engine, rival, rivalPromotionId } = profileWorld();
    const { header } = profileOf(engine, rival, PLAYER);

    expect(header.employer).toMatchObject({ promotionId: rivalPromotionId, isViewers: false });
    expect(header.push).toBe('mainEvent');
  });
});

describe('workers.profile: attributes and ratings', () => {
  it('lists every attribute once, in its group, with a grade and the reason for it', () => {
    const { engine, own } = profileWorld();
    const { attributes } = profileOf(engine, own, PLAYER);

    const keys = [...attributes.inRing, ...attributes.character, ...attributes.crew].map(
      (attribute) => attribute.key,
    );
    expect(keys).toEqual([...ATTRIBUTE_KEYS]);
    const ringwork = attributes.inRing.find((attribute) => attribute.key === 'ringwork');
    expect(ringwork).toMatchObject({ label: 'Ring work', value: 74 });
    expect(ringwork?.gradeReason).toContain(`74 is in the ${ringwork?.grade ?? ''} band`);
  });

  it('rates the person in every role, each with its trace', () => {
    const { engine, own } = profileWorld();
    const { overall } = profileOf(engine, own, PLAYER);

    expect(overall.mainRole).toBe('wrestler');
    expect(overall.byRole.map((rating) => rating.role)).toEqual([...RATING_ROLES]);
    for (const rating of overall.byRole) {
      expect(rating.trace.value).toBe(rating.value);
    }
  });

  it('works out the expected push at the viewer’s promotion only', () => {
    const { engine, rival, ownPromotionId } = profileWorld();

    const forPlayer = profileOf(engine, rival, PLAYER).expectedPush;
    expect(forPlayer).toMatchObject({
      promotionId: ownPromotionId,
      promotionName: 'Test Promotion A',
    });
    expect(forPlayer?.trace.value).toBe(forPlayer?.push);
    expect(profileOf(engine, rival, OMNISCIENT).expectedPush).toBeNull();
    expect(profileOf(engine, rival, BYSTANDER).expectedPush).toBeNull();
    expect(profileOf(engine, rival, COMPUTER).expectedPush).toBeNull();
  });

  it('rolls popularity up and names where they are best known', () => {
    const { engine, own, ownPartner } = profileWorld();
    const { popularity } = profileOf(engine, own, PLAYER);

    expect(popularity.continents).toHaveLength(1);
    expect(popularity.world.trace.value).toBe(popularity.world.value);
    expect(popularity.world.value).toBeGreaterThan(0);
    expect(popularity.top).toMatchObject({ countryName: 'Test Country South' });
    expect(popularity.top?.value).toBe(popularity.continents[0]?.countries[0]?.value);
    expect(popularity.topContinentId).toBe(popularity.continents[0]?.id);

    // Someone with no fans anywhere has no top country to name.
    const unknown = profileOf(engine, ownPartner, PLAYER).popularity;
    expect(unknown.top).toBeNull();
    expect(unknown.topContinentId).toBeNull();
  });
});

describe('workers.profile: what a viewer may see', () => {
  it('shows the terms and morale of the viewer’s own worker', () => {
    const { engine, own, ownPromotionId } = profileWorld();
    const profile = profileOf(engine, own, PLAYER);

    const [current] = contractWith(profile, ownPromotionId);
    expect(current?.terms?.monthlyWage).toBe(OWN_WAGE);
    expect(current?.morale).toBe(35);
    expect(current?.momentum).toBe(12);
  });

  it('hides a rival’s terms and morale but keeps the employer, push and momentum', () => {
    const { engine, rival, rivalPromotionId } = profileWorld();
    const profile = profileOf(engine, rival, PLAYER);

    expect(profile.header.employer?.promotionId).toBe(rivalPromotionId);
    expect(profile.header.push).toBe('mainEvent');
    const [contract] = contractWith(profile, rivalPromotionId);
    expect(contract).toMatchObject({
      status: 'active',
      push: 'mainEvent',
      terms: null,
      morale: null,
      momentum: 55,
    });
    expect(profile.hidden).toEqual(['contractTerms', 'morale']);
    expect(JSON.stringify(profile)).not.toContain(String(RIVAL_WAGE));
  });

  it('hides the rival spell of the viewer’s own worker, and says so', () => {
    const { engine, own, rivalPromotionId } = profileWorld();
    const profile = profileOf(engine, own, PLAYER);

    const rivalRows = contractWith(profile, rivalPromotionId);
    expect(rivalRows).toHaveLength(1);
    expect(rivalRows[0]).toMatchObject({ status: 'released', terms: null, morale: null });
    expect(profile.hidden).toEqual(['contractTerms', 'morale']);
  });

  it('keeps another promotion’s open offer to itself', () => {
    const { engine, own, rivalPromotionId } = profileWorld();

    const forPlayer = contractWith(profileOf(engine, own, PLAYER), rivalPromotionId);
    expect(forPlayer.map((contract) => contract.status)).toEqual(['released']);
    const forEveryone = contractWith(profileOf(engine, own, OMNISCIENT), rivalPromotionId);
    expect(forEveryone.map((contract) => contract.status)).toEqual(['offered', 'released']);
  });

  it('shows everything to the all-seeing viewer and hides nothing', () => {
    const { engine, rival, rivalPromotionId } = profileWorld();
    const profile = profileOf(engine, rival, OMNISCIENT);

    const [contract] = contractWith(profile, rivalPromotionId);
    expect(contract?.terms?.monthlyWage).toBe(RIVAL_WAGE);
    expect(contract?.morale).toBe(-40);
    expect(profile.hidden).toEqual([]);
  });

  it('hides terms and morale from a human who runs nothing and from a computer viewer', () => {
    const { engine, own } = profileWorld();
    for (const viewer of [BYSTANDER, COMPUTER]) {
      const profile = profileOf(engine, own, viewer);
      for (const contract of profile.career.contracts) {
        expect(contract.terms).toBeNull();
        expect(contract.morale).toBeNull();
      }
      expect(profile.hidden).toEqual(['contractTerms', 'morale']);
    }
  });

  it('lists a known vice and one being recovered from, never a hidden one', () => {
    const { engine, own, ownPartner, rival } = profileWorld();

    for (const viewer of EVERY_VIEWER) {
      expect(profileOf(engine, own, viewer).vices).toEqual([
        { kind: 'alcohol', label: 'Alcohol', state: 'known' },
      ]);
      expect(profileOf(engine, ownPartner, viewer).vices).toEqual([
        { kind: 'substances', label: 'Substances', state: 'recovering' },
      ]);
      expect(profileOf(engine, rival, viewer).vices).toEqual([
        { kind: 'substances', label: 'Substances', state: 'known' },
      ]);
      expect(JSON.stringify(profileOf(engine, own, viewer))).not.toContain('hidden":"');
    }
  });

  it('never returns development or potential, to any viewer', () => {
    const { engine, own, rival, freeAgent } = profileWorld();
    for (const viewer of EVERY_VIEWER) {
      for (const personId of [own, rival, freeAgent]) {
        const keys = keysIn(profileOf(engine, personId, viewer));
        expect(keys.has('development')).toBe(false);
        expect(keys.has('potential')).toBe(false);
        expect(keys.has('ceilings')).toBe(false);
      }
    }
  });
});

describe('workers.profile: career', () => {
  it('lists contracts newest first', () => {
    const { engine, own } = profileWorld();
    const { contracts } = profileOf(engine, own, OMNISCIENT).career;

    expect(contracts.map((contract) => contract.status)).toEqual(['offered', 'active', 'released']);
    expect(contracts[2]).toMatchObject({
      ringName: 'Test Ring Name Old',
      endedOn: addYears(TEST_START_DATE, -1),
    });
  });

  it('lists title reigns newest first with the days held', () => {
    const { engine, own } = profileWorld();
    const { reigns } = profileOf(engine, own, PLAYER).career;

    expect(reigns).toHaveLength(2);
    expect(reigns[0]).toMatchObject({
      titleName: 'Test Heavyweight Title',
      promotionName: 'Test Promotion A',
      wonOn: addDays(TODAY, -30),
      lostOn: null,
      daysHeld: 30,
      endReason: null,
      partners: [],
    });
    expect(reigns[1]).toMatchObject({ daysHeld: 40, defences: 3, endReason: 'lost' });
  });

  it('names the partners of a team by their ring names', () => {
    const { engine, own, ownPartner } = profileWorld();
    const [team] = profileOf(engine, own, PLAYER).career.teams;

    expect(team).toMatchObject({ name: 'Test Team One', kind: 'tag', status: 'active' });
    expect(team?.partners).toHaveLength(1);
    expect(team?.partners[0]?.personId).toBe(ownPartner);
    expect(profileOf(engine, ownPartner, PLAYER).career.teams[0]?.partners[0]).toEqual({
      personId: own,
      name: 'Test Ring Name Own',
    });
  });

  it('lists traits with their labels', () => {
    const { engine, own } = profileWorld();
    expect(profileOf(engine, own, PLAYER).traits).toEqual([
      { key: 'workhorse', label: 'Workhorse' },
      { key: 'leader', label: 'Leader' },
    ]);
  });
});

describe('workers.profile: refusals and shape', () => {
  it('refuses an unknown person with notFound', () => {
    const { engine } = profileWorld();
    expect(engine.query('workers.profile', { personId: testId('person', 9999) }, PLAYER)).toEqual({
      ok: false,
      reasons: [{ code: 'notFound', message: 'No such worker' }],
    });
  });

  it('refuses a malformed id as invalid arguments', () => {
    const { engine } = profileWorld();
    const result = engine.queryRaw('workers.profile', { personId: 'nobody' }, PLAYER);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.reasons.map((reason) => reason.code)).toEqual(['invalidArgs']);
  });

  it('is plain JSON for every viewer', () => {
    const { engine, own, rival, freeAgent } = profileWorld();
    for (const viewer of EVERY_VIEWER) {
      for (const personId of [own, rival, freeAgent]) {
        expectSerialisable(profileOf(engine, personId, viewer));
      }
    }
  });
});
