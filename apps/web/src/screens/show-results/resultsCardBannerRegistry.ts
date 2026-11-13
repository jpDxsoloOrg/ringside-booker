import { createElement, Fragment } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { EventInstanceId, SegmentResultView } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';

/** What a card banner is drawn from: the show and one of its finished segments. */
export interface ResultsCardBannerProps {
  readonly eventInstanceId: EventInstanceId;
  readonly segment: SegmentResultView;
}

/**
 * A banner another feature adds inside one segment's result card, under the title banner, such as
 * MTCH4's "Injured" banner. It shows only once the card is revealed, so it never gives a result
 * away early.
 */
export interface ResultsCardBannerDefinition {
  /** Unique, prefixed with the feature: `mtch4.injuries`. */
  readonly id: string;
  /** Its place among the card's banners, lowest first; ties in registration order. */
  readonly order: number;
  /**
   * Draws the banner for one card, or null for a card it has nothing to say about. A component,
   * so it may ask the engine with `useEngineQuery`; the query cache answers every card on the page
   * from one request when the arguments are the show's.
   */
  readonly Banner: ComponentType<ResultsCardBannerProps>;
}

const banners = createExtensionRegistry<ResultsCardBannerDefinition>('A results card banner');

/**
 * Adds a banner to every segment result card on the results page, without editing the card or the
 * page. Returns a function that removes it again; throws when the id is taken.
 */
export function registerResultsCardBanner(definition: ResultsCardBannerDefinition): () => void {
  return banners.register(definition);
}

/** Every registered card banner, lowest `order` first. */
export function listResultsCardBanners(): readonly ResultsCardBannerDefinition[] {
  return sortedByOrder(banners.list());
}

/** The registered banners for one card, in order, kept current as features add theirs. */
export function ResultsCardBanners(props: ResultsCardBannerProps): ReactElement | null {
  const definitions = sortedByOrder(banners.useDefinitions());
  if (definitions.length === 0) return null;
  return createElement(
    Fragment,
    null,
    ...definitions.map((definition) =>
      createElement(definition.Banner, { key: definition.id, ...props }),
    ),
  );
}
