import { useState } from 'react';
import type { ReactNode } from 'react';
import type { GameDate, SimStatus } from '@ringside/engine';
import { Button, IconButton } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { formatGameDate, formatNumber, useMoneyFormatter } from '@/components/format';
import { Explained, WhyButton } from '@/components/Trace';
import { FanBaseSheet } from './FanBaseSheet';
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
  /** A control under everything else, such as the phone sheet's full-width Fan base button. */
  readonly action?: ReactNode;
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
  action,
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
      {action !== undefined && <span className={styles['chipAction']}>{action}</span>}
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

/** Whose figures these are: the promotion the local seat runs. Long names end in an ellipsis. */
function PromotionChip({ promotion, placement }: PromotionChipProps) {
  return (
    <StatusChip
      label="Promotion"
      placement={placement}
      testId="promotion-chip"
      {...(placement === 'bar' ? { className: styles['promotionChipBar'] ?? '' } : {})}
    >
      <span className={styles['promotionName']} title={promotion.name}>
        {promotion.name}
      </span>
    </StatusChip>
  );
}

function CashChip({ promotion, placement }: PromotionChipProps) {
  const formatMoney = useMoneyFormatter();
  const negative = promotion.cash < 0;
  return (
    <StatusChip label="Cash" placement={placement} testId="cash-chip">
      <span className={styles['cashLine']}>
        <span className={classNames(styles['money'], negative && styles['negative'])}>
          {formatMoney(promotion.cash)}
        </span>
        {promotion.cashTraceRef !== null && (
          <WhyButton
            label="Cash"
            value={promotion.cash}
            unit="money"
            source={{ traceRef: promotion.cashTraceRef }}
          />
        )}
      </span>
    </StatusChip>
  );
}

interface PopularityChipProps extends PromotionChipProps {
  /** Opens the top bar's Fan base sheet; left out, the chip opens a sheet of its own. */
  readonly openFanBase: (() => void) | undefined;
}

/** The label of the bar's Fan base button. */
export const OPEN_FAN_BASE_LABEL = 'Open fan base';

/**
 * The headline popularity (DAY2-02) with its stored Why? and a Fan base button that opens the
 * drill-down sheet; prestige under it. A world with no headline yet (made before DAY2, until its
 * first Monday) keeps today's home-region value and the Why? built on the spot, with no button.
 */
function PopularityChip({ promotion, placement, openFanBase }: PopularityChipProps) {
  const { popularity } = promotion;
  const [ownSheetOpen, setOwnSheetOpen] = useState(false);
  const hasHeadline = popularity.headline !== null;
  const open =
    openFanBase ??
    (() => {
      setOwnSheetOpen(true);
    });

  const value = (
    <Explained
      value={popularity.headline ?? popularity.homeRegion}
      label={popularity.headlineLabel ?? 'Popularity in your home region'}
      unit="points"
      traceRef={popularity.traceRef}
      trace={popularity.traceRef === null ? popularity.trace : null}
    />
  );

  return (
    <StatusChip
      label="Popularity"
      placement={placement}
      testId="popularity-chip"
      secondary={`Prestige ${formatNumber(popularity.prestige)}`}
      {...(hasHeadline && placement === 'sheet'
        ? {
            action: (
              <Button
                variant="secondary"
                size="sm"
                iconStart="map"
                className={styles['fanBaseButton']}
                onClick={open}
              >
                Fan base
              </Button>
            ),
          }
        : {})}
    >
      {hasHeadline && placement === 'bar' ? (
        <span className={styles['popularityLine']}>
          {value}
          <IconButton icon="map" size="sm" label={OPEN_FAN_BASE_LABEL} onClick={open} />
        </span>
      ) : (
        value
      )}
      {hasHeadline && openFanBase === undefined && (
        <FanBaseSheet
          open={ownSheetOpen}
          onClose={() => {
            setOwnSheetOpen(false);
          }}
        />
      )}
    </StatusChip>
  );
}

/** The built-in chips after the date. Each hides itself for a seat with no promotion. */
export const BUILT_IN_STATUS_CHIPS: readonly StatusChipDefinition[] = [
  {
    id: 'shell.promotion',
    order: 5,
    render: ({ status, placement }: StatusChipContext) =>
      status.promotion === null ? null : (
        <PromotionChip promotion={status.promotion} placement={placement} />
      ),
  },
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
    render: ({ status, placement, openFanBase }: StatusChipContext) =>
      status.promotion === null ? null : (
        <PopularityChip
          promotion={status.promotion}
          placement={placement}
          openFanBase={openFanBase}
        />
      ),
  },
];

export interface StatusChipsProps {
  readonly status: SimStatus;
  /** `bar` for the desktop top bar, `sheet` for the phone's status sheet. */
  readonly placement: StatusChipPlacement;
  /** Shown beside the date, such as the autosave's "Saving…". */
  readonly dateTrailing?: ReactNode;
  /**
   * Opens the one Fan base sheet the top bar keeps. Left out (tests, the gallery), the popularity
   * chip opens a sheet of its own.
   */
  readonly onOpenFanBase?: () => void;
}

/**
 * The status at the end of the top bar: the date and season, the promotion's name, cash and popularity
 * (each with its Why? when the engine has a breakdown), then any chips other systems registered
 * through `registerStatusChip`. Chips with nothing to show (no promotion) are left out.
 */
export function StatusChips({ status, placement, dateTrailing, onOpenFanBase }: StatusChipsProps) {
  const registered = useRegisteredStatusChips();
  const chips = orderStatusChips([...BUILT_IN_STATUS_CHIPS, ...registered]);
  const context: StatusChipContext = {
    status,
    placement,
    ...(onOpenFanBase === undefined ? {} : { openFanBase: onOpenFanBase }),
  };

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
