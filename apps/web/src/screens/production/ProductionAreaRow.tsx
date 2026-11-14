import { useId } from 'react';
import type { ProductionArea, ProductionEffectLine, ProductionRow } from '@ringside/engine';
import { LevelStepper } from '@/components/LevelStepper';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import { Explained, WhyButton } from '@/components/Trace';
import { formatNumber } from '@/components/format';
import { displayUnitOf } from './productionText';
import styles from './ProductionScreen.module.css';

/** What an area with no registered effect says. */
export const NO_EFFECT_TEXT = 'No effect yet';
/** Why it says so, in visible words beside it. */
export const NO_EFFECT_REASON = 'Nothing uses this area yet; it only costs money.';

/** "Can't go below level 3 while your TV deal with Channel 9 runs". */
export function tvFloorText(minLevel: number, networkName: string | null): string {
  const deal = networkName === null ? 'your TV deal' : `your TV deal with ${networkName}`;
  return `Can't go below level ${formatNumber(minLevel)} while ${deal} runs`;
}

export interface ProductionEffectLinesProps {
  readonly effects: readonly ProductionEffectLine[];
}

/** What the level does, line by line, each with its Why? when it has one. */
export function ProductionEffectLines({ effects }: ProductionEffectLinesProps) {
  if (effects.length === 0) {
    return (
      <p className={styles['noEffect']}>
        <span className={styles['noEffectLabel']}>{NO_EFFECT_TEXT}.</span> {NO_EFFECT_REASON}
      </p>
    );
  }
  return (
    <ul className={styles['effects']}>
      {effects.map((line) => {
        const unit = displayUnitOf(line.unit);
        return (
          <li key={line.id} className={styles['effect']}>
            <span>{line.text}</span>
            {line.trace !== null && line.value !== null && (
              <WhyButton
                label={line.label}
                value={line.value}
                source={{ trace: line.trace }}
                className={styles['effectWhy'] ?? ''}
                {...(unit === undefined ? {} : { unit })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface ProductionAreaRowProps {
  readonly row: ProductionRow;
  /**
   * True on the player's own production: − / + and the cost show. False for a rival's (AIP1/AIP8
   * screens, the gallery): the level and its effect lines only, since its costs are private.
   */
  readonly mine: boolean;
  /** The network of the TV deal that holds the camera up, for the floor note. */
  readonly tvNetworkName?: string | null;
  /** Holds − and + back, for example while a change is on its way. */
  readonly disabled?: boolean;
  /** − or + was pressed: the level one below or above. The screen opens its change dialog. */
  readonly onRequestChange?: (area: ProductionArea, level: number) => void;
}

/**
 * One production area: its name, its level (with − / + on the player's own), what it costs at that
 * level with its basis ("$600 per Hardpan Friday (minor)", "$1,200 a month") and Why?, and what
 * the level does. A list item; on a phone it is a card.
 */
export function ProductionAreaRow({
  row,
  mine,
  tvNetworkName = null,
  disabled = false,
  onRequestChange,
}: ProductionAreaRowProps) {
  const headingId = useId();
  const floorNote = row.minLevel > 0 ? tvFloorText(row.minLevel, tvNetworkName) : null;
  return (
    <li
      className={styles['row']}
      data-read-only={mine ? undefined : true}
      aria-labelledby={headingId}
      data-area={row.area}
    >
      <h3 id={headingId} className={styles['areaName']}>
        {row.label}
      </h3>
      <div className={styles['level']}>
        {mine ? (
          <LevelStepper
            label={row.label}
            level={row.level}
            min={row.minLevel}
            disabled={disabled || onRequestChange === undefined}
            disabledReason="Saving a change"
            {...(floorNote === null ? {} : { minReason: floorNote })}
            onRequestChange={(level) => {
              onRequestChange?.(row.area, level);
            }}
          />
        ) : (
          <SegmentedMeter
            label={`${row.label} level`}
            value={row.level}
            max={10}
            segments={10}
            dangerFrom={11}
            hideLabel
            valueText={`Level ${formatNumber(row.level)} of 10`}
          />
        )}
        {floorNote !== null && <p className={styles['floorNote']}>{floorNote}</p>}
      </div>
      {mine && row.cost !== null && (
        <p className={styles['cost']}>
          <Explained
            value={row.cost}
            unit="money"
            label={`${row.label} ${row.costBasis ?? ''}`.trim()}
            trace={row.costTrace}
          />
          {row.costBasis !== null && <span className={styles['costBasis']}>{row.costBasis}</span>}
        </p>
      )}
      <div className={styles['what']}>
        <ProductionEffectLines effects={row.effects} />
      </div>
    </li>
  );
}

/** The two groups the rows come in, with their headings. */
export const PRODUCTION_GROUPS = [
  { kind: 'perShow', heading: 'On every show', lead: 'Paid on each show night.' },
  { kind: 'monthly', heading: 'Every month', lead: 'Paid on the 1st of each month.' },
] as const;

export interface ProductionAreaListProps {
  readonly rows: readonly ProductionRow[];
  readonly mine: boolean;
  readonly tvNetworkName?: string | null;
  readonly disabled?: boolean;
  readonly onRequestChange?: (area: ProductionArea, level: number) => void;
}

/** Every area, in the engine's order, under "On every show" and "Every month". */
export function ProductionAreaList({
  rows,
  mine,
  tvNetworkName = null,
  disabled = false,
  onRequestChange,
}: ProductionAreaListProps) {
  return (
    <div className={styles['groups']}>
      {PRODUCTION_GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.costKind === group.kind);
        if (groupRows.length === 0) return null;
        return (
          <section key={group.kind} className={styles['group']} aria-label={group.heading}>
            <div className={styles['groupHead']}>
              <h2 className={styles['groupHeading']}>{group.heading}</h2>
              {mine && <p className={styles['muted']}>{group.lead}</p>}
            </div>
            <ul className={styles['rows']}>
              {groupRows.map((row) => (
                <ProductionAreaRow
                  key={row.area}
                  row={row}
                  mine={mine}
                  tvNetworkName={tvNetworkName}
                  disabled={disabled}
                  {...(onRequestChange === undefined ? {} : { onRequestChange })}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
