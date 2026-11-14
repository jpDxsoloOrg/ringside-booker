/**
 * Canned worlds for tests. Each call builds a fresh world with the same IDs and rows, so two
 * calls give identical JSON.
 *
 * - `emptyWorld()`: metadata only, no rows at all (not even a season).
 * - `tinyWorld()`: a small world that uses every table; see its doc comment.
 * - `rosterWorld(n)`: one promotion with `n` wrestlers, for performance and save-size tests.
 */

import { addDays, addYears, parseGameDate, type GameDate } from '../../src/core/date';
import { parseContentKey } from '../../src/core/content-key';
import type { SegmentId } from '../../src/core/ids';
import { cents } from '../../src/core/money';
import {
  GENDERS,
  RING_STYLES,
  type Attributes,
  type Person,
} from '../../src/model/entities/person';
import type { ParticipantRole } from '../../src/model/entities/participant';
import type { PromotionSnapshot } from '../../src/model/entities/promotion-snapshot';
import { aDeal, aNetwork } from './builders/media';
import { aLedgerEntry } from './builders/ledger';
import { aPopularityShowChange } from './builders/popularity';
import { anAftermath } from './builders/aftermath';
import { aMail, aNews } from './builders/inbox';
import { aVenue } from './builders/geography';
import { testId } from './ids';
import {
  aContractConcern,
  anAiDecision,
  anAiProfile,
  aRelationship,
  aStable,
  aTeam,
} from './builders/promotions';
import {
  aMatch,
  anAngle,
  DEFAULT_METHOD_KEY,
  anEventInstance,
  aParticipant,
  aStoryline,
  aTitleReign,
} from './builders/creative';
import { TEST_PLAYER_ID, TEST_START_DATE, type DeepPartial } from './builders/build-row';
import {
  worldBuilder,
  type BuildContext,
  type BuiltWorld,
  type TestMetaOverrides,
} from './world-builder';

/** A world with metadata and nothing else. */
export function emptyWorld(): BuiltWorld {
  return worldBuilder().withoutSeason().build();
}

// ---------------------------------------------------------------------------------------------
// tinyWorld

/** The tiny world's start date (a Monday): season 1 starts here. */
export const TINY_WORLD_START = TEST_START_DATE;
/** The day both of the tiny world's titles were introduced, two years before the start. */
export const TINY_WORLD_TITLES_INTRODUCED = addYears(TINY_WORLD_START, -2);
/** The tiny world's last show, a Thursday early in season 2. */
export const TINY_WORLD_SHOW_DATE = parseGameDate('2026-04-09');
/** The tiny world's current date: the day after its last show. */
export const TINY_WORLD_TODAY = addDays(TINY_WORLD_SHOW_DATE, 1);

const THURSDAY = 3;

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`tinyWorld: missing ${what}`);
  }
  return value;
}

/**
 * The history half of `tinyWorld`: everything that needs the promotions, rosters and titles to
 * exist first. Promotion A's roster is `people[0..7]`, promotion B's `people[8..15]`.
 */
function addTinyHistory(context: BuildContext): void {
  const { tx, sequence, ids } = context;
  const person = (index: number) => required(ids.people[index], `person ${String(index)}`);
  const ringName = (index: number) => tx.view.tables.people.require(person(index)).defaultRingName;
  const promotionA = required(ids.promotions.A, 'promotion A');
  const promotionB = required(ids.promotions.B, 'promotion B');
  const brandA = required(ids.brands[0], 'brand');
  const [heavyweightTitle, tagTitle] = ids.titles;
  const [heavyweightReign, tagReign] = ids.titleReigns;
  const weeklyShow = required(ids.eventDefinitions[0], 'weekly show');
  const [northOne] = ids.regions;
  const [northCountry] = ids.countries;
  const titleBefore = addYears(TINY_WORLD_START, -1);

  // Groups and relationships.
  const team = context.insert(
    'teams',
    aTeam(
      {
        name: 'Test Tag Team A',
        memberIds: [person(2), person(3)],
        experience: 70,
        formedOn: addDays(TINY_WORLD_START, -200),
      },
      sequence,
    ),
  );
  tx.update('titleReigns', required(tagReign, 'tag reign'), { teamId: team.id });
  context.insert(
    'stables',
    aStable(
      {
        promotionId: promotionA,
        name: 'Test Stable A',
        memberIds: [person(0), person(6), person(7)],
        leaderId: person(0),
      },
      sequence,
    ),
  );
  context.insert(
    'relationships',
    aRelationship(
      { personAId: person(0), personBId: person(1), affinity: -40, bonds: ['rivals'] },
      sequence,
    ),
  );
  context.insert(
    'relationships',
    aRelationship(
      { personAId: person(2), personBId: person(3), affinity: 60, bonds: ['friends'] },
      sequence,
    ),
  );

  // Each title had one earlier champion (after the title was introduced), whose reign ended the
  // day the current one began.
  context.insert(
    'titleReigns',
    aTitleReign(
      {
        titleId: required(heavyweightTitle, 'heavyweight title'),
        holderIds: [person(1)],
        holderNamesAtTime: [ringName(1)],
        wonOn: titleBefore,
        lostOn: TINY_WORLD_START,
        defences: 3,
      },
      sequence,
    ),
  );
  context.insert(
    'titleReigns',
    aTitleReign(
      {
        titleId: required(tagTitle, 'tag title'),
        holderIds: [person(4), person(5)],
        holderNamesAtTime: [ringName(4), ringName(5)],
        wonOn: titleBefore,
        lostOn: TINY_WORLD_START,
        endReason: 'vacated',
      },
      sequence,
    ),
  );

  // Venue, network and the TV deal for the weekly show.
  const venue = context.insert(
    'venues',
    aVenue(
      {
        name: 'Test Venue North',
        regionId: required(northOne, 'region'),
        capacity: 3000,
        kind: 'arena',
      },
      sequence,
    ),
  );
  const network = context.insert(
    'networks',
    aNetwork(
      {
        name: 'Test Network North',
        reachTier: 2,
        coverage: { regionIds: [], countryIds: [required(northCountry, 'country')] },
      },
      sequence,
    ),
  );
  const deal = context.insert(
    'deals',
    aDeal(
      {
        networkId: network.id,
        promotionId: promotionA,
        eventDefinitionId: weeklyShow,
        weekday: THURSDAY,
        startsOn: TINY_WORLD_START,
      },
      sequence,
    ),
  );

  // The storyline the show's main event belongs to.
  const storyline = context.insert(
    'storylines',
    aStoryline(
      {
        promotionId: promotionA,
        brandId: brandA,
        name: 'Test Storyline A',
        startedOn: addDays(TINY_WORLD_START, 7),
        heat: 60,
        members: [
          { personId: person(0), side: 'face' },
          { personId: person(1), side: 'heel' },
        ],
        summary: 'A former champion wants the title back.',
      },
      sequence,
    ),
  );

  // Last Thursday's completed show and its card.
  const show = context.insert(
    'eventInstances',
    anEventInstance(
      {
        promotionId: promotionA,
        eventDefinitionId: weeklyShow,
        brandId: brandA,
        name: 'Test Weekly',
        format: { slots: 6, preShowSlots: 1 },
        date: TINY_WORLD_SHOW_DATE,
        status: 'completed',
        venueId: venue.id,
        regionId: venue.regionId,
        result: {
          score: 62,
          rawScore: 62,
          traceId: null,
          attendance: 2800,
          gate: cents(8_400_000),
          viewers: 150_000,
        },
      },
      sequence,
    ),
  );
  const winMethod = DEFAULT_METHOD_KEY;
  const opener = context.insert(
    'segments',
    aMatch(
      {
        eventInstanceId: show.id,
        rating: { score: 55, stars: 2.75, workRate: 52, crowd: 58, expectation: 50, traceId: null },
        outcome: { kind: 'win', winningSide: 1, methodKey: winMethod },
      },
      sequence,
    ),
  );
  const promo = context.insert(
    'segments',
    anAngle(
      {
        eventInstanceId: show.id,
        storylineIds: [storyline.id],
        rating: { score: 64, stars: 3, workRate: null, crowd: 66, expectation: 60, traceId: null },
        angle: {
          beats: [
            { beatKey: parseContentKey('beat.promo'), personIds: [person(0)] },
            { beatKey: parseContentKey('beat.attack'), personIds: [person(1), person(0)] },
          ],
        },
      },
      sequence,
    ),
  );
  const mainEvent = context.insert(
    'segments',
    aMatch(
      {
        eventInstanceId: show.id,
        label: 'Title match',
        storylineIds: [storyline.id],
        match: {
          titleIds: [required(heavyweightTitle, 'heavyweight title')],
          finishKey: parseContentKey('finish.clean'),
        },
        rating: { score: 71, stars: 3.5, workRate: 70, crowd: 74, expectation: 68, traceId: null },
        outcome: { kind: 'win', winningSide: 0, methodKey: winMethod },
      },
      sequence,
    ),
  );
  const preShow = context.insert(
    'segments',
    aMatch(
      {
        eventInstanceId: show.id,
        preShow: true,
        rating: { score: 40, stars: 2, workRate: 42, crowd: 36, expectation: 38, traceId: null },
        outcome: { kind: 'win', winningSide: 0, methodKey: winMethod },
      },
      sequence,
    ),
  );
  const cast: readonly (readonly [SegmentId, number, number, ParticipantRole])[] = [
    [opener.id, 4, 0, 'competitor'],
    [opener.id, 5, 1, 'competitor'],
    [promo.id, 0, 0, 'speaker'],
    [promo.id, 1, 1, 'speaker'],
    [mainEvent.id, 0, 0, 'competitor'],
    [mainEvent.id, 1, 1, 'competitor'],
    [preShow.id, 6, 0, 'competitor'],
    [preShow.id, 7, 1, 'competitor'],
  ];
  for (const [segmentId, personIndex, side, role] of cast) {
    context.insert(
      'participants',
      aParticipant(
        {
          segmentId,
          personId: person(personIndex),
          side,
          role,
        },
        sequence,
      ),
    );
  }
  tx.update('titleReigns', required(heavyweightReign, 'heavyweight reign'), { defences: 1 });

  // Inbox and news.
  context.insert(
    'mail',
    aMail(
      {
        promotionId: promotionA,
        date: TINY_WORLD_SHOW_DATE,
        category: 'results',
        subject: { key: parseContentKey('mail.show-results'), params: { show: 'Test Weekly' } },
        refs: { eventInstanceId: show.id },
        read: true,
      },
      sequence,
    ),
  );
  context.insert(
    'mail',
    aMail(
      {
        promotionId: promotionA,
        date: TINY_WORLD_TODAY,
        category: 'request',
        from: { kind: 'person', personId: person(7) },
        subject: { key: parseContentKey('mail.time-off-request'), params: { days: 7 } },
        refs: { personIds: [person(7)] },
        decision: {
          options: [
            { key: 'accept', label: { key: parseContentKey('decision.accept'), params: {} } },
            { key: 'decline', label: { key: parseContentKey('decision.decline'), params: {} } },
          ],
          chosenKey: null,
          expiresOn: addDays(TINY_WORLD_TODAY, 7),
        },
      },
      sequence,
    ),
  );
  context.insert(
    'news',
    aNews(
      {
        date: TINY_WORLD_START,
        kind: 'business',
        refs: { promotionIds: [promotionA, promotionB] },
      },
      sequence,
    ),
  );
  context.insert(
    'news',
    aNews(
      {
        date: TINY_WORLD_SHOW_DATE,
        kind: 'result',
        importance: 2,
        refs: { personIds: [person(0), person(1)], eventInstanceId: show.id },
        expiresOn: addDays(TINY_WORLD_SHOW_DATE, 30),
      },
      sequence,
    ),
  );

  // Money: the show's takings and costs for A, and a month of wages for both promotions.
  const ledger: DeepPartialLedger[] = [
    {
      promotionId: promotionA,
      date: TINY_WORLD_SHOW_DATE,
      category: 'tickets',
      amount: cents(8_400_000),
      refs: { eventInstanceId: show.id },
    },
    {
      promotionId: promotionA,
      date: TINY_WORLD_SHOW_DATE,
      category: 'broadcast',
      amount: cents(100_000),
      refs: { eventInstanceId: show.id, dealId: deal.id },
    },
    {
      promotionId: promotionA,
      date: TINY_WORLD_SHOW_DATE,
      category: 'venueRent',
      amount: cents(-1_500_000),
      refs: { eventInstanceId: show.id },
    },
    {
      promotionId: promotionA,
      date: parseGameDate('2026-04-01'),
      category: 'wages',
      amount: cents(-4_000_000),
    },
    {
      promotionId: promotionB,
      date: parseGameDate('2026-04-01'),
      category: 'wages',
      amount: cents(-4_000_000),
    },
  ];
  for (const entry of ledger) {
    context.insert('ledgerEntries', aLedgerEntry(entry, sequence));
  }

  // What the show did to A's popularity: its own region and its TV deal's network.
  context.insert(
    'popularityShowChanges',
    aPopularityShowChange(
      {
        eventInstanceId: show.id,
        promotionId: promotionA,
        date: TINY_WORLD_SHOW_DATE,
        score: 62,
        worldBefore: 0,
        worldAfter: 0.3,
        regions: {
          [show.regionId]: {
            source: 'show',
            networkId: null,
            weight: 1,
            expectation: 10,
            before: 0,
            after: 1.2,
            capped: false,
          },
        },
      },
      sequence,
    ),
  );

  // The title match's aftermath (MTCH3-03): the champion gained, the challenger lost a little.
  const aftermathOf = (
    index: number,
    outcome: 'win' | 'loss',
    popularity: readonly [number, number],
    momentum: readonly [number, number],
  ) => {
    const personId = person(index);
    const employmentId = required(ids.employments[index], `employment ${String(index)}`);
    context.insert(
      'aftermaths',
      anAftermath(
        {
          segmentId: mainEvent.id,
          eventInstanceId: show.id,
          promotionId: promotionA,
          personId,
          date: TINY_WORLD_SHOW_DATE,
          outcome,
          showRegionId: show.regionId,
          popularity: {
            delta: popularity[1] - popularity[0],
            byRegion: { [show.regionId]: { before: popularity[0], after: popularity[1] } },
          },
          momentum: { employmentId, before: momentum[0], after: momentum[1] },
          traceIds: {
            popularity: `match.popularityGain:${mainEvent.id}/${personId}`,
            momentum: `match.momentumGain:${mainEvent.id}/${personId}`,
          },
        },
        sequence,
      ),
    );
  };
  aftermathOf(0, 'win', [50, 51.5], [10, 15]);
  aftermathOf(1, 'loss', [45, 44.5], [5, 0]);
}

type DeepPartialLedger = Parameters<typeof aLedgerEntry>[0];

/** Promotion A's weekly history (DAY2-01): three Mondays, each a little different. */
function tinySnapshot(
  date: string,
  cash: number,
  popularity: number,
  averageMorale: number,
): DeepPartial<PromotionSnapshot> {
  return {
    date: parseGameDate(date),
    granularity: 'week',
    cash: cents(cash),
    prestige: 50,
    popularity: {
      headline: popularity,
      world: popularity / 2,
      homeRegionValue: popularity + 4,
      byContinent: { [testId('continent')]: popularity / 2 },
    },
    rosterSize: 8,
    averageMorale,
  };
}

/**
 * Promotion B's rival desk (AIP1-01): its profile, a roster review it made last Thursday (already
 * revealed) and a plan for next Thursday's card that stays hidden until that day.
 */
function addTinyRivalDesk(context: BuildContext): void {
  const { sequence, ids } = context;
  const promotionB = required(ids.promotions.B, 'promotion B');
  const personB = required(ids.people[8], 'person 8');
  const employmentB = required(ids.employments[8], 'employment 8');
  context.insert(
    'aiProfiles',
    anAiProfile({ promotionId: promotionB, createdOn: TINY_WORLD_START }, sequence),
  );
  context.insert(
    'aiDecisions',
    anAiDecision(
      {
        promotionId: promotionB,
        date: TINY_WORLD_SHOW_DATE,
        kind: 'rosterReview',
        summary: {
          key: parseContentKey('aip.decision.roster-review'),
          params: { name: 'Test Promotion B' },
        },
        refs: { personIds: [personB], employmentIds: [employmentB] },
        revealOn: TINY_WORLD_SHOW_DATE,
        importance: 1,
      },
      sequence,
    ),
  );
  context.insert(
    'aiDecisions',
    anAiDecision(
      {
        promotionId: promotionB,
        date: TINY_WORLD_TODAY,
        kind: 'card',
        summary: { key: parseContentKey('aip.decision.card'), params: {} },
        refs: { personIds: [personB], employmentIds: [employmentB] },
        revealOn: addDays(TINY_WORLD_SHOW_DATE, 7),
        importance: 2,
      },
      sequence,
    ),
  );
}

const TINY_WORLD_SNAPSHOTS: readonly DeepPartial<PromotionSnapshot>[] = [
  tinySnapshot('2026-03-23', 1_003_000_000, 10, 2),
  tinySnapshot('2026-03-30', 1_001_500_000, 10.5, 1.5),
  tinySnapshot('2026-04-06', 1_000_000_000, 11.25, 3),
];

/**
 * A small world that uses every table, for tests that need a bit of everything:
 *
 * - the mini geography (1 continent, 2 countries, 4 regions) and 2 seasons: season 1 completed,
 *   season 2 active and starting the day after season 1 ends. Today is `TINY_WORLD_TODAY`;
 * - promotion A, run by `player-1`, with 1 brand, 8 wrestlers, a singles title and a tag title
 *   (each with an earlier, closed reign and a current one; the tag champions are 1 tag team), a
 *   stable, a weekly Thursday show (6 slots and a 1-slot pre-show), a storyline, and a TV deal
 *   with 1 network for that show;
 * - promotion B, computer-run, with 8 wrestlers;
 * - last Thursday's completed show with 4 segments: main-card slots 0-2 are a match, a two-beat
 *   angle and the title match (both matches with outcomes and ratings; the title match's planned
 *   finish is `finish.clean`), pre-show slot 0 is a match; and their 8 participants;
 * - 1 venue, 2 relationships, 2 mail (one with an open decision), 2 news and 5 ledger entries;
 * - 1 per-show popularity record for last Thursday's show;
 * - 2 aftermath rows for the title match: people[0] won, people[1] lost;
 * - 3 weekly history rows for promotion A (the Mondays 2026-03-23, 03-30 and 04-06), with cash,
 *   popularity and morale moving a little each week, so the Office has a trend to draw;
 * - promotion B's rival desk profile and 2 rival decisions: one already revealed, one revealed
 *   next Thursday;
 * - 1 past injury (WRK6-03): people[4] hurt their arm off screen on the start date and back ten
 *   days later, so nobody is injured today;
 * - 1 contract concern (ECO4-01): a seen expiry notice on promotion A's people[5] contract;
 * - the shipped base catalogs on its metadata (`TEST_CATALOGS`), so every segment key resolves.
 */
export function tinyWorld(): BuiltWorld {
  return worldBuilder({
    worldName: 'Test Tiny World',
    startDate: TINY_WORLD_START,
    currentDate: TINY_WORLD_TODAY,
  })
    .withGeography('mini')
    .withCatalogs()
    .withSeasons(2)
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand A' })
          .withRoster(8)
          .withTitle(
            {
              name: 'Test Heavyweight Title',
              prestige: 70,
              introducedOn: TINY_WORLD_TITLES_INTRODUCED,
            },
            { holder: 0, wonOn: TINY_WORLD_START },
          )
          .withTitle(
            {
              name: 'Test Tag Team Title',
              holderCount: 2,
              color: '#8a8d91',
              introducedOn: TINY_WORLD_TITLES_INTRODUCED,
            },
            { holder: [2, 3], wonOn: TINY_WORLD_START },
          )
          .withWeeklyShow(
            { name: 'Test Weekly', weekdays: [THURSDAY] },
            { format: { slots: 6, preShowSlots: 1 } },
          ),
    )
    .withPromotion(
      { name: 'Test Promotion B', shortName: 'TPB', style: 'technical', cash: cents(250_000_000) },
      (promotion) => promotion.withRoster(8),
    )
    .with('history', addTinyHistory)
    .withPromotionSnapshots('A', TINY_WORLD_SNAPSHOTS)
    .with('rival desk', addTinyRivalDesk)
    .withInjury(4, {
      since: TINY_WORLD_START,
      expectedReturn: addDays(TINY_WORLD_START, 10),
      returnedOn: addDays(TINY_WORLD_START, 10),
    })
    .with('contract concern', addTinyContractConcern)
    .build();
}

/** A seen expiry notice on promotion A's people[5] contract, so the table is not empty. */
function addTinyContractConcern(context: BuildContext): void {
  const employmentId = context.ids.employments[5];
  if (employmentId === undefined) {
    throw new Error('tinyWorld: the contract concern needs promotion A to have 6 workers');
  }
  const employment = context.tx.view.tables.employments.require(employmentId);
  context.insert(
    'contractConcerns',
    aContractConcern(
      {
        employmentId,
        personId: employment.personId,
        promotionId: employment.promotionId,
        expiryNotice: { raisedOn: TINY_WORLD_TODAY, seenOn: TINY_WORLD_TODAY },
        ending: null,
      },
      context.sequence,
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// rosterWorld

const WRESTLING_STYLES = RING_STYLES.filter((style) => style !== 'nonWrestler');

/** Attribute `attributeIndex` of roster member `rosterIndex`: 20-80, from a fixed pattern. */
function patternedValue(rosterIndex: number, attributeIndex: number): number {
  return 20 + ((rosterIndex * 7 + attributeIndex * 13) % 61);
}

function patternedAttributes(rosterIndex: number): Attributes {
  const value = (attributeIndex: number): number => patternedValue(rosterIndex, attributeIndex);
  return {
    ringwork: value(0),
    psychology: value(1),
    stamina: value(2),
    safety: value(3),
    athleticism: value(4),
    mic: value(5),
    charisma: value(6),
    presence: value(7),
    officiating: value(8),
    broadcasting: value(9),
    producing: value(10),
    booking: value(11),
  };
}

/** A roster member with varied attributes, age, size, gender and style, from fixed arithmetic. */
function patternedPerson(rosterIndex: number, startDate: GameDate): DeepPartial<Person> {
  return {
    gender: GENDERS[rosterIndex % GENDERS.length] ?? 'male',
    birthDate: addYears(startDate, -(20 + (rosterIndex % 20))),
    heightCm: 165 + ((rosterIndex * 3) % 40),
    weightKg: 70 + ((rosterIndex * 11) % 80),
    style: WRESTLING_STYLES[rosterIndex % WRESTLING_STYLES.length] ?? 'allRounder',
    attributes: patternedAttributes(rosterIndex),
    fatigue: (rosterIndex * 5) % 30,
  };
}

/**
 * One computer-run promotion in the mini geography with `rosterSize` wrestlers under contract,
 * each with different attributes from a fixed arithmetic pattern (no randomness), and a weekly
 * Monday show, so a headless run schedules and runs a show every week. It carries the shipped
 * base catalogs and `TEST_INJURY_CATALOG`, so the headless runner exercises injuries. For
 * performance and save-size tests and the headless runner.
 */
export function rosterWorld(rosterSize: number, meta: TestMetaOverrides = {}): BuiltWorld {
  return worldBuilder(meta)
    .withGeography('mini')
    .withCatalogs()
    .withInjuryCatalog()
    .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
      promotion
        .withRoster(rosterSize, {
          person: (rosterIndex) => patternedPerson(rosterIndex, TEST_START_DATE),
          employment: (rosterIndex) => ({
            push: rosterIndex % 10 === 0 ? 'mainEvent' : 'midCard',
            alignment: rosterIndex % 2 === 0 ? 'face' : 'heel',
          }),
        })
        .withWeeklyShow({ name: 'Test Weekly', weekdays: [0] }),
    )
    .build();
}
