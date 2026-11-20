/**
 * The world changes a draft start and the active-promotions choice make at new game: contracts
 * taken away, promotions closed, titles vacated or retired, stables disbanded, shows retired.
 *
 * They run inside new-game setup steps, before anyone has worked a day, so a contract taken away
 * is removed (there is no history to keep, no severance and no "released" news) rather than ended.
 *
 * Design: docs/design/draft.md#world-setup.
 */

import { addDays, compareDates, type GameDate } from '../../core/date';
import type { EmploymentId, EventDefinitionId, PromotionId } from '../../core/ids';
import type { Employment } from '../../model/entities/employment';
import type { GameTables } from '../../model/tables';
import type { Tx } from '../../model/tx';
import type { DeepReadonly } from '../../model/world';
import { closeReign } from '../titles/reigns';

type Row = DeepReadonly<Employment>;

/** Statuses of a contract that still ties a person to a promotion. */
export function isLiveEmployment(employment: Pick<Employment, 'status'>): boolean {
  return (
    employment.status === 'offered' ||
    employment.status === 'signed' ||
    employment.status === 'active'
  );
}

/** Removes these employments and every row that points at them. */
export function removeEmployments(tx: Tx<GameTables>, rows: readonly Row[]): number {
  if (rows.length === 0) {
    return 0;
  }
  const ids = new Set<EmploymentId>(rows.map((row) => row.id));
  const read = tx.view;
  for (const concern of [...read.tables.contractConcerns.values()]) {
    if (ids.has(concern.employmentId)) {
      tx.delete('contractConcerns', concern.id);
    }
  }
  for (const negotiation of [...read.tables.negotiations.values()]) {
    if (ids.has(negotiation.employmentId)) {
      tx.delete('negotiations', negotiation.id);
    }
  }
  for (const mail of [...read.tables.mail.values()]) {
    if (mail.refs.employmentId !== null && ids.has(mail.refs.employmentId)) {
      tx.update('mail', mail.id, { refs: { ...mail.refs, employmentId: null } });
    }
  }
  for (const news of [...read.tables.news.values()]) {
    if (news.refs.employmentId !== null && ids.has(news.refs.employmentId)) {
      tx.update('news', news.id, { refs: { ...news.refs, employmentId: null } });
    }
  }
  for (const employment of read.tables.employments.values()) {
    if (employment.managerPersonId !== null && !ids.has(employment.id)) {
      // A manager whose own contract went away no longer manages anyone there.
      const managerRows = rows.filter(
        (row) =>
          row.personId === employment.managerPersonId && row.promotionId === employment.promotionId,
      );
      if (managerRows.length > 0) {
        tx.update('employments', employment.id, { managerPersonId: null });
      }
    }
  }
  for (const id of ids) {
    tx.delete('employments', id);
  }
  return ids.size;
}

/**
 * Ends every current reign of these titles on `date` with `endReason`, through the one reign
 * writer (`closeReign`). A reign that starts after `date` ends on its first day instead.
 */
function closeReignsOf(
  tx: Tx<GameTables>,
  titleIds: ReadonlySet<string>,
  date: GameDate,
  endReason: 'vacated' | 'retired',
): number {
  let closed = 0;
  for (const reign of [...tx.view.tables.titleReigns.values()]) {
    if (reign.lostOn === null && titleIds.has(reign.titleId)) {
      const endsOn = compareDates(reign.wonOn, date) > 0 ? reign.wonOn : date;
      closeReign(
        { date: endsOn, tx, read: tx.view },
        { reignId: reign.id, endReason, endedInSegmentId: null },
      );
      closed += 1;
    }
  }
  return closed;
}

/** Vacates every active title of these promotions: every current reign ends `vacated`. */
export function vacateTitles(
  tx: Tx<GameTables>,
  promotionIds: ReadonlySet<PromotionId>,
  date: GameDate,
): number {
  const titleIds = new Set<string>(
    tx.view.tables.titles
      .values()
      .filter((title) => title.status === 'active' && promotionIds.has(title.promotionId))
      .map((title) => title.id),
  );
  return closeReignsOf(tx, titleIds, date, 'vacated');
}

/** The day before `date`, the last day a retired definition may still run. */
function dayBefore(date: GameDate): GameDate {
  return addDays(date, -1);
}

/** Stops a recurring show from running on or after `date`. */
export function retireDefinitionBefore(
  tx: Tx<GameTables>,
  definitionId: EventDefinitionId,
  date: GameDate,
): void {
  const definition = tx.view.tables.eventDefinitions.require(definitionId);
  const last = dayBefore(date);
  if (definition.activeUntil !== null && compareDates(definition.activeUntil, last) <= 0) {
    return;
  }
  tx.update('eventDefinitions', definition.id, {
    activeUntil: last,
    activeFrom: compareDates(definition.activeFrom, last) > 0 ? last : definition.activeFrom,
  });
}

/** Disbands every active stable of these promotions. */
export function disbandStables(
  tx: Tx<GameTables>,
  promotionIds: ReadonlySet<PromotionId>,
  date: GameDate,
): number {
  let disbanded = 0;
  for (const stable of [...tx.view.tables.stables.values()]) {
    if (stable.status === 'active' && promotionIds.has(stable.promotionId)) {
      tx.update('stables', stable.id, { status: 'disbanded', disbandedOn: date });
      disbanded += 1;
    }
  }
  return disbanded;
}

/**
 * Closes a promotion for good at new game (DRF-06): every contract goes, every title is retired,
 * every show and stable ends, every deal is removed and the status becomes `closed`, which the
 * calendar, the rival desk, finances and contracts already leave alone.
 */
export function closePromotionAtStart(
  tx: Tx<GameTables>,
  promotionId: PromotionId,
  date: GameDate,
): { employments: number; titles: number; shows: number } {
  const read = tx.view;
  const employments = read.tables.employments
    .values()
    .filter((row) => row.promotionId === promotionId && isLiveEmployment(row));
  const removed = removeEmployments(tx, employments);
  const titles = read.tables.titles
    .values()
    .filter((title) => title.promotionId === promotionId && title.status === 'active');
  closeReignsOf(tx, new Set(titles.map((title) => title.id)), date, 'retired');
  for (const title of titles) {
    tx.update('titles', title.id, {
      status: 'retired',
      retiredOn: compareDates(title.introducedOn, date) > 0 ? title.introducedOn : date,
    });
  }
  const definitions = read.tables.eventDefinitions
    .values()
    .filter((definition) => definition.promotionId === promotionId);
  for (const definition of definitions) {
    retireDefinitionBefore(tx, definition.id, date);
  }
  for (const deal of [...read.tables.deals.values()]) {
    if (deal.promotionId === promotionId) {
      tx.delete('deals', deal.id);
    }
  }
  disbandStables(tx, new Set([promotionId]), date);
  tx.update('promotions', promotionId, { status: 'closed' });
  return { employments: removed, titles: titles.length, shows: definitions.length };
}
