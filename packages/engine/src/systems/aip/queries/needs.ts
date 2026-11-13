/**
 * `aip.needs`: what a rival desk would say a roster is short of, worked out live with the Why? of
 * every need inline.
 *
 * Needs use only public facts (roster, card positions, alignment, availability, titles, contract
 * end dates), so any viewer may ask about any promotion, their own included ("what a rival desk
 * would say about you"). A computer promotion's needs leave out its human-run brands, as its
 * weekly review does. Design: docs/design/rival-desk.md#promotions-queries.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../../core/api/query';
import type { GameDate } from '../../../core/date';
import type { BrandId, PromotionId } from '../../../core/ids';
import type { TraceNode } from '../../../core/trace';
import type { TemplatedText } from '../../../model/primitives';
import { zId } from '../../../model/primitives';
import {
  needSummaryText,
  rosterNeeds,
  slotsDemanded,
  type NeedKind,
  type NeedRefs,
} from '../formulas/needs';
import { needsInputsFor } from '../inputs';
import { unitOf } from '../units';
import { brandOrRefuse, promotionOrRefuse } from './shared';

export interface AipNeedsArgs {
  promotionId: PromotionId;
  /** One brand's needs; left out or null for the whole promotion. */
  brandId?: BrandId | null | undefined;
}

export interface AipNeedView {
  key: string;
  kind: NeedKind;
  summary: TemplatedText;
  /** The summary in plain English, as the Why? lists it. */
  text: string;
  severity: { value: number; trace: TraceNode };
  refs: NeedRefs;
}

export interface AipNeeds {
  unitName: string;
  slotsDemanded: { value: number; trace: TraceNode };
  /** Most pressing first. */
  needs: AipNeedView[];
  computedOn: GameDate;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'aip.needs': { args: AipNeedsArgs; result: AipNeeds };
  }
}

export const aipNeedsQuery: QueryDefinition<'aip.needs'> = defineQuery('aip.needs', {
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
    const inputs = needsInputsFor(read, tunables, unitOf(read, promotion.id, brandId), date);
    const demanded = slotsDemanded(inputs, { tunables });
    return {
      unitName: inputs.unitName,
      slotsDemanded: { value: demanded.value, trace: demanded.trace },
      needs: rosterNeeds(inputs, { tunables }).map((need) => ({
        key: need.key,
        kind: need.kind,
        summary: need.summary,
        text: needSummaryText(need.summary),
        severity: { value: need.severity.value, trace: need.severity.trace },
        refs: need.refs,
      })),
      computedOn: date,
    };
  },
});
