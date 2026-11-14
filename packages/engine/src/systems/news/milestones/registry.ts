/**
 * The milestone source registry (DAY1-02): where the weekly `news.milestones` phase gets its
 * stories from.
 *
 * A source looks at the world and lists the milestones that fell on a day inside the window (the
 * week up to the phase's Monday, never before the game's start). The phase collects every source
 * in registration order, sorts, caps and posts. Later features (DAY5 records, CRTV2 prestige
 * bands) add a source here without editing the phase.
 *
 * A module-level registry, like the setup steps: register once when the module loads. A source
 * reads only its arguments, draws no random numbers and lists its candidates in a fixed order.
 * Design: docs/design/news.md#milestones.
 */

import type { GameDate } from '../../../core/date';
import { RegistryError } from '../../../core/errors';
import type { MessageRefs } from '../../../model/entities/mail';
import type { NewsImportance, NewsKind } from '../../../model/entities/news';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import type { NewsParams } from '../post';

/** The days a source looks at, both ends included. */
export interface MilestoneWindow {
  readonly from: GameDate;
  readonly to: GameDate;
}

/** What a source may read besides the world. */
export interface MilestoneDeps {
  readonly tunables: EngineTunables;
}

/** One story a source would like posted. */
export interface MilestoneCandidate {
  /** The day the milestone fell on, inside the window. The body names it; the story is dated the Monday. */
  readonly onDate: GameDate;
  /** A registered news topic. */
  readonly topic: string;
  readonly kind: NewsKind;
  readonly importance: NewsImportance;
  /** Parameters of the headline. The body gets these too. */
  readonly params: NewsParams;
  /** Extra parameters of the body only; the phase adds `onDate`. */
  readonly bodyParams: NewsParams;
  readonly refs: Partial<MessageRefs>;
  /** The "only once" key, so a rerun week or a story posted elsewhere is never repeated. */
  readonly dedupeKey: string;
}

/** What a feature registers to add milestone stories. */
export interface MilestoneSource {
  /** One camelCase word, unique among sources, such as `reigns`. */
  readonly id: string;
  readonly collect: (
    read: GameWorldView,
    window: MilestoneWindow,
    deps: MilestoneDeps,
  ) => MilestoneCandidate[];
}

const SOURCE_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

const sources = new Map<string, MilestoneSource>();

/**
 * Adds a milestone source. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for an id that is not one camelCase word or is already registered.
 */
export function registerMilestoneSource(source: MilestoneSource): () => void {
  if (!SOURCE_ID_PATTERN.test(source.id)) {
    throw new RegistryError(
      `Milestone source ${JSON.stringify(source.id)} must be one camelCase word, such as "reigns"`,
      { source: source.id },
    );
  }
  if (sources.has(source.id)) {
    throw new RegistryError(`Milestone source "${source.id}" is already registered`, {
      source: source.id,
    });
  }
  const stored: MilestoneSource = { ...source };
  sources.set(source.id, stored);
  return () => {
    if (sources.get(source.id) === stored) {
      sources.delete(source.id);
    }
  };
}

/** Every registered source, in registration order. */
export function milestoneSources(): MilestoneSource[] {
  return [...sources.values()];
}
