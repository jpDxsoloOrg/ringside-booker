/**
 * Title eligibility: may this person hold this title, and if not, every reason why not.
 *
 * Design: docs/design/workers.md#title-eligibility.
 */

import type { Reason } from '../../../core/api/result';
import { WRESTLING_ROLES, type Person } from '../../../model/entities/person';
import type { Title } from '../../../model/entities/title';

export const TITLE_ELIGIBILITY_CODES = [
  'titleRetired',
  'notAWrestler',
  'divisionGender',
  'belowMinWeight',
  'aboveMaxWeight',
] as const;
export type TitleEligibilityCode = (typeof TITLE_ELIGIBILITY_CODES)[number];

/** Titles are usually named "... Championship" or "... Title"; add "title" only when it is neither. */
function titleText(title: Pick<Title, 'name'>): string {
  return /\b(title|championship|cup|crown|trophy)\b/i.test(title.name)
    ? `the ${title.name}`
    : `the ${title.name} title`;
}

function formatKg(weightKg: number): string {
  return `${String(weightKg)} kg`;
}

/**
 * Every rule that stops `person` from holding `title`, in a fixed order; an empty list means they
 * are eligible. Messages are written for the player.
 *
 * - `titleRetired`: the title is no longer defended.
 * - `notAWrestler`: the person holds no wrestling role.
 * - `divisionGender`: the title is for a men's or women's division and the person's gender is not
 *   that one. Non-binary people are eligible for open divisions only.
 * - `belowMinWeight` / `aboveMaxWeight`: outside the division's weight limits. Both limits are
 *   inclusive and a null limit is no limit.
 */
export function isEligibleForTitle(
  person: Pick<Person, 'id' | 'roles' | 'gender' | 'weightKg'>,
  title: Pick<Title, 'name' | 'status' | 'division'>,
): Reason[] {
  const reasons: Reason[] = [];
  const name = titleText(title);
  const refuse = (code: TitleEligibilityCode, message: string): void => {
    reasons.push({ code, message, subject: { kind: 'person', id: person.id } });
  };

  if (title.status === 'retired') {
    refuse('titleRetired', `${name.charAt(0).toUpperCase()}${name.slice(1)} has been retired`);
  }

  const wrestles = person.roles.some((role) =>
    WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role),
  );
  if (!wrestles) {
    refuse('notAWrestler', `Only wrestlers can hold ${name}`);
  }

  const { gender, minWeightKg, maxWeightKg } = title.division;
  if (gender !== 'open' && person.gender !== gender) {
    const division = gender === 'male' ? "men's" : "women's";
    refuse(
      'divisionGender',
      `${name.charAt(0).toUpperCase()}${name.slice(1)} is a ${division} title`,
    );
  }

  if (minWeightKg !== null && person.weightKg < minWeightKg) {
    refuse(
      'belowMinWeight',
      `Too light for ${name} (needs at least ${formatKg(minWeightKg)}, weighs ${formatKg(person.weightKg)})`,
    );
  }
  if (maxWeightKg !== null && person.weightKg > maxWeightKg) {
    refuse(
      'aboveMaxWeight',
      `Too heavy for ${name} (limit ${formatKg(maxWeightKg)}, weighs ${formatKg(person.weightKg)})`,
    );
  }
  return reasons;
}
