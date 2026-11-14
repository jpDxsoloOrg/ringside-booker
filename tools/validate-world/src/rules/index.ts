/**
 * The content rule registry. Each rule lives in its own file and is listed here; the CLI runs
 * whatever this returns, so a new rule is one new file plus one line below.
 */

import type { GameWorldView, MergedContent } from '@ringside/engine';
import type { Blocklist } from '../blocklist';
import { compareValidationIssues, type ValidationIssue } from '../issues';
import { ageSanity } from './ageSanity';
import { createBlocklistRule } from './blocklist';
import { championEligibility } from './championEligibility';
import { employmentDates } from './employmentDates';
import { freeAgents } from './freeAgents';
import { geography } from './geography';
import { injuryCatalog } from './injuryCatalog';
import type { ContentRule } from './helpers';
import { promotionStaffing } from './promotionStaffing';
import { reignChronology } from './reignChronology';
import { angleBeats } from './angleBeats';
import { segmentFinishes } from './segmentFinishes';
import { segmentKeys } from './segmentKeys';
import { uniqueNames } from './uniqueNames';

export type { ContentRule } from './helpers';

/** What rules need besides the world: today, the loaded blocklist. */
export interface RuleSetup {
  readonly blocklist: Blocklist;
}

/** Every content rule, in the order they run. */
export function contentRules(setup: RuleSetup): readonly ContentRule[] {
  return [
    promotionStaffing,
    championEligibility,
    reignChronology,
    employmentDates,
    uniqueNames,
    geography,
    freeAgents,
    ageSanity,
    createBlocklistRule(setup.blocklist),
    segmentKeys,
    segmentFinishes,
    angleBeats,
    injuryCatalog,
  ];
}

/** Runs rules over a loaded world and returns their issues in a stable order. */
export function runRules(
  rules: readonly ContentRule[],
  world: GameWorldView,
  content: MergedContent,
): ValidationIssue[] {
  return rules.flatMap((rule) => rule.check(world, content)).sort(compareValidationIssues);
}
