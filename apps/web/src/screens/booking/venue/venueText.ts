/**
 * The words the venue panel, the venue picker and the calendar's crowd line share (EVT6-06).
 * Numbers are people, never money or time.
 */
import { optionKeyOf } from '@ringside/engine';
import type {
  VenueChoice,
  VenueKind,
  VenueOption,
  VenueOptionGroup,
  VenueSummary,
} from '@ringside/engine';
import { formatNumber } from '@/components/format';
import type { ImageSubject } from '@/components/ImageSlot';

/** What kind of building a venue is, in a word. */
export const VENUE_KIND_LABELS: Readonly<Record<VenueKind, string>> = {
  hall: 'Hall',
  theatre: 'Theatre',
  arena: 'Arena',
  stadium: 'Stadium',
  studio: 'Studio',
  outdoor: 'Outdoor venue',
};

/** Said while the show has no venue yet. */
export const NOT_CHOSEN_TEXT = 'Not chosen yet';

/** What happens when the player leaves the venue alone. */
export const AUTO_PICK_NOTE =
  'The game books the suggested venue the day before the show unless you choose one.';

/** Said instead of a forecast for a show the player does not run. */
export const NOT_YOUR_SHOW_TEXT = 'Crowd forecasts are only available for your own shows';

/** "Northeast, United States". */
export function placeText(venue: Pick<VenueSummary, 'regionName' | 'countryName'>): string {
  return `${venue.regionName}, ${venue.countryName}`;
}

/** "Capacity 17,500". */
export function capacityText(capacity: number): string {
  return `Capacity ${formatNumber(capacity)}`;
}

/** "15,100 – 17,500", or one number when the range is a single figure. */
export function rangeText(low: number, high: number): string {
  return low === high ? formatNumber(low) : `${formatNumber(low)} – ${formatNumber(high)}`;
}

/** "Expected 15,100 – 17,500". */
export function expectedText(low: number, high: number): string {
  return `Expected ${rangeText(low, high)}`;
}

/** A venue's image slot subject; generic venues carry the venue placeholder as their image. */
export function venueImageSubject(venue: {
  readonly choice: VenueChoice;
  readonly name: string;
  readonly imageRef: string | null;
}): ImageSubject {
  const subject: ImageSubject = { kind: 'venue', id: optionKeyOf(venue.choice), name: venue.name };
  return venue.imageRef === null ? subject : { ...subject, imageRef: venue.imageRef };
}

/** The radio value of a choice: the venue id, or `generic:<size>`. */
export function choiceKey(choice: VenueChoice): string {
  return optionKeyOf(choice);
}

/** The heading of each part of the venue list. */
export function groupHeading(
  group: VenueOptionGroup,
  place: { readonly regionName: string; readonly countryName: string },
): string {
  switch (group) {
    case 'region':
      return `In ${place.regionName}`;
    case 'country':
      return `Elsewhere in ${place.countryName}`;
    case 'abroad':
      return 'Abroad';
    case 'generic':
      return 'Local venues (generic)';
  }
}

/** One option's facts line: "Northeast, United States · Arena · Capacity 17,500". */
export function optionFactsText(option: VenueOption): string {
  return [
    placeText(option),
    VENUE_KIND_LABELS[option.venueKind],
    capacityText(option.capacity),
  ].join(' · ');
}
