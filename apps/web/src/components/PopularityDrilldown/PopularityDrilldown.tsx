import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ContinentId,
  PopularityContinentView,
  PopularityCountryView,
  PopularityRegionView,
  PopularityRollupView,
  RegionId,
  TraceNode,
} from '@ringside/engine';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { Icon } from '../Icon';
import { StatBar } from '../StatBar';
import { Explained, formatTraceValue } from '../Trace';
import type { EntityLinkRenderer } from '../Trace';
import styles from './PopularityDrilldown.module.css';

export interface PopularityDrilldownProps {
  /** The roll-up to draw, as a query returns it (`popularityRollupView` in the engine). */
  readonly rollup: PopularityRollupView;
  /** Whose popularity this is: a person's or a promotion's name. Names the list. */
  readonly subjectName: string;
  /** Draws the names of entities inside the Why? panels. The `EntityLinkContext`'s by default. */
  readonly renderEntityLink?: EntityLinkRenderer;
  /** Continents that start open. None by default. */
  readonly initiallyOpen?: readonly ContinentId[];
  /**
   * Extra figures for a region, drawn after its population (the Fan base sheet's registered
   * columns, DAY2-05). Nothing by default.
   */
  readonly regionExtras?: (regionId: RegionId) => ReactNode;
}

/** A region's extra figures, as `regionExtras` gives them. */
type RegionExtras = PopularityDrilldownProps['regionExtras'];

const POPULARITY_UNIT = 'points';
const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** A population as a short figure: `12.3M people`, `850K people`, `420 people`. */
export function formatPopulation(population: number): string {
  if (population >= MILLION) {
    return `${formatNumber(population / MILLION, { maximumFractionDigits: 1 })}M people`;
  }
  if (population >= THOUSAND) {
    return `${formatNumber(population / THOUSAND)}K people`;
  }
  return `${formatNumber(population)} people`;
}

type RowLevel = 'world' | 'continent' | 'country' | 'region';

interface PlaceRowProps {
  readonly level: RowLevel;
  readonly name: string;
  readonly value: number;
  /** "Popularity in Asia": names the meter and the Why? button. */
  readonly label: string;
  /** The breakdown. A region has none: its value is stored, not worked out. */
  readonly trace?: TraceNode;
  /** A muted figure after the name, such as a region's population. */
  readonly detail?: string;
  /** More figures after the detail, such as a registered fan base column. */
  readonly extras?: ReactNode;
  /** Set on a row that opens: whether it is open, what it controls and how to toggle it. */
  readonly disclosure?: {
    readonly open: boolean;
    readonly controls: string;
    readonly onToggle: () => void;
  };
  readonly renderEntityLink?: EntityLinkRenderer | undefined;
}

/** One line of the drill-down: name (a disclosure button when it opens), bar, value and Why?. */
function PlaceRow({
  level,
  name,
  value,
  label,
  trace,
  detail,
  extras,
  disclosure,
  renderEntityLink,
}: PlaceRowProps) {
  const nameContent: ReactNode = (
    <>
      <span className={styles['name']}>{name}</span>
      {detail !== undefined && <span className={styles['detail']}>{detail}</span>}
      {extras !== undefined && extras !== null && extras !== false && (
        <span className={styles['extras']}>{extras}</span>
      )}
    </>
  );
  return (
    <div className={classNames(styles['row'], styles[`level-${level}`])}>
      {disclosure === undefined ? (
        <span className={styles['place']}>{nameContent}</span>
      ) : (
        <button
          type="button"
          className={classNames(styles['place'], styles['disclosure'])}
          aria-expanded={disclosure.open}
          aria-controls={disclosure.controls}
          onClick={disclosure.onToggle}
        >
          <Icon name="chevron-down" className={styles['chevron']} decorative />
          {nameContent}
        </button>
      )}
      <StatBar className={styles['bar']} label={label} value={value} hideLabel showValue={false} />
      <span className={styles['value']}>
        {trace === undefined ? (
          <span className={classNames(styles['stored'], 'tabular')}>
            {formatTraceValue(value, POPULARITY_UNIT)}
          </span>
        ) : (
          <Explained
            value={value}
            label={label}
            unit={POPULARITY_UNIT}
            trace={trace}
            {...(renderEntityLink === undefined ? {} : { renderEntityLink })}
          />
        )}
      </span>
    </div>
  );
}

interface RegionItemProps {
  readonly region: PopularityRegionView;
  readonly regionExtras: RegionExtras;
}

function RegionItem({ region, regionExtras }: RegionItemProps) {
  return (
    <li className={styles['item']}>
      <PlaceRow
        level="region"
        name={region.name}
        value={region.value}
        label={`Popularity in ${region.name}`}
        detail={formatPopulation(region.population)}
        {...(regionExtras === undefined ? {} : { extras: regionExtras(region.id) })}
      />
    </li>
  );
}

interface CountryItemProps {
  readonly country: PopularityCountryView;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
  readonly regionExtras: RegionExtras;
}

function CountryItem({
  country,
  open,
  onToggle,
  renderEntityLink,
  regionExtras,
}: CountryItemProps) {
  const regionsId = useId();
  return (
    <li className={styles['item']}>
      <PlaceRow
        level="country"
        name={country.name}
        value={country.value}
        label={`Popularity in ${country.name}`}
        trace={country.trace}
        disclosure={{ open, controls: regionsId, onToggle }}
        renderEntityLink={renderEntityLink}
      />
      {open && (
        <ul id={regionsId} className={styles['list']} aria-label={`Regions of ${country.name}`}>
          {country.regions.map((region) => (
            <RegionItem key={region.id} region={region} regionExtras={regionExtras} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface ContinentItemProps {
  readonly continent: PopularityContinentView;
  readonly open: boolean;
  readonly showZero: boolean;
  readonly isOpen: (id: string) => boolean;
  readonly onToggle: (id: string) => void;
  readonly renderEntityLink: EntityLinkRenderer | undefined;
  readonly regionExtras: RegionExtras;
}

function ContinentItem({
  continent,
  open,
  showZero,
  isOpen,
  onToggle,
  renderEntityLink,
  regionExtras,
}: ContinentItemProps) {
  const countriesId = useId();
  const countries = showZero
    ? continent.countries
    : continent.countries.filter((country) => country.value !== 0);
  return (
    <li className={styles['item']}>
      <PlaceRow
        level="continent"
        name={continent.name}
        value={continent.value}
        label={`Popularity in ${continent.name}`}
        trace={continent.trace}
        disclosure={{
          open,
          controls: countriesId,
          onToggle: () => {
            onToggle(continent.id);
          },
        }}
        renderEntityLink={renderEntityLink}
      />
      {open && (
        <ul
          id={countriesId}
          className={styles['list']}
          aria-label={`Countries of ${continent.name}`}
        >
          {countries.map((country) => (
            <CountryItem
              key={country.id}
              country={country}
              open={isOpen(country.id)}
              onToggle={() => {
                onToggle(country.id);
              }}
              renderEntityLink={renderEntityLink}
              regionExtras={regionExtras}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** How many continents and countries sit at 0: the rows the toggle brings back. */
function countPlacesWithNoFans(rollup: PopularityRollupView): number {
  let count = 0;
  for (const continent of rollup.continents) {
    if (continent.value === 0) {
      count += 1;
    }
    count += continent.countries.filter((country) => country.value === 0).length;
  }
  return count;
}

/**
 * A person's or promotion's popularity from the world down: the worldwide figure, a row per
 * continent that opens into its countries, and each country into its regions. Every worked-out
 * figure has a Why? that lists what it is made of, weighted by population; region values are
 * stored, so they have none. Places at 0 stay hidden until asked for, so a local wrestler's list
 * is short.
 */
export function PopularityDrilldown({
  rollup,
  subjectName,
  renderEntityLink,
  initiallyOpen = [],
  regionExtras,
}: PopularityDrilldownProps) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));
  const [showZero, setShowZero] = useState(false);

  const toggle = (id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  };
  const isOpen = (id: string): boolean => openIds.has(id);

  const hiddenCount = countPlacesWithNoFans(rollup);
  const continents = showZero
    ? rollup.continents
    : rollup.continents.filter((continent) => continent.value !== 0);

  return (
    <div
      role="group"
      aria-label={`Popularity of ${subjectName} by place`}
      className={styles['drilldown']}
    >
      <PlaceRow
        level="world"
        name="Worldwide"
        value={rollup.world.value}
        label="Popularity worldwide"
        trace={rollup.world.trace}
        renderEntityLink={renderEntityLink}
      />
      {continents.length === 0 ? (
        <p className={styles['empty']}>{subjectName} has no fans anywhere yet.</p>
      ) : (
        <ul className={styles['list']} aria-label="Continents">
          {continents.map((continent) => (
            <ContinentItem
              key={continent.id}
              continent={continent}
              open={isOpen(continent.id)}
              showZero={showZero}
              isOpen={isOpen}
              onToggle={toggle}
              renderEntityLink={renderEntityLink}
              regionExtras={regionExtras}
            />
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <div className={styles['footer']}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showZero}
            onClick={() => {
              setShowZero((shown) => !shown);
            }}
          >
            {`Show places with no fans (${formatNumber(hiddenCount)})`}
          </Button>
        </div>
      )}
    </div>
  );
}
