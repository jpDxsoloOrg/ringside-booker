/**
 * Angle templates (MTCH5): ready-made angles the Match lab offers as a starting point and rival
 * bookers (AIP4) build from.
 *
 * - `fitTemplate` trims a template to the beats a slot can hold, dropping optional beats from the
 *   front first. Beats have no length (D-10): the slot's duration class decides how many fit
 *   (MTCH5-03).
 * - `angleTemplatesFor` lists the templates that fit, optionally for one purpose.
 * - `castTemplate` fills each beat's groups with people: side `a`, side `b`, both (`ab`) or the
 *   host.
 *
 * Design: docs/design/angle-rating.md, "Angle templates".
 */

import type { PersonId } from '../../../core/ids';
import {
  angleTemplatesOf,
  type AngleTemplateBeat,
  type AngleTemplateDef,
  type AngleTemplatePurpose,
  type CastToken,
  type CatalogReader,
} from '../../../model/catalogs';
import type { ContentKey } from '../../../core/content-key';

/** A template trimmed to fit: the beats kept, in order, and the optional beats dropped. */
export interface FittedTemplate {
  readonly beats: readonly AngleTemplateBeat[];
  readonly dropped: readonly AngleTemplateBeat[];
}

/**
 * The template's beats trimmed to at most `maxBeats`: optional beats are dropped from the front
 * until the rest fit. Null when the required beats alone are more than `maxBeats`.
 */
export function fitTemplate(
  template: Pick<AngleTemplateDef, 'beats'>,
  maxBeats: number,
): FittedTemplate | null {
  const required = template.beats.filter((beat) => !beat.optional).length;
  if (required > maxBeats) {
    return null;
  }
  let toDrop = Math.max(0, template.beats.length - maxBeats);
  const beats: AngleTemplateBeat[] = [];
  const dropped: AngleTemplateBeat[] = [];
  for (const beat of template.beats) {
    if (beat.optional && toDrop > 0) {
      dropped.push(beat);
      toDrop -= 1;
    } else {
      beats.push(beat);
    }
  }
  return { beats, dropped };
}

/** `angleTemplatesFor` options. */
export interface AngleTemplateFilter {
  /** Only templates with this purpose. Left out = every purpose. */
  readonly purpose?: AngleTemplatePurpose | undefined;
  /** The most beats the slot can hold. */
  readonly maxBeats: number;
}

/** A template that fits, with its trimmed beats. */
export interface TemplateFit extends FittedTemplate {
  readonly template: AngleTemplateDef;
}

/** The world's templates that fit in `maxBeats` (and match `purpose`), by key. */
export function angleTemplatesFor(
  read: CatalogReader,
  filter: AngleTemplateFilter,
): TemplateFit[] {
  return angleTemplatesOf(read).flatMap((template) => {
    if (filter.purpose !== undefined && template.purpose !== filter.purpose) {
      return [];
    }
    const fitted = fitTemplate(template, filter.maxBeats);
    return fitted === null ? [] : [{ template, ...fitted }];
  });
}

/** Who plays each cast token. */
export interface TemplateCast {
  readonly a: readonly PersonId[];
  readonly b: readonly PersonId[];
  readonly host: PersonId | null;
}

/** A beat with its people split into its groups. Group two is empty for a one-group beat. */
export interface GroupedBeat {
  readonly beatKey: ContentKey;
  readonly groupOne: readonly PersonId[];
  readonly groupTwo: readonly PersonId[];
}

function peopleOf(token: CastToken, cast: TemplateCast): PersonId[] {
  switch (token) {
    case 'a':
      return [...cast.a];
    case 'b':
      return [...cast.b];
    case 'ab':
      return [...cast.a, ...cast.b];
    case 'host':
      return cast.host === null ? [] : [cast.host];
  }
}

/**
 * The template's beats with people in their groups. A beat whose first group would be empty (a
 * host-only group with no host, or an empty side) is dropped; an empty second group is left
 * empty, which is fine when that group is optional (the lab warns otherwise, MTCH5-03).
 */
export function castTemplate(
  template: Pick<AngleTemplateDef, 'beats'>,
  cast: TemplateCast,
): GroupedBeat[] {
  return template.beats.flatMap((beat) => {
    const groupOne = peopleOf(beat.groupOne, cast);
    if (groupOne.length === 0) {
      return [];
    }
    const groupTwo = beat.groupTwo === null ? [] : peopleOf(beat.groupTwo, cast);
    return [{ beatKey: beat.beatKey, groupOne, groupTwo }];
  });
}
