/**
 * Starter storylines at new game (CRTV3-02): setup step `storylines.seedStarters`, order 880.
 *
 * Every active promotion gets up to `storylines.starterPerPromotion` storylines, each a face and a
 * heel of the same gender near the top of its card, so the Storylines desk has something to show
 * on a fresh game. Starters exist only in games started after this step was added; rivals do not
 * start more storylines later (that is AIP6).
 *
 * Design: docs/design/storylines.md#starters and docs/design/new-game.md#setup-steps.
 */

import type { BrandId, PersonId } from '../../core/ids';
import type { RngStream } from '../../core/rng/registry';
import { rollPick } from '../../core/rng/rolls';
import { startDecision, type Decision } from '../../core/trace/decision';
import { PUSH_LEVELS, promotionStatusKey, type Employment } from '../../model/entities/employment';
import { GENDERS, type Gender } from '../../model/entities/person';
import type { Promotion } from '../../model/entities/promotion';
import { compareIds } from '../../model/table';
import type { GameTables, GameWorldView } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly } from '../../model/world';
import { registerSetupStep, type SetupContext } from '../newgame/steps';
import { keepsFullStorylineTraces, startStoryline } from './lifecycle';
import { STARTERS_STREAM } from './streams';
import { storylineStarterTraceRef } from './traceKinds';

export const STORYLINES_SEED_STARTERS_STEP = { id: 'storylines.seedStarters', order: 880 } as const;

export const STARTER_SUMMARY = 'A rivalry already simmering when the season began.';
export const STARTER_DOC_REF = 'docs/design/storylines.md#starters';

/** How many of the best-ranked unused faces (and heels) each pick rolls among. */
export const STARTER_PICK_FROM = 3;

/** Longest storyline name the schema allows. */
const MAX_NAME_LENGTH = 80;

/** One wrestler who may start in a starter storyline. */
export interface StarterCandidate {
  readonly personId: PersonId;
  readonly name: string;
  readonly gender: Gender;
  readonly side: 'face' | 'heel';
  readonly brandId: BrandId | null;
  readonly pushRank: number;
  readonly homePopularity: number;
}

const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  male: "Men's",
  female: "Women's",
  nonBinary: 'Non-binary',
};

/** Top of the card first, then better known at home, then id. */
function compareCandidates(left: StarterCandidate, right: StarterCandidate): number {
  return (
    left.pushRank - right.pushRank ||
    right.homePopularity - left.homePopularity ||
    compareIds(left.personId, right.personId)
  );
}

/**
 * The promotion's starter pool, best first: active wrestlers under an active contract, face or
 * heel (tweeners sit out), who are active and not injured. One entry per person (their lowest-id
 * active employment).
 */
export function starterCandidates(
  read: GameWorldView,
  promotion: DeepReadonly<Promotion>,
): StarterCandidate[] {
  const employments = new Map<PersonId, DeepReadonly<Employment>>();
  for (const employment of read.tables.employments.lookup(
    'byPromotionStatus',
    promotionStatusKey(promotion.id, 'active'),
  )) {
    const known = employments.get(employment.personId);
    if (known === undefined || compareIds(employment.id, known.id) < 0) {
      employments.set(employment.personId, employment);
    }
  }
  const candidates: StarterCandidate[] = [];
  for (const employment of employments.values()) {
    if (employment.role !== 'wrestler' || employment.alignment === 'tweener') {
      continue;
    }
    const person = read.tables.people.get(employment.personId);
    if (person?.status !== 'active' || person.injury !== null) {
      continue;
    }
    candidates.push({
      personId: person.id,
      name: employment.ringName,
      gender: person.gender,
      side: employment.alignment,
      brandId: employment.brandId,
      pushRank: PUSH_LEVELS.indexOf(employment.push),
      homePopularity: person.regionalPop[promotion.homeRegionId] ?? 0,
    });
  }
  return candidates.sort(compareCandidates);
}

/** The gender group with the most face–heel pairs left; ties go to the best-ranked worker's. */
function pickGender(unused: readonly StarterCandidate[]): Gender | null {
  let best: { gender: Gender; pairs: number; firstIndex: number } | null = null;
  for (const gender of GENDERS) {
    const group = unused.filter((candidate) => candidate.gender === gender);
    const faces = group.filter((candidate) => candidate.side === 'face').length;
    const heels = group.length - faces;
    const pairs = Math.min(faces, heels);
    if (pairs === 0) continue;
    // `unused` is ranked, so the group's first member's index is its best-ranked worker.
    const firstIndex = unused.findIndex((candidate) => candidate.gender === gender);
    if (
      best === null ||
      pairs > best.pairs ||
      (pairs === best.pairs && firstIndex < best.firstIndex)
    ) {
      best = { gender, pairs, firstIndex };
    }
  }
  return best?.gender ?? null;
}

function describeTop(candidates: readonly StarterCandidate[]): string {
  return candidates.map((candidate, index) => `${String(index + 1)}. ${candidate.name}`).join(', ');
}

function pairCount(unused: readonly StarterCandidate[], gender: Gender): number {
  const group = unused.filter((candidate) => candidate.gender === gender);
  const faces = group.filter((candidate) => candidate.side === 'face').length;
  return Math.min(faces, group.length - faces);
}

/** Picks one side's member among the top unused of that side, recording the roll. */
function pickSide(
  decision: Decision<'pick'>,
  stream: RngStream,
  group: readonly StarterCandidate[],
  side: 'face' | 'heel',
): StarterCandidate {
  const top = group.filter((candidate) => candidate.side === side).slice(0, STARTER_PICK_FROM);
  const label = side === 'face' ? 'Face' : 'Heel';
  decision.note(`Top ${side}s: ${describeTop(top)}`);
  const picked = rollPick(stream, top, `${label} pick`, (candidate) => candidate.name);
  decision.roll(picked.roll);
  return picked.value;
}

function starterName(face: StarterCandidate, heel: StarterCandidate): string {
  const name = `${face.name} vs. ${heel.name}`;
  return name.length <= MAX_NAME_LENGTH ? name : `${name.slice(0, MAX_NAME_LENGTH - 1)}…`;
}

/** Seeds one promotion's starters. Returns how many it created. */
function seedPromotion(
  ctx: SetupContext,
  promotion: DeepReadonly<Promotion>,
  perPromotion: number,
  stream: RngStream,
): number {
  let unused = starterCandidates(ctx.read, promotion);
  let created = 0;
  while (created < perPromotion) {
    const gender = pickGender(unused);
    if (gender === null) {
      ctx.log(
        `${promotion.name}: no face and heel pair left after ${String(created)} starter storyline(s)`,
      );
      break;
    }
    const decision = startDecision<'pick'>('Starter storyline', { docRef: STARTER_DOC_REF });
    for (const each of GENDERS) {
      const pool = unused.filter((candidate) => candidate.gender === each);
      if (pool.length === 0) continue;
      decision.note(
        `${GENDER_LABELS[each]} pool: ${String(pool.length)} wrestler(s), ${String(pairCount(unused, each))} face and heel pair(s)`,
      );
    }
    decision.rule(`${GENDER_LABELS[gender]} pool has the most face and heel pairs`, true);
    const group = unused.filter((candidate) => candidate.gender === gender);
    const face = pickSide(decision, stream, group, 'face');
    const heel = pickSide(decision, stream, group, 'heel');
    const brandId = face.brandId !== null && face.brandId === heel.brandId ? face.brandId : null;
    const storylineId = startStoryline(ctx, {
      promotionId: promotion.id,
      brandId,
      name: starterName(face, heel),
      summary: STARTER_SUMMARY,
      members: [
        { personId: face.personId, side: 'face' },
        { personId: heel.personId, side: 'heel' },
      ],
      source: 'setup',
    });
    ctx.recordTrace(
      storylineStarterTraceRef(storylineId),
      ctx.date,
      decision.choose('pick', `${face.name} (face) and ${heel.name} (heel) start a rivalry`),
      { summaryOnly: !keepsFullStorylineTraces(ctx.read, promotion.id) },
    );
    unused = unused.filter(
      (candidate) => candidate.personId !== face.personId && candidate.personId !== heel.personId,
    );
    created += 1;
  }
  return created;
}

/** The step's `run`: starters for every active promotion, in id order. */
export function seedStarterStorylines(_tx: Tx<GameTables>, ctx: SetupContext): void {
  const perPromotion = ctx.tunables.get('storylines.starterPerPromotion');
  if (perPromotion === 0) {
    ctx.log('Starter storylines turned off');
    return;
  }
  const stream = ctx.rng(STARTERS_STREAM);
  const promotions = ctx.read.tables.promotions
    .values()
    .filter((promotion) => promotion.status === 'active')
    .sort((left, right) => compareIds(left.id, right.id));
  let total = 0;
  for (const promotion of promotions) {
    total += seedPromotion(ctx, promotion, perPromotion, stream);
  }
  ctx.log(
    `Started ${String(total)} starter storyline(s) across ${String(promotions.length)} promotion(s)`,
  );
}

registerSetupStep({ ...STORYLINES_SEED_STARTERS_STEP, run: seedStarterStorylines });
