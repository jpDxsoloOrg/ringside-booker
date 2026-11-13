import { GENDER_LABELS, GENDERS, PUSH_LABELS, PUSH_LEVELS } from '@ringside/engine';
import type { Gender, Push } from '@ringside/engine';

/** The gender filter: everyone, or one gender. */
export type GenderChoice = 'all' | Gender;

/**
 * The gender filter's options, in the model's order. A `Record` over `Gender`, so a gender the
 * model gains later can't be left out of the filter.
 */
const GENDER_GROUP_LABELS: Readonly<Record<Gender, string>> = {
  male: 'Men',
  female: 'Women',
  nonBinary: 'Non-binary',
};

export const GENDER_CHOICES: readonly { readonly value: GenderChoice; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  ...GENDERS.map((gender) => ({ value: gender, label: GENDER_GROUP_LABELS[gender] })),
];

/** Every push, top of the card down, in the words the rest of the game uses. */
export const PUSH_CHOICES: readonly { readonly value: Push; readonly label: string }[] =
  PUSH_LEVELS.map((push) => ({ value: push, label: PUSH_LABELS[push] }));

/** What a team row says about its members' genders: "Women", or "Mixed" when they differ. */
export function teamGenderLabel(genders: readonly Gender[]): string | null {
  const [first] = genders;
  if (first === undefined) return null;
  return genders.every((gender) => gender === first) ? GENDER_GROUP_LABELS[first] : 'Mixed';
}

/** One person's gender in words, the way their profile says it: "Woman". */
export function genderLabel(gender: Gender): string {
  return GENDER_LABELS[gender];
}

/** The gender chip: "Gender", or "Gender: Women" when narrowed. */
export function genderChipLabel(choice: GenderChoice): string {
  const option = GENDER_CHOICES.find((candidate) => candidate.value === choice);
  return choice === 'all' || option === undefined ? 'Gender' : `Gender: ${option.label}`;
}

/** The push chip: "Push", "Push: Main event" for one, "Push: 2 chosen" for more, "Push: none". */
export function pushChipLabel(chosen: ReadonlySet<Push>): string {
  if (chosen.size === PUSH_LEVELS.length) return 'Push';
  if (chosen.size === 0) return 'Push: none';
  if (chosen.size === 1) {
    const [only] = [...chosen];
    return only === undefined ? 'Push' : `Push: ${PUSH_LABELS[only]}`;
  }
  return `Push: ${String(chosen.size)} chosen`;
}

/**
 * A person passes the gender filter when they are that gender. Someone whose gender the screen
 * didn't give only shows under All.
 */
export function personMatchesGender(gender: Gender | undefined, choice: GenderChoice): boolean {
  return choice === 'all' || gender === choice;
}

/** A team passes the gender filter when every member is that gender. */
export function teamMatchesGender(
  genders: readonly Gender[] | undefined,
  choice: GenderChoice,
): boolean {
  if (choice === 'all') return true;
  return (
    genders !== undefined && genders.length > 0 && genders.every((gender) => gender === choice)
  );
}

/** A person passes the push filter when their push is one of those chosen. */
export function personMatchesPush(push: Push | undefined, chosen: ReadonlySet<Push>): boolean {
  if (chosen.size === PUSH_LEVELS.length) return true;
  return push !== undefined && chosen.has(push);
}

/** A team passes the push filter when any member's push is one of those chosen. */
export function teamMatchesPush(
  pushes: readonly Push[] | undefined,
  chosen: ReadonlySet<Push>,
): boolean {
  if (chosen.size === PUSH_LEVELS.length) return true;
  return pushes?.some((push) => chosen.has(push)) ?? false;
}

/** Every push: the push filter's starting state, which narrows nothing. */
export function allPushes(): ReadonlySet<Push> {
  return new Set(PUSH_LEVELS);
}
