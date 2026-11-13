import { useCallback } from 'react';
import type { EmploymentId, Push, RosterRow } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { formatNumber } from '@/components/format';

/** What the player reads when the command never reached the engine (the worker died, say). */
export const ENGINE_UNREACHABLE_TEXT = "Couldn't reach the game engine.";

/** One wrestler a push change is for: the contract and the name to announce. */
export type SetPushTarget = Pick<RosterRow, 'employmentId' | 'ringName'>;

/**
 * How a push change ended: applied (every row changed or was already there), or refused with the
 * engine's own words, one per offending row. A refusal changes no row.
 */
export type SetPushOutcome =
  | {
      readonly ok: true;
      readonly changed: readonly EmploymentId[];
      readonly unchanged: readonly EmploymentId[];
    }
  | { readonly ok: false; readonly messages: readonly string[] };

/** "Push updated for Test Name 3", or "Pushes updated for 3 wrestlers". */
export function pushUpdatedText(targets: readonly SetPushTarget[]): string {
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) return `Push updated for ${only.ringName}`;
  return `Pushes updated for ${formatNumber(targets.length)} wrestlers`;
}

export interface SetPushState {
  /**
   * Sends one `roster.setPush` for every target, so a bulk change lands on all of them or on none.
   * Resolves with the outcome, a refusal included; rejects only when the engine could not be
   * reached, with {@link ENGINE_UNREACHABLE_TEXT} as the error's message.
   */
  readonly setPush: (targets: readonly SetPushTarget[], push: Push) => Promise<SetPushOutcome>;
  /** True while a change is on its way. */
  readonly pending: boolean;
}

/**
 * The roster's one edit: move wrestlers to a card position. On success it says so through the
 * polite live region. The table and the profiles refresh by themselves: an applied command moves
 * the world revision on, and every mounted query refetches.
 */
export function useSetPush(): SetPushState {
  const command = useEngineCommand('roster.setPush');
  const announce = useAnnounce();
  const { run } = command;

  const setPush = useCallback(
    async (targets: readonly SetPushTarget[], push: Push): Promise<SetPushOutcome> => {
      let result: Awaited<ReturnType<typeof run>>;
      try {
        result = await run({ employmentIds: targets.map((target) => target.employmentId), push });
      } catch {
        throw new Error(ENGINE_UNREACHABLE_TEXT);
      }
      if (!result.ok) {
        return { ok: false, messages: result.reasons.map((reason) => reason.message) };
      }
      announce(pushUpdatedText(targets));
      return { ok: true, changed: result.data.changed, unchanged: result.data.unchanged };
    },
    [run, announce],
  );

  return { setPush, pending: command.pending };
}
