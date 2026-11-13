/**
 * Hand-written rival desk answers for the gallery and the component tests, shaped as `aip.rules`,
 * `aip.needs`, `aip.decisionLog` and `promotions.profile` return them. No engine runs; the
 * promotions and people are made up.
 */
import { parseContentKey, parseGameDate, parseId } from '@ringside/engine';
import { localHeroRollup } from './popularityRollups';
import type {
  AipDecisionLog,
  AipDecisionLogEntry,
  AipNeeds,
  AipRulesView,
  AiShortcutRuleView,
  PromotionProfile,
  TraceNode,
} from '@ringside/engine';

const NEEDS_DOC = 'rival-desk.md#needs';

/** A short severity breakdown: target, minus what the roster has, as a share of 100. */
function severityTrace(label: string, target: number, have: number): TraceNode {
  const value = Math.round(((target - have) / target) * 100);
  return {
    kind: 'formula',
    label,
    value,
    unit: 'points',
    docRef: NEEDS_DOC,
    children: [
      { kind: 'input', label: 'Wanted', value: target },
      {
        kind: 'subtract',
        label: 'Available now',
        value: target - have,
        operand: have,
        before: target,
        after: target - have,
      },
      {
        kind: 'multiply',
        label: 'As points of the target',
        value,
        operand: 100 / target,
        before: target - have,
        after: value,
      },
    ],
  };
}

const SLOTS_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Wrestlers its largest show calls for',
  value: 16,
  docRef: NEEDS_DOC,
  children: [
    { kind: 'input', label: 'Largest show has 8 slots', value: 8 },
    {
      kind: 'multiply',
      label: 'Wrestlers per slot',
      value: 16,
      operand: 2,
      before: 8,
      after: 16,
    },
  ],
};

/** Three needs, most pressing first. */
export const galleryNeeds: Pick<AipNeeds, 'slotsDemanded' | 'needs'> = {
  slotsDemanded: { value: 16, trace: SLOTS_TRACE },
  needs: [
    {
      key: 'champion-gone:tit_0000000001',
      kind: 'champion',
      summary: {
        key: parseContentKey('aip.need.champion-gone'),
        params: { title: 'Gallery World Title' },
      },
      text: 'Champion has left: Gallery World Title',
      severity: { value: 100, trace: severityTrace('Champion has left', 1, 0) },
      refs: { personIds: [], titleIds: [parseId('title', 'tit_0000000001')] },
    },
    {
      key: 'depth:mainEvent',
      kind: 'depth',
      summary: {
        key: parseContentKey('aip.need.depth'),
        params: { band: 'Main event', have: 1, target: 2 },
      },
      text: 'Thin at main event: 1 of 2',
      severity: { value: 50, trace: severityTrace('Thin at main event', 2, 1) },
      refs: { personIds: [], titleIds: [] },
    },
    {
      key: 'crew:referee',
      kind: 'crew',
      summary: {
        key: parseContentKey('aip.need.crew'),
        params: { role: 'referees', have: 2, target: 3 },
      },
      text: 'Short of referees: 2 of 3',
      severity: { value: 33, trace: severityTrace('Short of referees', 3, 2) },
      refs: { personIds: [], titleIds: [] },
    },
  ],
};

/** The same roster with nothing short. */
export const galleryNoNeeds: Pick<AipNeeds, 'slotsDemanded' | 'needs'> = {
  slotsDemanded: { value: 16, trace: SLOTS_TRACE },
  needs: [],
};

const REVIEW_TRACE: TraceNode = {
  kind: 'decision',
  label: 'Weekly roster review',
  value: 'depth:mainEvent',
  chosen: 'depth:mainEvent',
  reason: 'Most pressing need',
  considered: [],
  children: [],
};

function entry(
  id: string,
  date: string,
  params: Readonly<Record<string, string | number>>,
  withWhy: boolean,
): AipDecisionLogEntry {
  return {
    decisionId: parseId('aiDecision', id),
    date: parseGameDate(date),
    brandId: null,
    kind: 'rosterReview',
    chip: 'Roster review',
    summary: { key: parseContentKey('aip.decision.roster-review'), params: { ...params } },
    text: '',
    refs: {
      personIds: [],
      employmentIds: [],
      titleIds: [],
      promotionIds: [],
      eventInstanceId: null,
    },
    traceRef: withWhy ? { kind: 'aip.rosterReview', id } : null,
    importance: 0,
  };
}

/** Three reviews, the oldest without its Why? any more, and two plans not aired yet. */
export const galleryDecisionLog: AipDecisionLog = {
  entries: [
    entry('aid_0000000003', '2026-04-16', { count: 2, top: 'Thin at main event: 1 of 2' }, true),
    entry('aid_0000000002', '2026-04-09', { count: 1, top: 'Short on heels' }, true),
    entry('aid_0000000001', '2026-04-02', { count: 0 }, false),
  ],
  kinds: [{ kind: 'rosterReview', chip: 'Roster review', count: 3 }],
  hiddenCount: 2,
  nextBefore: null,
  keptNote: 'Decisions are kept for the last 4 weeks.',
};

/** The gallery's inline trace for the reviews' Why? (no engine to fetch a stored one from). */
export const galleryReviewTrace = REVIEW_TRACE;

/** A log with nothing in it yet. */
export const galleryEmptyDecisionLog: AipDecisionLog = {
  entries: [],
  kinds: [],
  hiddenCount: 0,
  nextBefore: null,
  keptNote: 'Decisions are kept for the last 4 weeks.',
};

function rule(overrides: Partial<AiShortcutRuleView> & Pick<AiShortcutRuleView, 'key' | 'label'>) {
  const base: AiShortcutRuleView = {
    key: overrides.key,
    label: overrides.label,
    description: 'What the shortcut does for a computer-run promotion.',
    offText: 'Rivals play by the full rules here.',
    consumer: 'Injuries',
    kind: 'flag',
    value: true,
    defaultValue: true,
    overridden: false,
    inForce: true,
    consumers: [],
  };
  return { ...base, ...overrides };
}

const SHORTCUTS: readonly AiShortcutRuleView[] = [
  rule({
    key: 'ai.skipInMatchInjuries',
    label: 'No in-match injuries',
    description:
      "Rivals' matches cause no in-match injuries; their injuries come from world events.",
    consumer: 'In-match injuries',
  }),
  rule({
    key: 'ai.skipResultMorale',
    label: 'No result morale',
    description: "Rival workers' morale does not move with match results.",
    consumer: 'Morale',
  }),
  rule({
    key: 'ai.scoreBonus',
    label: 'Score bonus',
    description: 'Points added to every rival segment score.',
    consumer: 'Match ratings',
    kind: 'points',
    value: 3,
    defaultValue: 3,
    consumers: ['Match ratings'],
  }),
  rule({
    key: 'ai.simpleBookingInputs',
    label: 'Simple bookings',
    description: 'Rival bookings skip production notes and match plans.',
    consumer: 'Match ratings',
    consumers: ['Match ratings'],
  }),
  rule({
    key: 'ai.skipMediaRequests',
    label: 'No media requests',
    description: 'Rivals receive no media requests.',
    consumer: 'Media requests',
    value: false,
    overridden: true,
    inForce: false,
  }),
  rule({
    key: 'ai.skipWorkerRequests',
    label: 'No worker requests',
    description: 'Rival workers make no requests of their bosses.',
    consumer: 'Worker requests',
  }),
];

/** The default rules, with media requests turned off for this game. */
export const galleryRules: AipRulesView = {
  levelPlayingField: false,
  appliesTo: 'computer',
  shortcuts: [...SHORTCUTS],
};

/** A game started with the level playing field: nothing in force. */
export const galleryLevelRules: AipRulesView = {
  levelPlayingField: true,
  appliesTo: 'computer',
  shortcuts: SHORTCUTS.map((shortcut) => ({ ...shortcut, inForce: false })),
};

/** A computer-run promotion's profile header, with two brands. */
export const galleryRivalHeader: PromotionProfile['header'] = {
  name: 'Gallery Championship Wrestling',
  shortName: 'GCW',
  logoRef: null,
  color: '#2a6fdb',
  style: 'hardHitting',
  status: 'active',
  foundedOn: parseGameDate('1998-06-01'),
  homeRegion: { id: parseId('region', 'reg_0000000001'), name: 'Gallery North' },
  homeCountry: { id: parseId('country', 'cty_0000000001'), name: 'Galleria' },
  controlledBy: 'computer',
  brands: [
    {
      brandId: parseId('brand', 'brd_0000000001'),
      name: 'Monday Mayhem',
      controlledBy: 'computer',
    },
    { brandId: parseId('brand', 'brd_0000000002'), name: 'Friday Fury', controlledBy: 'computer' },
  ],
};

/** The player's own promotion, with no brands and a long name that wraps. */
export const galleryOwnHeader: PromotionProfile['header'] = {
  ...galleryRivalHeader,
  name: 'The Very Long Named Independent Pro Wrestling Alliance of the Northern Coast',
  shortName: 'VLNIPWA',
  style: 'entertainment',
  controlledBy: 'you',
  brands: [],
};

const FLAT_TRACE: TraceNode = { kind: 'input', label: 'Popularity', value: 40 };

/** A whole `promotions.profile` answer for the rival, for tests of the tab rules. */
export const galleryRivalProfile: PromotionProfile = {
  header: galleryRivalHeader,
  kpis: {
    popularityHome: { value: 40, trace: FLAT_TRACE },
    popularityWorld: { value: 12, trace: FLAT_TRACE },
    prestige: 55,
    rosterCount: 24,
    crewCount: 6,
    championCount: 2,
    showsPerMonth: 8,
    cash: { kind: 'hidden' },
  },
  popularity: localHeroRollup,
  shows: [],
  titles: [],
  rules: { inForce: true, levelPlayingField: false, shortcuts: [] },
  hasProfile: true,
  hidden: ['cash'],
};
