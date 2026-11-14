/**
 * Hand-written news for the gallery, shaped as `news.top`, `news.feed` and `news.item` return it
 * (`NewsItemView` and `NewsNames`). No engine runs; the people, promotions and titles are made up.
 */
import {
  BUILT_IN_NEWS_ALERT_RULES,
  NEWS_KIND_LABELS,
  parseContentKey,
  parseGameDate,
  parseId,
} from '@ringside/engine';
import type {
  NewsImportance,
  NewsItemView,
  NewsKind,
  NewsNames,
  TraceNode,
} from '@ringside/engine';
import type { NewsAlertSettings } from '@/screens/news/NewsAlertSheet';
import '@/text/catalogs/news.en';

const VERA = parseId('person', 'per_0000000801');
const OTTO = parseId('person', 'per_0000000802');
const JUNO = parseId('person', 'per_0000000803');
const CROWN = parseId('promotion', 'pro_0000000801');
const BELT = parseId('title', 'tit_0000000801');

export const GALLERY_NEWS_NAMES: NewsNames = {
  [VERA]: { kind: 'person', name: 'Vera Quill' },
  [OTTO]: { kind: 'person', name: 'Otto Brandvold' },
  [JUNO]: { kind: 'person', name: 'Juno Harrow' },
  [CROWN]: { kind: 'promotion', name: 'Coastline Wrestling Alliance' },
  [BELT]: { kind: 'title', name: 'Coastline Heavyweight Championship' },
};

interface StoryInput {
  readonly id: number;
  readonly kind: NewsKind;
  readonly topic: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly bodyParams?: Readonly<Record<string, string | number>>;
  readonly personIds?: readonly string[];
  readonly promotionIds?: readonly string[];
  readonly importance: NewsImportance;
  readonly buzz: number;
  readonly date: string;
  readonly expiresOn: string | null;
}

function story(input: StoryInput): NewsItemView {
  const id = parseId('news', `nws_00000008${String(input.id).padStart(2, '0')}`);
  return {
    id,
    date: parseGameDate(input.date),
    kind: input.kind,
    kindLabel: NEWS_KIND_LABELS[input.kind],
    headline: { key: parseContentKey(`news.${input.topic}.headline`), params: { ...input.params } },
    body: {
      key: parseContentKey(`news.${input.topic}.body`),
      params: { ...input.params, ...input.bodyParams },
    },
    refs: {
      personIds: (input.personIds ?? []).map((person) => parseId('person', person)),
      promotionIds: (input.promotionIds ?? []).map((promotion) => parseId('promotion', promotion)),
      eventInstanceId: null,
      employmentId: null,
    },
    importance: input.importance,
    buzz: input.buzz,
    buzzTraceRef: { kind: 'news.buzz', id },
    frontPage: input.importance === 3 || input.buzz >= 65,
    expiresOn: input.expiresOn === null ? null : parseGameDate(input.expiresOn),
  };
}

/** A record reign: front-page, prestige. */
export const GALLERY_RECORD_STORY = story({
  id: 1,
  kind: 'titleChange',
  topic: 'reign-record',
  params: { holderIds: VERA, titleId: BELT, previousHolderIds: `${OTTO},${JUNO}`, days: 412 },
  bodyParams: { onDate: '2027-03-14' },
  personIds: [VERA, OTTO, JUNO],
  promotionIds: [CROWN],
  importance: 3,
  buzz: 88,
  date: '2027-03-15',
  expiresOn: null,
});

/** A team's reign milestone: action tone (a rivalry), with a picture. */
export const GALLERY_RIVALRY_STORY = story({
  id: 2,
  kind: 'rivalry',
  topic: 'reign-milestone',
  params: { holderIds: `${OTTO},${JUNO}`, titleId: BELT, days: 200 },
  bodyParams: { onDate: '2027-03-12' },
  personIds: [OTTO, JUNO],
  promotionIds: [CROWN],
  importance: 2,
  buzz: 71,
  date: '2027-03-13',
  expiresOn: '2027-04-12',
});

/** A promotion's anniversary: data tone, the promotion's crest. */
export const GALLERY_ANNIVERSARY_STORY = story({
  id: 3,
  kind: 'milestone',
  topic: 'promotion-anniversary',
  params: { promotionId: CROWN, years: 10 },
  bodyParams: { onDate: '2027-03-10' },
  promotionIds: [CROWN],
  importance: 2,
  buzz: 66,
  date: '2027-03-11',
  expiresOn: '2027-04-10',
});

/** A new season: no one in it, so no picture. */
export const GALLERY_SEASON_STORY = story({
  id: 4,
  kind: 'season',
  topic: 'season-start',
  params: { seasonNumber: 3 },
  bodyParams: { startDate: '2027-01-04', endDate: '2027-12-27', worldName: 'the Coastline world' },
  importance: 3,
  buzz: 70,
  date: '2027-01-04',
  expiresOn: null,
});

/** The buzz breakdown every gallery story shows behind its Why?. */
export const GALLERY_BUZZ_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Buzz',
  value: 88,
  docRef: 'news.md#buzz',
  children: [
    { kind: 'input', label: 'A title story starts at', value: 60 },
    { kind: 'add', label: 'Front-page importance', value: 75, operand: 15, before: 60, after: 75 },
    {
      kind: 'add',
      label: 'How popular the people in it are',
      value: 88,
      operand: 13,
      before: 75,
      after: 88,
    },
  ],
};

/**
 * Alert settings as `news.alertRules` answers for a player who turned on "My roster" and left
 * the rest at their defaults, plus a rule a later feature would register.
 */
export const GALLERY_ALERT_SETTINGS: NewsAlertSettings = {
  rules: [
    ...BUILT_IN_NEWS_ALERT_RULES.map((rule) => ({
      id: rule.id,
      label: rule.label,
      description: rule.description,
      enabled: rule.id === 'myRoster' ? true : rule.defaultOn,
      defaultOn: rule.defaultOn,
    })),
    {
      id: 'shortlist',
      label: 'Shortlisted workers',
      description: 'Any story about a worker on your scouting shortlist, wherever they work.',
      enabled: false,
      defaultOn: false,
    },
  ],
  stopSkip: true,
};
