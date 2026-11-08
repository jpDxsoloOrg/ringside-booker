import type { ReactNode } from 'react';
import type { GameDate, SimStatus } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { formatGameDate, formatNumber, useMoneyFormatter } from '@/components/format';
import { Explained } from '@/components/Trace';
import { orderStatusChips, useRegisteredStatusChips } from './statusChipRegistry';
import type {
  StatusChipContext,
  StatusChipDefinition,
  StatusChipPlacement,
} from './statusChipRegistry';
import styles from './StatusChips.module.css';

/** The seat's promotion at a glance, as `sim.status` gives it. */
type PromotionAtAGlance = NonNullable<SimStatus['promotion']>;

/** "Season 2". */
export function seasonLabel(season: SimStatus['season']): string | null {
  return season === null ? null : `Season ${String(season.number)}`;
}

export interface StatusChipProps {
  readonly label: string;
  readonly placement: StatusChipPlacement;
  /** A line under the value, such as the season under the date. */
  readonly secondary?: ReactNode;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

/**
 * One labelled chip: a small uppercase label over its value. In the phone's status sheet the chips
 * become full-width rows. Registered chips use it too, so they match the built-in ones.
 */
export function StatusChip({
  label,
  placement,
  secondary,
  className,
  testId,
  children,
}: StatusChipProps) {
  return (
    <div
      className={classNames(styles['chip'], styles[`placement-${placement}`], className)}
      data-testid={testId}
    >
      <span className={styles['chipLabel']}>{label}</span>
      <span className={styles['chipValue']}>{children}</span>
      {secondary !== undefined && <span className={styles['chipSecondary']}>{secondary}</span>}
    </div>
  );
}

export interface DateChipProps {
  readonly date: GameDate;
  readonly season: SimStatus['season'];
  readonly placement: StatusChipPlacement;
  /** Shown beside the date, such as the autosave's "Saving…". */
  readonly trailing?: ReactNode;
}

/** The game date, long form, with the season under it. */
export function DateChip({ date, season, placement, trailing }: DateChipProps) {
  const seasonText = seasonLabel(season);
  return (
    <div
      className={classNames(styles['chip'], styles['dateChip'], styles[`placement-${placement}`])}
      data-testid="date-chip"
    >
      <span className={styles['chipLabel']}>Date</span>
      <span className={styles['dateLine']}>
        <time className={styles['chipValue']} dateTime={date}>
          {formatGameDate(date, 'long')}
        </time>
        {trailing}
      </span>
      {seasonText !== null && <span className={styles['chipSecondary']}>{seasonText}</span>}
    </div>
  );
}

interface PromotionChipProps {
  readonly promotion: PromotionAtAGlance;
  readonly placement: StatusChipPlacement;
}

function CashChip({ promotion, placement }: PromotionChipProps) {
  const formatMoney = useMoneyFormatter();
  const negative = promotion.cash < 0;
  return (
    <StatusChip label="Cash" placement={placement} testId="cash-chip">
      <span className={classNames(styles['money'], negative && styles['negative'])}>
        {formatMoney(promotion.cash)}
      </span>
    </StatusChip>
  );
}

function PopularityChip({ promotion, placement }: PromotionChipProps) {
  const { popularity } = promotion;
  return (
    <StatusChip
      label="Popularity"
      placement={placement}
      testId="popularity-chip"
      secondary={`Prestige ${formatNumber(popularity.prestige)}`}
    >
      <Explained
        value={popularity.homeRegion}
        label="Popularity in your home region"
        traceRef={popularity.traceRef}
      />
    </StatusChip>
  );
}

/** The built-in chips after the date. Each hides itself for a seat with no promotion. */
export const BUILT_IN_STATUS_CHIPS: readonly StatusChipDefinition[] = [
  {
    id: 'shell.cash',
    order: 10,
    render: ({ status, placement }: StatusChipContext) =>
      status.promotion === null ? null : (
        <CashChip promotion={status.promotion} placement={placement} />
      ),
  },
  {
    id: 'shell.popularity',
    order: 20,
    render: ({ status, placement }: StatusChipContext) =>
      status.promotion === null ? null : (
        <PopularityChip promotion={status.promotion} placement={placement} />
      ),
  },
];

export interface StatusChipsProps {
  readonly status: SimStatus;
  /** `bar` for the desktop top bar, `sheet` for the phone's status sheet. */
  readonly placement: StatusChipPlacement;
  /** Shown beside the date, such as the autosave's "Saving…". */
  readonly dateTrailing?: ReactNode;
}

/**
 * The status at the end of the top bar: the date and season, the promotion's cash and popularity
 * (each with its Why? when the engine has a breakdown), then any chips other systems registered
 * through `registerStatusChip`. Chips with nothing to show (no promotion) are left out.
 */
export function StatusChips({ status, placement, dateTrailing }: StatusChipsProps) {
  const registered = useRegisteredStatusChips();
  const chips = orderStatusChips([...BUILT_IN_STATUS_CHIPS, ...registered]);
  const context: StatusChipContext = { status, placement };

  return (
    <div
      className={classNames(styles['chips'], styles[`chips-${placement}`])}
      data-testid="status-chips"
    >
      <DateChip
        date={status.date}
        season={status.season}
        placement={placement}
        trailing={dateTrailing}
      />
      {chips.map((chip) => {
        const content = chip.render(context);
        return content === null ? null : (
          <div key={chip.id} className={styles['slot']} data-chip-id={chip.id}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
