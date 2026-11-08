/**
 * Starting traits: which personality and work traits a new person holds.
 *
 * Every trait incidence record in the content library (`content/base/generation/traits.json` in the
 * shipped game) is rolled once, in key order, with `chance(min(1, baseChance × roleMultiplier))`,
 * where the multiplier is the record's entry for the person's main role (1 when it has none). A
 * trait whose `minAge` the person has not reached is still rolled, so the stream never shifts, but
 * it cannot be held.
 *
 * Then, for each of the engine's `EXCLUSIVE_TRAIT_PAIRS` in order, if both sides came up, one is
 * kept by a weighted pick over the two chances. Last, if more than `worldgen.traits.maxPerPerson`
 * came up, the least likely extras are dropped (ties: the later one in key order goes first). The
 * result is in `TRAIT_KEYS` order.
 *
 * Draws from the stream, in order: one per record (always), then one per exclusive pair that came
 * up on both sides.
 *
 * Design: docs/design/world-generation.md#traits.
 */

import { ageInYears, type GameDate } from '../../../core/date';
import { GenerationContentError } from '../../../core/errors';
import { rollChance, rollWeighted, type RngStream } from '../../../core/rng';
import { startDecision, traced, type TraceNode, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import {
  EXCLUSIVE_TRAIT_PAIRS,
  TRAIT_KEYS,
  type Person,
  type TraitKey,
} from '../../../model/entities/person';
import type { ContentLibrary } from '../../../persistence/packs/library';
import type { TraitIncidenceRecord } from '../../../persistence/packs/records/generation';
import { createEngineTunables, type EngineTunables } from '../../tunables';
import { formatNumber, ROLE_LABELS } from './labels';

const TRAITS_DOC_REF = 'world-generation.md#traits';

/** "fastLearner" → "Fast learner", for trace labels. */
export function traitLabel(trait: TraitKey): string {
  const words = trait.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The library's trait incidence records in key order. Throws if two name the same trait. */
export function traitRecordsOf(library: ContentLibrary): readonly TraitIncidenceRecord[] {
  const seen = new Map<TraitKey, string>();
  const records: TraitIncidenceRecord[] = [];
  for (const key of Object.keys(library.traitIncidence).sort()) {
    const record = library.traitIncidence[key];
    if (record === undefined) {
      continue;
    }
    const earlier = seen.get(record.traitKey);
    if (earlier !== undefined) {
      throw new GenerationContentError(
        `trait incidence records ${earlier} and ${record.key} are both for ${record.traitKey}`,
        { trait: record.traitKey },
      );
    }
    seen.set(record.traitKey, record.key);
    records.push(record);
  }
  return records;
}

/** The chance a person with `role` as their main role rolls the record's trait. */
export function traitChance(record: TraitIncidenceRecord, role: Person['roles'][number]): number {
  return Math.min(1, record.baseChance * (record.roleMultipliers[role] ?? 1));
}

/** What {@link seedTraits} reads besides the person, stream and library. */
export interface SeedTraitsOptions {
  /** Today in the game; `minAge` is checked against the age on this date. */
  readonly worldDate: GameDate;
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
}

interface Hit {
  readonly trait: TraitKey;
  readonly chance: number;
  /** Position in key order, for tie breaks. */
  readonly order: number;
}

/**
 * Seeds the traits of `person` (main role `person.roles[0]`). Pure: the same person, library,
 * date, tunables and stream state always give the same traits. See the module comment.
 */
export function seedTraits(
  person: Person,
  stream: RngStream,
  library: ContentLibrary,
  options: SeedTraitsOptions,
): Traced<TraitKey[]> {
  const tunables = options.tunables ?? createEngineTunables();
  const role = person.roles[0] ?? 'wrestler';
  const age = ageInYears(person.birthDate, options.worldDate);
  const records = traitRecordsOf(library);

  const rollSteps: TraceNode[] = [];
  const hits = new Map<TraitKey, Hit>();
  records.forEach((record, order) => {
    const chance = traitChance(record, role);
    const label = traitLabel(record.traitKey);
    const roll = rollChance(stream, chance, label);
    const oldEnough = record.minAge === undefined || age >= record.minAge;
    const multiplier = record.roleMultipliers[role] ?? 1;
    rollSteps.push({
      kind: 'roll',
      label: oldEnough
        ? `${label}: ${formatNumber(record.baseChance)} × ${formatNumber(multiplier)} for a ${ROLE_LABELS[role]}`
        : `${label}: too young (needs ${String(record.minAge)}), does not count`,
      value: roll.roll.result,
      roll: roll.roll,
    });
    if (roll.value && oldEnough) {
      hits.set(record.traitKey, { trait: record.traitKey, chance, order });
    }
  });

  const pairSteps: TraceNode[] = [];
  for (const [first, second] of EXCLUSIVE_TRAIT_PAIRS) {
    const firstHit = hits.get(first);
    const secondHit = hits.get(second);
    if (firstHit === undefined || secondHit === undefined) {
      continue;
    }
    const decision = startDecision<TraitKey>(`${traitLabel(first)} or ${traitLabel(second)}`, {
      docRef: TRAITS_DOC_REF,
    });
    decision.consider(first, firstHit.chance, 'Its chance');
    decision.consider(second, secondHit.chance, 'Its chance');
    const picked = rollWeighted(
      stream,
      [
        { item: first, weight: firstHit.chance },
        { item: second, weight: secondHit.chance },
      ],
      `${traitLabel(first)} or ${traitLabel(second)}`,
      traitLabel,
    );
    decision.roll(picked.roll);
    const dropped = picked.value === first ? second : first;
    hits.delete(dropped);
    pairSteps.push(
      decision.choose(picked.value, 'Both came up and cannot be held together; weighted pick')
        .trace,
    );
  }

  const cap = tunables.get('worldgen.traits.maxPerPerson');
  const capSteps: TraceNode[] = [tunableNode(tunables, 'worldgen.traits.maxPerPerson')];
  let kept = [...hits.values()];
  if (kept.length > cap) {
    const ranked = [...kept].sort(
      (left, right) => right.chance - left.chance || left.order - right.order,
    );
    const survivors = ranked.slice(0, cap);
    for (const extra of ranked.slice(cap)) {
      capSteps.push({
        kind: 'note',
        label: `Dropped ${traitLabel(extra.trait)} (chance ${formatNumber(extra.chance)}): more than ${String(cap)} traits`,
        value: null,
      });
    }
    kept = survivors;
  }
  const keptKeys = new Set(kept.map((hit) => hit.trait));
  const traits = TRAIT_KEYS.filter((trait) => keptKeys.has(trait));

  const root: TraceNode = {
    kind: 'input',
    label: 'Traits',
    value: traits.length === 0 ? 'none' : traits.map(traitLabel).join(', '),
    docRef: TRAITS_DOC_REF,
    children: [
      { kind: 'input', label: 'Main role', value: ROLE_LABELS[role] },
      { kind: 'input', label: 'Age', value: age, unit: 'years' },
      {
        kind: 'input',
        label: 'Rolls',
        value: `${String(records.length)} traits`,
        children: rollSteps,
      },
      ...(pairSteps.length === 0
        ? []
        : [
            {
              kind: 'input',
              label: 'Traits that cannot go together',
              value: pairSteps.length,
              children: pairSteps,
            } as const,
          ]),
      { kind: 'input', label: 'Most traits per person', value: cap, children: capSteps },
    ],
  };
  return traced(traits, root);
}
