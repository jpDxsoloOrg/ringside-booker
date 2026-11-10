import { cents, parseGameDate } from '@ringside/engine';
import type { Cents, GameDate } from '@ringside/engine';
import type { TickerItem } from '@/components/Ticker';

/**
 * Sample figures for the shell chrome: the promotion in the sidebar, the status in the top bar and
 * the headlines in the ticker. They let the shell's look be judged before the engine has a
 * promotion's real numbers to give it, and every place that shows them says they are a sample.
 *
 * The day control epic swaps the status for the `sim.status` query, and the news epic swaps the
 * headlines for real ones. Nothing else in the shell reads this file.
 */

/** The promotion block at the top of the sidebar. */
export interface ShellPromotion {
  readonly id: string;
  readonly name: string;
  /** A short form for the crest monogram, such as "LCW". */
  readonly shortName: string;
  /** A small line under the name, such as the promotion's reach. The sample has one. */
  readonly tagline?: string;
}

/** What the top bar's status strip shows. */
export interface ShellStatus {
  readonly date: GameDate;
  /** Week of the season, from 1. */
  readonly week: number;
  /** The season number, or null before the first season starts. */
  readonly season: number | null;
  /** Cash in the bank, or null while the player runs no promotion. */
  readonly cash: Cents | null;
  /** The change in cash over the last week. */
  readonly cashDelta: Cents | null;
  /** Popularity in the home region, 0 to 100, or null while the player runs no promotion. */
  readonly popularity: number | null;
}

export interface ShellPreview {
  readonly promotion: ShellPromotion | null;
  readonly status: ShellStatus;
  /** The ticker's badge, which also says the headlines are a sample. */
  readonly tickerLabel: string;
  readonly headlines: readonly TickerItem[];
}

const SAMPLE_PROMOTION: ShellPromotion = {
  id: 'pro_sample_leaf',
  name: 'Longleaf Championship Wrestling',
  shortName: 'LCW',
  tagline: 'Regional · Southeast',
};

const SAMPLE_DATE = parseGameDate('2031-03-14');

const SAMPLE_HEADLINES: readonly TickerItem[] = [
  {
    id: 'sample-signing',
    tag: 'Signing',
    tagTone: 'prestige',
    content: 'Talia Voss signs a two-year extension',
  },
  {
    id: 'sample-rival',
    tag: 'Rival',
    tagTone: 'action',
    content: 'Rival Saturday show draws its best crowd in a year',
  },
  { id: 'sample-injury', content: 'Kai Sorensen out three weeks with a sprained knee' },
  {
    id: 'sample-title',
    tag: 'Title',
    tagTone: 'data',
    content: 'Heavyweight title defence set for Saturday night',
  },
];

/**
 * The sample chrome for the viewer's seat. A player with no promotion gets no promotion block and
 * no cash or popularity, as the real status will.
 */
export function shellPreview({ hasPromotion }: { readonly hasPromotion: boolean }): ShellPreview {
  return {
    promotion: hasPromotion ? SAMPLE_PROMOTION : null,
    status: {
      date: SAMPLE_DATE,
      week: 11,
      season: 2,
      cash: hasPromotion ? cents(124_000_000) : null,
      cashDelta: hasPromotion ? cents(4_850_000) : null,
      popularity: hasPromotion ? 82 : null,
    },
    tickerLabel: 'Sample news',
    headlines: SAMPLE_HEADLINES,
  };
}
