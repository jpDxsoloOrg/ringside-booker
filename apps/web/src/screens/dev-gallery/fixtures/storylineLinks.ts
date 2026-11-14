import { parseId } from '@ringside/engine';
import type { PersonId, StorylineId } from '@ringside/engine';
import type {
  LinkedStorylineView,
  StorylineLinkPickerProps,
  StorylineOptionView,
  SuggestedStorylineView,
} from '@/components/StorylineLinkPicker';

/**
 * `StorylineLinkPicker` states as `storylines.linkOptions` gives them, for the gallery entry and
 * the component's tests (CRTV4-04). Gallery data only: fictional names, fixed numbers.
 */

function storylineId(number: number): StorylineId {
  return parseId('storyline', `sty_${String(number).padStart(10, '0')}`);
}

function people(count: number): PersonId[] {
  return Array.from({ length: count }, (_unused, index) =>
    parseId('person', `per_${String(index + 1).padStart(10, '0')}`),
  );
}

export const GALLERY_LINK_HOT_FROM = 70;

export const galleryAshfall: SuggestedStorylineView = {
  storylineId: storylineId(1),
  name: 'Gallery Ashfall Rivalry',
  heat: 54,
  membersHere: people(2),
};

export const galleryHarbour: SuggestedStorylineView = {
  storylineId: storylineId(2),
  name: 'Gallery Harbour Grudge',
  heat: 48,
  membersHere: people(1),
};

export const galleryOther: StorylineOptionView = {
  storylineId: storylineId(3),
  name: 'Gallery Quiet Feud',
  heat: 22,
};

/** A linked hot storyline (heat 82) with both its people in the segment. */
export const galleryHotLinked: LinkedStorylineView = {
  storylineId: storylineId(4),
  name: 'Gallery Crown Chase',
  heat: 82,
  active: true,
  membersHere: people(2),
  isFinale: false,
  finaleElsewhere: null,
};

/** The hot storyline again, with its finale booked on another show. */
export const galleryFinaleElsewhereLinked: LinkedStorylineView = {
  ...galleryHotLinked,
  finaleElsewhere: {
    segmentId: parseId('segment', 'seg_0000000901'),
    eventInstanceId: parseId('eventInstance', 'evi_0000000901'),
    showName: 'Gallery Spring Spectacular',
    slot: 'Slot 6',
  },
};

/** What every state starts from: a match on a card that can still change, two links allowed. */
export const GALLERY_LINK_BASE: Omit<
  StorylineLinkPickerProps,
  'onLink' | 'onUnlink' | 'onSetFinale'
> = {
  linked: [],
  suggestions: [galleryAshfall, galleryHarbour],
  others: [galleryOther],
  maxLinks: 2,
  canSetFinale: true,
  disabledReason: null,
  pending: false,
  hotFrom: GALLERY_LINK_HOT_FROM,
};

export type GalleryLinkState = Omit<
  StorylineLinkPickerProps,
  'onLink' | 'onUnlink' | 'onSetFinale'
>;

/** Every state the gallery shows, in order, with its heading. */
export const GALLERY_LINK_STATES: readonly {
  readonly title: string;
  readonly state: GalleryLinkState;
}[] = [
  { title: 'Two suggestions, nothing linked', state: GALLERY_LINK_BASE },
  {
    title: 'One hot storyline linked, one warm suggestion',
    state: { ...GALLERY_LINK_BASE, linked: [galleryHotLinked], suggestions: [galleryHarbour] },
  },
  {
    title: 'Finale on',
    state: {
      ...GALLERY_LINK_BASE,
      linked: [{ ...galleryHotLinked, isFinale: true }],
      suggestions: [galleryHarbour],
    },
  },
  {
    title: 'Limit reached',
    state: {
      ...GALLERY_LINK_BASE,
      linked: [
        galleryHotLinked,
        { ...galleryAshfall, active: true, isFinale: false, finaleElsewhere: null },
      ],
      suggestions: [galleryHarbour],
    },
  },
  {
    title: "Won't count: nobody from the story is in the segment",
    state: {
      ...GALLERY_LINK_BASE,
      linked: [
        { ...galleryOther, active: true, membersHere: [], isFinale: false, finaleElsewhere: null },
      ],
      others: [],
    },
  },
  {
    title: 'The show has run: read-only',
    state: {
      ...GALLERY_LINK_BASE,
      linked: [{ ...galleryHotLinked, isFinale: true }],
      suggestions: [],
      others: [],
      canSetFinale: false,
      disabledReason: 'This show has run, so its storyline links can no longer change.',
    },
  },
  {
    title: 'Talking segment (no Finale switch)',
    state: { ...GALLERY_LINK_BASE, linked: [galleryHotLinked], canSetFinale: false },
  },
  {
    title: 'No active storylines',
    state: { ...GALLERY_LINK_BASE, suggestions: [], others: [] },
  },
  {
    title: 'Finale elsewhere',
    state: {
      ...GALLERY_LINK_BASE,
      linked: [galleryFinaleElsewhereLinked],
      suggestions: [],
    },
  },
];
