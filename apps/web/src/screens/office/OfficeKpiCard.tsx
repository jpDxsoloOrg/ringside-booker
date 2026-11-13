import { cents } from '@ringside/engine';
import type { OfficeKpi } from '@ringside/engine';
import {
  formatGameDate,
  formatNumber,
  formatPopularity,
  formatPopularityChange,
  formatSigned,
  formatSignedMoney,
  useMoneyFormatter,
} from '@/components/format';
import type { FormatNumberOptions } from '@/components/format';
import type { IconName } from '@/components/Icon';
import { KpiCard } from '@/components/KpiCard';
import type { KpiCardDelta, KpiCardTrend } from '@/components/KpiCard';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import type { TraceDisplayUnit } from '@/components/Trace';
import { useSettingsStore } from '@/app/settings/settingsStore';

/** What a card shows when the engine has no value ("nobody under contract"). */
export const NO_VALUE = '–';

/** What a delta chip says after the change. */
export const DELTA_SUFFIX = 'vs last week';

/** What the sparkline covers, added to the card's label for the line's name. */
export const TREND_PERIOD = 'last 8 weeks';

/** Corner icons for the built-in cards; registered fields go without one. */
const KPI_ICONS: Readonly<Record<string, IconName>> = {
  cash: 'finance',
  'popularity.headline': 'users',
  prestige: 'star',
  rosterSize: 'roster',
  averageMorale: 'office',
};

/**
 * Decimals for each unit: percentages to one place, counts whole, ratios to two. Points
 * (popularity, morale) go through the shared popularity formatter instead, so the card reads
 * exactly as the top bar and the Why? panel do.
 */
function numberOptions(unit: OfficeKpi['unit']): FormatNumberOptions {
  switch (unit) {
    case 'points':
    case 'percent':
      return { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    case 'ratio':
      return { maximumFractionDigits: 2 };
    case 'count':
    case 'money':
      return {};
  }
}

/** A number that is not money, in its unit: `69.3`, `44`, `12.5%`. */
function formatPlain(value: number, unit: OfficeKpi['unit']): string {
  if (unit === 'points') return formatPopularity(value);
  const text = formatNumber(value, numberOptions(unit));
  return unit === 'percent' ? `${text}%` : text;
}

/** A change that is not money, with its sign: `+0.8`, `−2`, `0`. */
function formatPlainChange(value: number, unit: OfficeKpi['unit']): string {
  if (unit === 'points') return formatPopularityChange(value);
  const text = formatSigned(value, numberOptions(unit));
  return unit === 'percent' && text !== '0' ? `${text}%` : text;
}

/** The trace unit the Why? button names the value in. */
function traceUnitOf(unit: OfficeKpi['unit']): TraceDisplayUnit {
  return unit;
}

export interface OfficeKpiCardProps {
  readonly kpi: OfficeKpi;
}

/**
 * One `office.dashboard` KPI as a `KpiCard`: the number in its unit with its Why?, the change since
 * last week with its own Why?, and the last eight weeks as a sparkline once there are two points.
 * A card with no value shows "–" and nothing else to explain.
 */
export function OfficeKpiCard({ kpi }: OfficeKpiCardProps) {
  const formatMoney = useMoneyFormatter();
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  const unit = traceUnitOf(kpi.unit);
  const icon = KPI_ICONS[kpi.key];
  const footer = kpi.footer ?? undefined;

  if (kpi.value === null) {
    return (
      <KpiCard
        label={kpi.label}
        value={NO_VALUE}
        {...(icon === undefined ? {} : { icon })}
        {...(footer === undefined ? {} : { footer })}
      />
    );
  }

  const isMoney = kpi.unit === 'money';
  const format = (value: number): string =>
    isMoney ? formatMoney(cents(Math.round(value))) : formatPlain(value, kpi.unit);
  const formatChange = (value: number): string =>
    isMoney
      ? formatSignedMoney(cents(Math.round(value)), { style: moneyStyle, showPlus: true })
      : formatPlainChange(value, kpi.unit);

  const source = traceSourceOf(kpi.trace, kpi.traceRef);
  const lowerLabel = kpi.label.toLowerCase();

  const delta: KpiCardDelta | undefined =
    kpi.delta === null
      ? undefined
      : {
          value: kpi.delta.value,
          display: formatChange(kpi.delta.value),
          suffix: DELTA_SUFFIX,
          goodWhen: kpi.goodWhen,
          why: (
            <WhyButton
              label={`change in ${lowerLabel}`}
              panelTitle={`Change in ${lowerLabel} since ${formatGameDate(kpi.delta.previousDate, 'dayMonth')}`}
              value={kpi.delta.value}
              unit={unit}
              source={{ trace: kpi.delta.trace }}
            />
          ),
        };

  const trend: KpiCardTrend | undefined =
    kpi.trend.values.length < 2
      ? undefined
      : { values: kpi.trend.values, period: TREND_PERIOD, formatValue: format };

  return (
    <KpiCard
      label={kpi.label}
      value={format(kpi.value)}
      tone={isMoney && kpi.value < 0 ? 'negative' : 'neutral'}
      {...(icon === undefined ? {} : { icon })}
      {...(delta === undefined ? {} : { delta })}
      {...(trend === undefined ? {} : { trend })}
      {...(footer === undefined ? {} : { footer })}
      {...(source === null
        ? {}
        : {
            why: <WhyButton label={kpi.label} value={kpi.value} unit={unit} source={source} />,
          })}
    />
  );
}
