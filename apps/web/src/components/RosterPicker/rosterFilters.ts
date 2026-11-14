import { GENDER_LABELS, GENDERS, PUSH_LABELS, PUSH_LEVELS } from '@ringside/engine';
import type { Gender, PickerStoryline, Push, StorylineId } from '@ringside/engine';

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

/**
 * The Storylines filter (EVT2-13): everyone, anyone in a current storyline, or the members of one
 * storyline (both sides).
 */
export type StorylineChoice =
  | { readonly kind: 'all' }
  | { readonly kind: 'any' }
  | { readonly kind: 'one'; readonly storylineId: StorylineId };

export const EVERY_STORYLINE: StorylineChoice = { kind: 'all' };

/** The longest storyline name the chip shows before it shortens it with an ellipsis. */
const CHIP_NAME_MAX = 24;

/** The storylines chip: "Storylines", "Storyline: any", or "Storyline: <name>". */
export function storylineChipLabel(
  choice: StorylineChoice,
  options: readonly PickerStoryline[],
): string {
  if (choice.kind === 'all') return 'Storylines';
  if (choice.kind === 'any') return 'Storyline: any';
  const name = options.find((option) => option.storylineId === choice.storylineId)?.name;
  if (name === undefined) return 'Storylines';
  const shown = name.length > CHIP_NAME_MAX ? `${name.slice(0, CHIP_NAME_MAX - 1)}…` : name;
  return `Storyline: ${shown}`;
}

/** True when the choice keeps someone in these storylines. */
export function matchesStoryline(
  storylineIds: readonly StorylineId[],
  choice: StorylineChoice,
): boolean {
  if (choice.kind === 'all') return true;
  if (choice.kind === 'any') return storylineIds.length > 0;
  return storylineIds.includes(choice.storylineId);
}

/**
 * The choice that applies: a storyline that is no longer offered (it ended) falls back to
 * everyone, so the list never empties for a filter the menu can't show.
 */
export function effectiveStorylineChoice(
  choice: StorylineChoice,
  options: readonly PickerStoryline[],
): StorylineChoice {
  if (choice.kind !== 'one') return choice;
  return options.some((option) => option.storylineId === choice.storylineId)
    ? choice
    : EVERY_STORYLINE;
}

/** The storylines in the menu: those the segment already links first, then the rest in order. */
export function orderStorylines(
  options: readonly PickerStoryline[],
  linkedIds: readonly StorylineId[],
): readonly PickerStoryline[] {
  const linked = options.filter((option) => linkedIds.includes(option.storylineId));
  const others = options.filter((option) => !linkedIds.includes(option.storylineId));
  return [...linked, ...others];
}
