import { parseGameDate, parseId } from '@ringside/engine';
import type {
  Alignment,
  StorylineMemberOption,
  StorylineMemberView,
  StorylineRow,
  StorylineSide,
} from '@ringside/engine';

/**
 * Storyline rows and member options as `storylines.list` and `storylines.memberOptions` give them,
 * for the storyline gallery entries and the card's tests. Gallery data only: fictional names,
 * fixed numbers.
 */

const PROMOTION = parseId('promotion', 'pro_0000000001');
const RIVAL = parseId('promotion', 'pro_0000000002');
const BRAND = parseId('brand', 'brd_0000000001');

function personId(number: number) {
  return parseId('person', `per_${String(number).padStart(10, '0')}`);
}

function member(
  number: number,
  name: string,
  side: StorylineSide,
  options: { readonly alignment?: Alignment | null; readonly stillEmployed?: boolean } = {},
): StorylineMemberView {
  const stillEmployed = options.stillEmployed ?? true;
  return {
    personId: personId(number),
    name,
    side,
    alignment: stillEmployed
      ? (options.alignment ?? (side === 'neutral' ? 'tweener' : side))
      : null,
    gender: 'male',
    imageRef: null,
    stillEmployed,
  };
}

const BASE_ROW: StorylineRow = {
  id: parseId('storyline', 'sty_0000000001'),
  promotionId: PROMOTION,
  promotionName: 'Gallery Wrestling',
  brandId: BRAND,
  brandName: 'Gallery Mainstage',
  name: 'Gallery Feud',
  status: 'active',
  startedOn: parseGameDate('2027-01-04'),
  endedOn: null,
  heat: 50,
  isHot: false,
  heatTraceRef: null,
  faces: [],
  heels: [],
  neutrals: [],
  linkedSegmentCount: 0,
  lastProgressOn: null,
  daysSinceProgress: 0,
  editable: true,
};

/** A hot storyline with a neutral referee caught in the middle. */
export const galleryHotStoryline: StorylineRow = {
  ...BASE_ROW,
  id: parseId('storyline', 'sty_0000000001'),
  name: 'The Long Road Back to the Gallery Heavyweight Championship',
  heat: 84,
  isHot: true,
  faces: [member(1, 'Gallery Name One', 'face'), member(2, 'Gallery Name Two', 'face')],
  heels: [member(3, 'Gallery Name Three', 'heel')],
  neutrals: [member(4, 'Gallery Referee', 'neutral')],
  linkedSegmentCount: 5,
  lastProgressOn: parseGameDate('2027-02-11'),
  daysSinceProgress: 3,
};

/** A storyline that has gone cold. */
export const galleryColdStoryline: StorylineRow = {
  ...BASE_ROW,
  id: parseId('storyline', 'sty_0000000002'),
  name: 'Gallery Grudge',
  brandId: null,
  brandName: null,
  heat: 12,
  faces: [member(5, 'Gallery Name Five', 'face')],
  heels: [member(6, 'Gallery Name Six', 'heel')],
  linkedSegmentCount: 1,
  daysSinceProgress: 26,
};

/** A storyline whose heel has left the promotion. */
export const galleryLeftStoryline: StorylineRow = {
  ...BASE_ROW,
  id: parseId('storyline', 'sty_0000000003'),
  name: 'Gallery Walkout',
  heat: 41,
  faces: [member(7, 'Gallery Name Seven', 'face')],
  heels: [member(8, 'Gallery Name Eight', 'heel', { stillEmployed: false })],
  linkedSegmentCount: 2,
  daysSinceProgress: 9,
};

/** An ended storyline. */
export const galleryEndedStoryline: StorylineRow = {
  ...BASE_ROW,
  id: parseId('storyline', 'sty_0000000004'),
  name: 'Gallery Finished Feud',
  status: 'ended',
  endedOn: parseGameDate('2027-03-01'),
  heat: 66,
  faces: [member(9, 'Gallery Name Nine', 'face')],
  heels: [member(10, 'Gallery Name Ten', 'heel')],
  linkedSegmentCount: 4,
  daysSinceProgress: null,
  editable: false,
};

/** A rival's storyline: the public row, with no heat, count or progress. */
export const galleryRivalStoryline: StorylineRow = {
  ...BASE_ROW,
  id: parseId('storyline', 'sty_0000000005'),
  promotionId: RIVAL,
  promotionName: 'Gallery Rival Wrestling',
  brandId: null,
  brandName: null,
  name: 'Gallery Rival Feud',
  heat: null,
  isHot: null,
  faces: [member(11, 'Gallery Rival One', 'face')],
  heels: [member(12, 'Gallery Rival Two', 'heel')],
  linkedSegmentCount: null,
  daysSinceProgress: null,
  editable: false,
};

/** Every sample card, in the order the gallery shows them. */
export const galleryStorylineRows: readonly StorylineRow[] = [
  galleryHotStoryline,
  galleryColdStoryline,
  galleryLeftStoryline,
  galleryEndedStoryline,
  galleryRivalStoryline,
];

/** `storylines.heat.hotFrom`'s default. */
export const GALLERY_HOT_FROM = 70;

function option(
  number: number,
  name: string,
  alignment: Alignment,
  fields: Partial<StorylineMemberOption> = {},
): StorylineMemberOption {
  return {
    personId: personId(number),
    name,
    role: 'wrestler',
    alignment,
    push: 'midCard',
    gender: 'male',
    imageRef: null,
    activeStorylineCount: 0,
    ...fields,
  };
}

/** People a gallery storyline may pick from, as `storylines.memberOptions` lists them. */
export const galleryMemberOptions: readonly StorylineMemberOption[] = [
  option(1, 'Gallery Name One', 'face', { push: 'mainEvent', activeStorylineCount: 2 }),
  option(3, 'Gallery Name Three', 'heel', { push: 'mainEvent', activeStorylineCount: 1 }),
  option(5, 'Gallery Name Five', 'face'),
  option(6, 'Gallery Name Six', 'heel'),
  option(13, 'Gallery Name Thirteen', 'tweener', { push: 'lowerCard' }),
  option(14, 'Gallery Manager', 'heel', { role: 'manager', push: 'none' }),
];
