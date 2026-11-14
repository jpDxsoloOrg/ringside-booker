/**
 * Story buzz: how much the wrestling world is talking about a news story, 0..100.
 *
 * Our own formula, in our own terms: a base for the kind of story, points for each level of
 * importance, and points for how well known the people and promotions in it are. Popularity has
 * diminishing returns (a soft cap), and only the best-known few count: the first in full, each one
 * after it at a share. Buzz is fixed when the story is posted, so it says how big the story was
 * when it broke. No rolls: the same story in the same world always gets the same buzz.
 *
 * Design: docs/design/news.md#buzz.
 */

import { compareIds } from '../../../model/table';
import { startCalc, traced, type EntityRef, type Traced } from '../../../core/trace';
import { NEWS_KIND_LABELS, type NewsImportance, type NewsKind } from '../../../model/entities/news';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const BUZZ_SCORE_DOC_REF = 'docs/design/news.md#buzz';

/** The lowest and highest buzz a story can have. */
export const BUZZ_MIN = 0;
export const BUZZ_MAX = 100;

/** One person or promotion in a story, with their worldwide popularity. */
export interface BuzzSubject {
  /** Their name on screen: a ring name or a promotion's name. */
  readonly label: string;
  readonly ref: EntityRef;
  /** Worldwide popularity, 0..100, with its own trace (the popularity roll-up's world value). */
  readonly popularity: Traced<number>;
}

export interface BuzzScoreInputs {
  readonly kind: NewsKind;
  readonly importance: NewsImportance;
  readonly subjects: readonly BuzzSubject[];
  /**
   * People and promotions the story names that no longer exist. They add nothing and get a line
   * in the trace saying so.
   */
  readonly skipped?: readonly EntityRef[];
}

export const BUZZ_KIND_BASE_KEYS = {
  result: 'news.buzz.kindBase.result',
  titleChange: 'news.buzz.kindBase.titleChange',
  signing: 'news.buzz.kindBase.signing',
  release: 'news.buzz.kindBase.release',
  injury: 'news.buzz.kindBase.injury',
  retirement: 'news.buzz.kindBase.retirement',
  rumour: 'news.buzz.kindBase.rumour',
  business: 'news.buzz.kindBase.business',
  milestone: 'news.buzz.kindBase.milestone',
  backstage: 'news.buzz.kindBase.backstage',
  personal: 'news.buzz.kindBase.personal',
  season: 'news.buzz.kindBase.season',
  award: 'news.buzz.kindBase.award',
  rivalry: 'news.buzz.kindBase.rivalry',
} as const satisfies Readonly<Record<NewsKind, NumberTunableKey>>;

/** "a rumour", "an injury": the kind's label in a sentence. */
function kindPhrase(kind: NewsKind): string {
  const label = NEWS_KIND_LABELS[kind].toLowerCase();
  return /^[aeiou]/.test(label) ? `an ${label}` : `a ${label}`;
}

/** Highest popularity first; equal popularity in ID order, so the order never depends on input. */
function byPopularity(left: BuzzSubject, right: BuzzSubject): number {
  const order = right.popularity.value - left.popularity.value;
  return order !== 0 ? order : compareIds(left.ref.id, right.ref.id);
}

function importanceTerm(importance: NewsImportance, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Buzz from importance', importance, {
    unit: 'points',
    startLabel: 'Importance',
  });
  calc.multiply(
    'Points per level of importance',
    calc.tunable(tunables, 'news.buzz.importancePoints', 'Points per level of importance'),
  );
  return calc.done();
}

/** The subject's popularity as the starting value, linked to the subject for the Why? panel. */
function popularityInput(subject: BuzzSubject): Traced<number> {
  return traced(subject.popularity.value, {
    kind: 'input',
    label: `Popularity of ${subject.label}`,
    value: subject.popularity.value,
    unit: 'points',
    ref: { kind: subject.ref.kind, id: subject.ref.id },
    children: [subject.popularity.trace],
  });
}

/** `popularityMax × p / (p + popularitySoftCap)`, then the subject's share. */
function subjectTerm(
  subject: BuzzSubject,
  position: number,
  tunables: EngineTunables,
): Traced<number> {
  const popularity = subject.popularity.value;
  const calc = startCalc(`Buzz from ${subject.label}`, popularityInput(subject), {
    unit: 'points',
  });
  const softCap = tunables.get('news.buzz.popularitySoftCap');
  if (popularity + softCap === 0) {
    // The value is already 0: there is no popularity to scale.
    calc.branch('No popularity, no soft cap', true);
  } else {
    calc.multiply(
      'Most buzz popularity can add',
      calc.tunable(tunables, 'news.buzz.popularityMax', 'Most buzz popularity can add'),
    );
    const divisor = startCalc(
      'Popularity plus the soft cap',
      traced(popularity, { kind: 'input', label: 'Popularity', value: popularity }),
      { unit: 'points' },
    );
    divisor.add(
      'Soft cap: the popularity that earns half the most buzz',
      divisor.tunable(tunables, 'news.buzz.popularitySoftCap', 'Popularity soft cap'),
    );
    calc.divide(`Popularity ${formatNumber(popularity)} plus the soft cap`, divisor.done());
  }
  if (position > 0) {
    const share = tunables.get('news.buzz.extraSubjectShare');
    calc.multiply(
      `Each further subject counts ${formatNumber(share)}`,
      calc.tunable(tunables, 'news.buzz.extraSubjectShare', 'Share for each further subject'),
    );
  }
  return calc.done();
}

/** A story's buzz, 0..100, with the full working. Deterministic: no rolls. */
export function buzzScore(
  inputs: BuzzScoreInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Story buzz', 0, {
    unit: 'points',
    docRef: BUZZ_SCORE_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc.add(
    `Base for ${kindPhrase(inputs.kind)} story`,
    calc.tunable(tunables, BUZZ_KIND_BASE_KEYS[inputs.kind]),
  );
  calc.add(
    `Importance ${String(inputs.importance)} × points per level`,
    importanceTerm(inputs.importance, tunables),
  );

  const subjects = [...inputs.subjects].sort(byPopularity);
  const maxSubjects = tunables.get('news.buzz.maxSubjects');
  for (const [position, subject] of subjects.slice(0, maxSubjects).entries()) {
    calc.add(`Popularity of ${subject.label}`, subjectTerm(subject, position, tunables));
  }
  const leftOut = subjects.length - Math.min(subjects.length, maxSubjects);
  if (leftOut > 0) {
    const most = calc.tunable(tunables, 'news.buzz.maxSubjects', 'Most subjects that count');
    calc.add(`${String(leftOut)} more left out: only the ${String(most)} best known count`, 0);
  }
  for (const ref of inputs.skipped ?? []) {
    calc.note(
      `A ${ref.kind === 'promotion' ? 'promotion' : 'person'} in this story no longer exists`,
    );
  }
  calc.clamp(BUZZ_MIN, BUZZ_MAX, 'Kept between 0 and 100');
  return calc.done();
}
