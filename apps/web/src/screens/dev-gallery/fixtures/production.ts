import { inputOf, startCalc } from '@ringside/engine';
import type {
  ProductionArea,
  ProductionChangePreview,
  ProductionEffectLine,
  ProductionPreviewRow,
  ProductionRow,
  Traced,
} from '@ringside/engine';

/**
 * Production rows and change previews as `production.overview` and `production.changePreview`
 * might return them, for the gallery's production entries. Gallery data only, all invented and
 * rounded like the engine's defaults; no engine is asked.
 */

/** Price of a per-show area at level 10, in cents. */
const PRICE_AT_10: Readonly<Record<'perShow' | 'monthly', number>> = {
  perShow: 15_000_000,
  monthly: 6_000_000,
};
/** Upgrade fee at level 10, in cents. */
const FEE_AT_10 = 50_000_000;
/** The curve exponent: (level ÷ 10) ^ 3. */
const CURVE = 3;
/** A minor show pays half the regular price. */
const MINOR_MULTIPLIER = 0.5;

function curveAt(level: number): Traced<number> {
  return startCalc(`Curve at ${String(level)}`, inputOf('Level ÷ 10', level / 10), {
    unit: 'ratio',
  })
    .power('Cost curve', CURVE)
    .done();
}

function perShowCost(label: string, level: number): Traced<number> {
  return startCalc(
    `${label} per Hardpan Friday (minor)`,
    inputOf('Price at level 10', PRICE_AT_10.perShow),
    {
      unit: 'money',
    },
  )
    .multiply(`Curve at ${String(level)}`, curveAt(level))
    .multiply('Minor show', MINOR_MULTIPLIER)
    .round('round')
    .done();
}

function monthlyCost(label: string, level: number): Traced<number> {
  return startCalc(`${label} a month`, inputOf('Price at level 10', PRICE_AT_10.monthly), {
    unit: 'money',
  })
    .multiply(`Curve at ${String(level)}`, curveAt(level))
    .round('round')
    .done();
}

function upgradeFee(label: string, from: number, to: number): Traced<number> {
  if (to <= from) {
    return startCalc(`${label} upgrade fee`, inputOf('Lowering is free', 0), {
      unit: 'money',
    }).done();
  }
  const feeAt = (level: number): number => Math.round(FEE_AT_10 * (level / 10) ** CURVE);
  return startCalc(`${label} upgrade fee`, inputOf(`Fee to reach level ${String(to)}`, feeAt(to)), {
    unit: 'money',
  })
    .subtract(`Already paid up to level ${String(from)}`, feeAt(from))
    .done();
}

function showCeiling(stage: number, camera: number, editing: number, pyro: number): Traced<number> {
  return startCalc('Production ceiling (Hardpan)', inputOf('Base ceiling', 40), { unit: 'points' })
    .add(`Stage (level ${String(stage)} × 1.5)`, stage * 1.5)
    .add(`Camera (level ${String(camera)} × 2)`, camera * 2)
    .add(`Editing (level ${String(editing)} × 1.5)`, editing * 1.5)
    .add(`Pyro (level ${String(pyro)} × 1)`, pyro)
    .clamp(0, 100, 'A show score never goes past 100')
    .done();
}

function popularityCeiling(marketing: number, backOffice: number): Traced<number> {
  return startCalc('Popularity ceiling (Hardpan)', inputOf('Base ceiling', 20), { unit: 'points' })
    .add(`Marketing (level ${String(marketing)} × 6)`, marketing * 6)
    .add(`Back office (level ${String(backOffice)} × 4)`, backOffice * 4)
    .clamp(0, 100)
    .done();
}

function showCeilingLine(ceiling: Traced<number>): ProductionEffectLine {
  return {
    id: 'cardFlow.showCeiling',
    label: 'Show quality ceiling',
    value: ceiling.value,
    unit: 'points',
    text: `Shows can score up to ${String(ceiling.value)} (90 earns an extra main-card slot)`,
    trace: ceiling.trace,
  };
}

function popularityLine(ceiling: Traced<number>): ProductionEffectLine {
  return {
    id: 'production.popularityCeiling',
    label: 'Popularity ceiling',
    value: ceiling.value,
    unit: 'points',
    text: `Popularity above ${String(ceiling.value)} slowly falls back`,
    trace: ceiling.trace,
  };
}

const TV_MINIMUM_LINE: ProductionEffectLine = {
  id: 'production.tvCameraMinimum',
  label: 'Camera minimum',
  value: 3,
  unit: 'level',
  text: 'TV deal with Channel 9: camera stays at 3 or higher',
  trace: null,
};

/** Hardpan's levels for the gallery: stage 2, camera 2, editing 1, pyro 0, marketing 3, … */
const LEVELS = {
  stage: 2,
  camera: 2,
  editing: 1,
  pyro: 0,
  music: 1,
  writing: 1,
  marketing: 3,
  backOffice: 2,
};

function cost(traced: Traced<number>): Pick<ProductionRow, 'cost' | 'costTrace'> {
  return { cost: traced.value, costTrace: traced.trace };
}

const CEILING_NOW = showCeiling(LEVELS.stage, LEVELS.camera, LEVELS.editing, LEVELS.pyro);
const POPULARITY_NOW = popularityCeiling(LEVELS.marketing, LEVELS.backOffice);

/** Camera at 2, a per-show row with the show-quality ceiling. */
export const galleryCameraRow: ProductionRow = {
  area: 'camera',
  label: 'Camera',
  level: LEVELS.camera,
  costKind: 'perShow',
  ...cost(perShowCost('Camera', LEVELS.camera)),
  costBasis: 'per Hardpan Friday (minor)',
  effects: [showCeilingLine(CEILING_NOW)],
  minLevel: 0,
};

/** Camera held at 3 by a TV deal: the floor note and the deal's line. */
export const galleryCameraTvRow: ProductionRow = {
  ...galleryCameraRow,
  level: 3,
  ...cost(perShowCost('Camera', 3)),
  effects: [
    showCeilingLine(showCeiling(LEVELS.stage, 3, LEVELS.editing, LEVELS.pyro)),
    TV_MINIMUM_LINE,
  ],
  minLevel: 3,
};

/** Marketing at 3, a monthly row with the popularity ceiling. */
export const galleryMarketingRow: ProductionRow = {
  area: 'marketing',
  label: 'Marketing',
  level: LEVELS.marketing,
  costKind: 'monthly',
  ...cost(monthlyCost('Marketing', LEVELS.marketing)),
  costBasis: 'a month',
  effects: [popularityLine(POPULARITY_NOW)],
  minLevel: 0,
};

/** Music at 1: nothing uses it yet. */
export const galleryMusicRow: ProductionRow = {
  area: 'music',
  label: 'Music',
  level: LEVELS.music,
  costKind: 'monthly',
  ...cost(monthlyCost('Music', LEVELS.music)),
  costBasis: 'a month',
  effects: [],
  minLevel: 0,
};

/** A rival's stage at 8: the level and its line, no cost. */
export const galleryRivalStageRow: ProductionRow = {
  area: 'stage',
  label: 'Stage',
  level: 8,
  costKind: 'perShow',
  cost: null,
  costTrace: null,
  costBasis: null,
  effects: [showCeilingLine(showCeiling(8, 9, 8, 7))],
  minLevel: 0,
};

function previewRow(
  id: string,
  label: string,
  before: Traced<number>,
  after: Traced<number>,
  unit: string,
): ProductionPreviewRow {
  return { id, label, before: before.value, after: after.value, unit, trace: after.trace };
}

function comingShows(cameraLevel: number): Traced<number> {
  const perShow = perShowCost('Camera', cameraLevel).value;
  const others = 3_200_000;
  return startCalc(
    'Production on the shows in the next 28 days',
    inputOf('Camera on 4 shows', perShow * 4),
    {
      unit: 'money',
    },
  )
    .add('Stage, editing and pyro on 4 shows', others)
    .done();
}

function overheadAt(marketing: number): Traced<number> {
  return startCalc(
    'Monthly overhead',
    inputOf(`Marketing at ${String(marketing)}`, monthlyCost('Marketing', marketing).value),
    {
      unit: 'money',
    },
  )
    .add('Music, writing and back office', 1_500_000)
    .done();
}

/** What changing an area to `to` would do, worked out the gallery's way. */
export function galleryPreviewFor(
  area: Extract<ProductionArea, 'camera' | 'marketing'>,
  from: number,
  to: number,
  refusal: string | null = null,
): ProductionChangePreview {
  const label = area === 'camera' ? 'Camera' : 'Marketing';
  const fee = upgradeFee(label, from, to);
  const rows: ProductionPreviewRow[] =
    area === 'camera'
      ? [
          previewRow(
            'areaCost',
            'Camera per Hardpan Friday (minor)',
            perShowCost('Camera', from),
            perShowCost('Camera', to),
            'money',
          ),
          previewRow(
            'upcomingShows',
            'Production on the shows in the next 28 days',
            comingShows(from),
            comingShows(to),
            'money',
          ),
          previewRow(
            'cardFlow.showCeiling',
            'Show quality ceiling',
            showCeiling(LEVELS.stage, from, LEVELS.editing, LEVELS.pyro),
            showCeiling(LEVELS.stage, to, LEVELS.editing, LEVELS.pyro),
            'points',
          ),
        ]
      : [
          previewRow(
            'areaCost',
            'Marketing a month',
            monthlyCost('Marketing', from),
            monthlyCost('Marketing', to),
            'money/month',
          ),
          previewRow(
            'monthlyOverhead',
            'Monthly overhead',
            overheadAt(from),
            overheadAt(to),
            'money/month',
          ),
          previewRow(
            'popularityCeiling',
            'Popularity ceiling',
            popularityCeiling(from, LEVELS.backOffice),
            popularityCeiling(to, LEVELS.backOffice),
            'points',
          ),
        ];
  const reasons: ProductionChangePreview['reasons'] = [];
  if (refusal !== null) {
    reasons.push({ code: 'production.tvDealCamera', message: refusal });
  } else if (from === to) {
    reasons.push({
      code: 'production.sameLevel',
      message: `${label} is already at level ${String(to)}`,
    });
  }
  return {
    area,
    from,
    to,
    fee: fee.value,
    feeTrace: fee.trace,
    reasons,
    canApply: reasons.length === 0,
    rows,
  };
}
