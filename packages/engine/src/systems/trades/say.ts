/**
 * The wrestler's say (TRD-01): how each worker in a trade feels about moving, and whether a
 * no-trade clause lets them refuse.
 *
 * **How they feel** (points; 0 or more = willing):
 * − `trades.say.uprootCost` (nobody likes being moved), + `trades.say.prestigeWeight` × (the new
 * promotion's prestige − the old one's) (a bigger spot), − `trades.say.moraleWeight` × their morale
 * where they are (unhappy workers want out; settled ones want to stay), + `trades.say.payWeight` ×
 * the pay change as a share of their pay (a raise or a cut in the deal).
 *
 * **Morale on the move**: the feeling × `trades.say.moralePerPoint`, rounded and kept within
 * ± `trades.say.maxMoraleChange`, through the morale door on the new contract. Happy to go = a
 * boost; moved against their wishes = a drop. Nothing here is about winning or losing matches.
 *
 * **No-trade clause.** Contracts have no clause list yet, so the clause is derived, not stored: a
 * contract with creative control has one (`trades.noTrade.creativeControl`), and a share of
 * main-event and upper-card contracts do (`trades.noTrade.chanceMainEvent` / `chanceUpperCard`),
 * picked by a hash of the save's seed and the contract id, so it never changes for a contract.
 * A worker with a clause who is not willing blocks the trade.
 *
 * Design: docs/design/trades.md#wrestlers-say.
 */

import { hashString32 } from '../../core/hash';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import { startCalc, type Traced } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { pointsText } from './value';
import type { TradeWorker } from './workers';

export const SAY_DOC_REF = 'trades.md#wrestlers-say';
export const NO_TRADE_DOC_REF = 'trades.md#no-trade-clause';
const HASH_RANGE = 0x1_0000_0000;

export interface WrestlerSay {
  readonly employmentId: EmploymentId;
  readonly personId: PersonId;
  readonly name: string;
  readonly fromPromotionId: PromotionId;
  readonly toPromotionId: PromotionId;
  /** How they feel about the move, in points: 0 or more = willing. */
  readonly feeling: Traced<number>;
  readonly willing: boolean;
  readonly noTradeClause: boolean;
  /** True when their no-trade clause stops the trade. */
  readonly blocks: boolean;
  /** The morale change the move would give them. */
  readonly moraleChange: number;
  /** One plain line. */
  readonly line: string;
}

/** True when this contract has a no-trade clause (derived; see the module comment). */
export function hasNoTradeClause(
  read: GameWorldView,
  tunables: EngineTunables,
  worker: Pick<TradeWorker, 'employmentId' | 'push' | 'employment'>,
): boolean {
  if (
    tunables.get('trades.noTrade.creativeControl') &&
    worker.employment.terms.perks.creativeControl
  ) {
    return true;
  }
  const chance =
    worker.push === 'mainEvent'
      ? tunables.get('trades.noTrade.chanceMainEvent')
      : worker.push === 'upperCard'
        ? tunables.get('trades.noTrade.chanceUpperCard')
        : 0;
  if (chance <= 0) {
    return false;
  }
  const roll = hashString32(`${read.meta.seed}|noTrade|${worker.employmentId}`) / HASH_RANGE;
  return roll < chance;
}

/** How one worker feels about moving to `toPromotionId` under the deal. */
export function wrestlerSay(
  read: GameWorldView,
  tunables: EngineTunables,
  worker: TradeWorker,
  toPromotionId: PromotionId,
): WrestlerSay {
  const from = read.tables.promotions.get(worker.promotionId);
  const to = read.tables.promotions.get(toPromotionId);
  const toName = to?.name ?? 'the new promotion';
  const calc = startCalc(`How ${worker.name} feels about moving to ${toName}`, 0, {
    unit: 'points',
    docRef: SAY_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  calc.subtract('Being moved at all', calc.tunable(tunables, 'trades.say.uprootCost'));
  const prestigeGap = (to?.prestige ?? 0) - (from?.prestige ?? 0);
  if (prestigeGap !== 0) {
    const weight = tunables.get('trades.say.prestigeWeight');
    calc.add(
      prestigeGap > 0
        ? `A bigger spot: prestige ${pointsText(to?.prestige ?? 0)} against ${pointsText(from?.prestige ?? 0)}`
        : `A smaller spot: prestige ${pointsText(to?.prestige ?? 0)} against ${pointsText(from?.prestige ?? 0)}`,
      prestigeGap * weight,
    );
  }
  const morale = worker.employment.morale;
  if (morale !== 0) {
    const weight = tunables.get('trades.say.moraleWeight');
    calc.add(
      morale < 0
        ? `Unhappy where they are (morale ${pointsText(morale)})`
        : `Settled where they are (morale ${pointsText(morale)})`,
      -morale * weight,
    );
  }
  if (worker.payAfter !== worker.pay) {
    const weight = tunables.get('trades.say.payWeight');
    const change = worker.pay > 0 ? (worker.payAfter - worker.pay) / worker.pay : 1;
    calc.add(
      worker.payAfter > worker.pay ? 'A pay rise in the deal' : 'A pay cut in the deal',
      Math.max(-1, Math.min(1, change)) * weight,
    );
  }
  const feeling = calc.done();
  const willing = feeling.value >= 0;
  const noTradeClause = hasNoTradeClause(read, tunables, worker);
  const blocks = noTradeClause && !willing;
  const max = tunables.get('trades.say.maxMoraleChange');
  const raw = Math.round(feeling.value * tunables.get('trades.say.moralePerPoint'));
  const moraleChange = Math.max(-max, Math.min(max, raw)) || 0;
  let line: string;
  if (blocks) {
    line = `${worker.name} won't go: they have a no-trade clause`;
  } else if (willing) {
    line = `${worker.name} is happy to move to ${toName}`;
  } else {
    line = `${worker.name} doesn't want to move to ${toName}`;
  }
  return {
    employmentId: worker.employmentId,
    personId: worker.personId,
    name: worker.name,
    fromPromotionId: worker.promotionId,
    toPromotionId,
    feeling,
    willing,
    noTradeClause,
    blocks,
    moraleChange,
    line,
  };
}
