/**
 * A rival's answer to a release request in its Decision log (ECO4-05, wiring AIP1).
 *
 * A rival answers its worker's request at once by its keep rule (`aiReleaseDecision`). The answer
 * is written as one rival decision through AIP1's `writeAiDecision` (its non-job API, the one
 * setup steps use), so the rival's profile shows "Let <name> go at their request" or "Refused to
 * let <name> go", with the rule's reason and the stored `contracts.aiRelease` Why?.
 *
 * Rival requests stay private (contracts.md#rival-rules): a grant shows the next day, as the
 * worker leaves anyway, but a refusal is revealed to other promotions only when the contract
 * ends (a year on for an open-ended one). The rival itself and the all-seeing viewer see both at
 * once.
 *
 * This file is a leaf: AIP1's `decisionSummaryText` imports the text helper from here.
 *
 * Design: docs/design/contracts.md#rival-rules.
 */

import { parseContentKey } from '../../core/content-key';
import { addDays, type GameDate } from '../../core/date';
import type { EmploymentId, PersonId, TitleId } from '../../core/ids';
import type { TemplatedText } from '../../model/primitives';
import { registerDecisionKind } from '../aip/decisionKinds';

/** The decision kind, with the Decision log chip "Releases". */
export const RELEASE_DECISION_KIND = 'release';
export const RELEASE_DECISION_CHIP = 'Releases';

/** Summary keys: params `name` (ring name) and `reason` (the keep rule's reason). */
export const RELEASE_GRANTED_SUMMARY_KEY = 'contracts.decision.release-granted';
export const RELEASE_REFUSED_SUMMARY_KEY = 'contracts.decision.release-refused';

/** What the Decision log row says, before it is written. */
export interface ReleaseDecisionEntry {
  readonly summary: TemplatedText;
  readonly refs: {
    readonly personIds: PersonId[];
    readonly employmentIds: EmploymentId[];
    readonly titleIds: TitleId[];
  };
  /** 1 for a refusal (a kept worker who wanted out), 0 for a grant. */
  readonly importance: number;
}

/** The row for a rival's answer: granted or refused, why, and who it was about. */
export function releaseDecisionEntry(args: {
  readonly answer: 'grant' | 'refuse';
  readonly ringName: string;
  readonly reason: string;
  readonly personId: PersonId;
  readonly employmentId: EmploymentId;
  readonly titleIds: readonly TitleId[];
}): ReleaseDecisionEntry {
  const key = args.answer === 'grant' ? RELEASE_GRANTED_SUMMARY_KEY : RELEASE_REFUSED_SUMMARY_KEY;
  return {
    summary: {
      key: parseContentKey(key),
      params: { name: args.ringName, reason: args.reason },
    },
    refs: {
      personIds: [args.personId],
      employmentIds: [args.employmentId],
      titleIds: [...args.titleIds],
    },
    importance: args.answer === 'grant' ? 0 : 1,
  };
}

/** How long an open-ended contract's refusal stays hidden. */
export const OPEN_ENDED_REFUSAL_HIDDEN_DAYS = 365;

/** When other promotions may see the answer: today for a grant, the contract's end for a refusal. */
export function releaseDecisionRevealOn(
  answer: 'grant' | 'refuse',
  endsOn: GameDate | null,
  today: GameDate,
): GameDate {
  if (answer === 'grant') {
    return today;
  }
  return endsOn ?? addDays(today, OPEN_ENDED_REFUSAL_HIDDEN_DAYS);
}

/**
 * "Let Kai Rivers go at their request (Lets unhappy workers go)" or "Refused to let Kai Rivers go
 * (Champions are always kept)"; null for any other key. The web text catalog
 * (`apps/web/src/text/catalogs/contracts.ts`) renders the same keys.
 */
export function releaseDecisionText(summary: TemplatedText): string | null {
  const name = String(summary.params['name'] ?? '');
  const reason = String(summary.params['reason'] ?? '');
  switch (summary.key) {
    case RELEASE_GRANTED_SUMMARY_KEY:
      return `Let ${name} go at their request (${reason})`;
    case RELEASE_REFUSED_SUMMARY_KEY:
      return `Refused to let ${name} go (${reason})`;
    default:
      return null;
  }
}

registerDecisionKind({ kind: RELEASE_DECISION_KIND, chip: RELEASE_DECISION_CHIP });
