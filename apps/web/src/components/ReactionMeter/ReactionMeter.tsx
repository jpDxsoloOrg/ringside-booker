import type { OfferBand, OfferThresholds, TraceNode } from '@ringside/engine';
import { classNames } from '../classNames';
import { WhyButton } from '../Trace';
import styles from './ReactionMeter.module.css';

/** The bar runs from nothing to 125% of the ask; an offer above that sits at the right end. */
export const REACTION_METER_MAX = 1.25;

const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 10;

/** One coloured zone of the bar, left to right. */
export interface ReactionZone {
  readonly band: Exclude<OfferBand, 'refuse'>;
  /** The zone's name under the bar: "Walk away", "Reject", "Counter", "Likely". */
  readonly label: string;
  /** Start and end on the 0-100 viewBox. */
  readonly from: number;
  readonly to: number;
}

const ZONE_LABELS: Readonly<Record<ReactionZone['band'], string>> = {
  walkAway: 'Walk away',
  reject: 'Reject',
  counter: 'Counter',
  likely: 'Likely',
};

/** Where a ratio falls on the 0-100 bar, capped at both ends. */
export function reactionMeterPosition(ratio: number): number {
  const safe = Number.isFinite(ratio) ? ratio : 0;
  const capped = Math.min(Math.max(safe, 0), REACTION_METER_MAX);
  return Math.round((capped / REACTION_METER_MAX) * VIEWBOX_WIDTH * 100) / 100;
}

/** The four zones, with boundaries from the preview's thresholds. */
export function reactionZones(thresholds: OfferThresholds): readonly ReactionZone[] {
  const walk = reactionMeterPosition(thresholds.walkAway);
  const counter = reactionMeterPosition(thresholds.counter);
  const accept = reactionMeterPosition(thresholds.accept);
  return [
    { band: 'walkAway', label: ZONE_LABELS.walkAway, from: 0, to: walk },
    { band: 'reject', label: ZONE_LABELS.reject, from: walk, to: counter },
    { band: 'counter', label: ZONE_LABELS.counter, from: counter, to: accept },
    { band: 'likely', label: ZONE_LABELS.likely, from: accept, to: VIEWBOX_WIDTH },
  ];
}

/** "62% of their ask": the marker's position in words. */
export function askShareText(ratio: number): string {
  return `${String(Math.round(Math.max(ratio, 0) * 100))}% of their ask`;
}

export interface ReactionMeterProps {
  /** The offer's value as a share of the ask's (the preview's `ratio`). */
  readonly ratio: number;
  /** The preview's band and its words ("Likely to accept", "Will counter", ...). */
  readonly band: OfferBand;
  readonly label: string;
  /** Where the bands meet (the preview's `thresholds`). */
  readonly thresholds: OfferThresholds;
  /** The reaction's breakdown, for the Why? button. */
  readonly trace?: TraceNode | null;
  /** True while a newer preview is on its way: the meter dims a little, the label stays. */
  readonly pending?: boolean;
  /** Names the meter. "Their likely reaction" by default. */
  readonly name?: string;
  readonly className?: string;
}

/**
 * How a worker would take an offer, as the engine's preview says: a bar with four zones (Walk
 * away, Reject, Counter, Likely) whose boundaries are the preview's thresholds, a marker at the
 * offer's share of the ask (capped at 125%), the label in words and a Why? with the reaction's
 * breakdown. The label sits in a polite live region, so a screen reader hears it change as the
 * offer changes; the marker glides unless motion is reduced. Nothing here works out a reaction:
 * every number comes from `contracts.offerPreview`.
 */
export function ReactionMeter({
  ratio,
  band,
  label,
  thresholds,
  trace,
  pending = false,
  name = 'Their likely reaction',
  className,
}: ReactionMeterProps) {
  const zones = reactionZones(thresholds);
  const marker = reactionMeterPosition(ratio);
  const refused = band === 'refuse';
  const share = askShareText(ratio);
  return (
    <div
      className={classNames(styles['meter'], className)}
      data-band={band}
      data-pending={pending ? 'true' : undefined}
    >
      <div className={styles['head']}>
        <p className={styles['label']} aria-live="polite">
          {label}
        </p>
        {!refused && <span className={classNames(styles['share'], 'tabular')}>{share}</span>}
        {trace !== undefined && trace !== null && (
          <WhyButton
            label={name}
            value={label}
            source={{ trace }}
            buttonLabel={`Why ${label.toLowerCase()}?`}
            panelTitle="Their reaction"
          />
        )}
      </div>
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={REACTION_METER_MAX * 100}
        aria-valuenow={Math.round(Math.min(Math.max(ratio, 0), REACTION_METER_MAX) * 100)}
        aria-valuetext={refused ? label : `${label}, ${share}`}
        className={styles['track']}
      >
        <svg
          className={styles['bar']}
          viewBox={`0 0 ${String(VIEWBOX_WIDTH)} ${String(VIEWBOX_HEIGHT)}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {zones.map((zone) => (
            <rect
              key={zone.band}
              className={classNames(
                styles['zone'],
                styles[`zone-${zone.band}`],
                zone.band === band && styles['current'],
              )}
              x={zone.from}
              y={0}
              width={Math.max(zone.to - zone.from, 0)}
              height={VIEWBOX_HEIGHT}
            />
          ))}
          {!refused && (
            <rect
              className={styles['marker']}
              data-part="marker"
              x={Math.min(Math.max(marker - 0.75, 0), VIEWBOX_WIDTH - 1.5)}
              y={0}
              width={1.5}
              height={VIEWBOX_HEIGHT}
            />
          )}
        </svg>
        <ol className={styles['zones']} aria-hidden="true">
          {zones.map((zone) => (
            <li
              key={zone.band}
              className={classNames(
                styles['zoneLabel'],
                zone.band === band && styles['currentLabel'],
              )}
            >
              {zone.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
