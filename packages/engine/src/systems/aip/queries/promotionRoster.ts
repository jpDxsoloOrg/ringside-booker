/**
 * `promotions.roster`: every worker under contract with a promotion (or one of its brands), each
 * with the card value that promotion puts on them and its Why?, plus the taste it values them by.
 *
 * Any viewer may read any promotion's roster here, so a row carries only public facts: no contract
 * terms, no morale and no hidden development or potential. (The player's own contracts and morale
 * are on the Roster screen, `roster.rows`.) Card value is worked out on read and its trace travels
 * inline, like WRK1's roll-ups. Design: docs/design/rival-desk.md#promotions-queries.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import type { GameDate } from '../../../core/date';
import type { BrandId, EmploymentId, PersonId, PromotionId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import type {
  Alignment,
  Employment,
  EmploymentRole,
  Push,
} from '../../../model/entities/employment';
import type { Gender, Person } from '../../../model/entities/person';
import { compareIds } from '../../../model/table';
import { zId } from '../../../model/primitives';
import type { DeepReadonly } from '../../../model/world';
import { pushIndexOf, ROSTER_ROLE_GROUPS, rosterRoleGroupOf } from '../../roster/roleGroups';
import { geographyOf } from '../../world/geography';
import { overallOf } from '../../workers/formulas/roleRating';
import { availabilityOf, type Availability } from '../../workers/helpers/availability';
import { cardValue } from '../formulas/cardValue';
import type { TracedTaste } from '../formulas/defaultTaste';
import { cardValueInputsFor, deciderBrandOf, openReignOf, unitRoster, unitTitles } from '../inputs';
import { TASTE_AXES, TASTE_AXIS_LABELS, tasteOf, type TasteAxis } from '../taste';
import { brandOrRefuse, promotionOrRefuse } from './shared';

export interface PromotionRosterArgs {
  promotionId: PromotionId;
  /** One brand's contracts; left out or null for the whole promotion. */
  brandId?: BrandId | null | undefined;
}

/** One contract on a promotion's public roster. Never terms, morale, development or potential. */
export interface PromotionRosterRow {
  employmentId: EmploymentId;
  personId: PersonId;
  ringName: string;
  imageRef: Person['imageRef'];
  gender: Gender;
  role: EmploymentRole;
  push: Push;
  alignment: Alignment;
  brandId: BrandId | null;
  availability: Availability;
  /** Their rating in the contracted role, to 1 decimal. */
  overall: { role: EmploymentRole; value: number };
  /** What the promotion makes of them, 0-100 (wrestlers and managers; null for crew). */
  cardValue: { value: number; trace: TraceNode } | null;
  /** True when they hold one of the promotion's titles. */
  isChampion: boolean;
  /** The last day of the contract, or null when it is open-ended. */
  endsOn: GameDate | null;
}

export interface PromotionRosterTasteAxis {
  axis: TasteAxis;
  label: string;
  value: number;
  trace: TraceNode;
}

export interface PromotionRoster {
  /** The taste card values are weighed by: "Style taste: Hard-hitting" or "Booker taste". */
  taste: { label: string; source: TracedTaste['source']; axes: PromotionRosterTasteAxis[] };
  /** By role, then card position, then card value (highest first). */
  rows: PromotionRosterRow[];
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'promotions.roster': { args: PromotionRosterArgs; result: PromotionRoster };
  }
}

/** Roles that get a card value: the ones who appear on a card. */
function hasCardValue(role: EmploymentRole): boolean {
  return role === 'wrestler' || role === 'manager';
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function compareRows(left: PromotionRosterRow, right: PromotionRosterRow): number {
  return (
    ROSTER_ROLE_GROUPS.indexOf(rosterRoleGroupOf(left.role)) -
      ROSTER_ROLE_GROUPS.indexOf(rosterRoleGroupOf(right.role)) ||
    pushIndexOf(left.push) - pushIndexOf(right.push) ||
    (right.cardValue?.value ?? -1) - (left.cardValue?.value ?? -1) ||
    left.ringName.localeCompare(right.ringName, 'en', { numeric: true }) ||
    compareIds(left.employmentId, right.employmentId)
  );
}

function tasteView(taste: TracedTaste): PromotionRoster['taste'] {
  return {
    label: taste.label,
    source: taste.source,
    axes: TASTE_AXES.map((axis) => ({
      axis,
      label: TASTE_AXIS_LABELS[axis],
      value: taste.values[axis],
      trace: taste.traces[axis],
    })),
  };
}

export const promotionRosterQuery: QueryDefinition<'promotions.roster'> = defineQuery(
  'promotions.roster',
  {
    args: z.strictObject({
      promotionId: zId('promotion'),
      brandId: zId('brand').nullable().optional(),
    }),
    run: (ctx, args) => {
      const { read, date, tunables } = ctx;
      const promotion = promotionOrRefuse(read, args.promotionId);
      const brandId = args.brandId ?? null;
      if (brandId !== null) {
        brandOrRefuse(read, promotion.id, brandId);
      }
      const unit = { promotionId: promotion.id, brandId, excludedBrandIds: [] };
      const regions = geographyOf(read).regions;
      const tastes = new Map<BrandId | null, TracedTaste>();
      const tasteFor = (employment: DeepReadonly<Employment>): TracedTaste => {
        const decider = deciderBrandOf(read, employment);
        let taste = tastes.get(decider);
        if (taste === undefined) {
          taste = tasteOf(read, tunables, promotion.id, decider);
          tastes.set(decider, taste);
        }
        return taste;
      };
      const champions = new Set<PersonId>();
      for (const title of unitTitles(read, { ...unit, brandId: null })) {
        for (const personId of openReignOf(read, title.id)?.holderIds ?? []) {
          champions.add(personId);
        }
      }

      const rows = unitRoster(read, unit, date).map((employment): PromotionRosterRow => {
        const person = read.tables.people.require(employment.personId);
        const valued = hasCardValue(employment.role)
          ? cardValue(
              cardValueInputsFor(read, tunables, employment, date, {
                regions,
                taste: tasteFor(employment),
              }),
              { tunables },
            )
          : null;
        return {
          employmentId: employment.id,
          personId: person.id,
          ringName: employment.ringName,
          imageRef: person.imageRef,
          gender: person.gender,
          role: employment.role,
          push: employment.push,
          alignment: employment.alignment,
          brandId: employment.brandId,
          availability: availabilityOf(person, employment, date),
          overall: {
            role: employment.role,
            value: oneDecimal(overallOf(person, employment.role, { tunables }).value),
          },
          cardValue: valued === null ? null : { value: valued.value, trace: valued.trace },
          isChampion: champions.has(person.id),
          endsOn: employment.endsOn,
        };
      });

      return {
        taste: tasteView(tasteOf(read, tunables, promotion.id, brandId)),
        rows: rows.sort(compareRows),
      };
    },
  },
);
