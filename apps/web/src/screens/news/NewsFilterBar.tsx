import { NEWS_KIND_LABELS, NEWS_KINDS } from '@ringside/engine';
import type { NewsKind } from '@ringside/engine';
import { Button } from '@/components/Button';
import { classNames } from '@/components/classNames';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Switch } from '@/components/Switch';
import {
  activeNewsFilterCount,
  NEWS_PERIOD_LABELS,
  NEWS_PERIODS,
  NO_NEWS_FILTERS,
} from './newsListParams';
import type { NewsFilters, NewsPeriod } from './newsListParams';
import styles from './NewsScreen.module.css';

const PERIOD_OPTIONS: readonly SelectOption[] = NEWS_PERIODS.map((period) => ({
  value: period,
  label: NEWS_PERIOD_LABELS[period],
}));

function periodOf(value: string): NewsPeriod {
  return NEWS_PERIODS.find((period) => period === value) ?? 'all';
}

export interface NewsFilterBarProps {
  readonly filters: NewsFilters;
  readonly onChange: (filters: NewsFilters) => void;
  /** Whether the viewer runs a promotion: "My promotion only" needs one. */
  readonly hasPromotion: boolean;
  /** `bar` wraps across the page; `sheet` is one column for the phone's bottom sheet. */
  readonly layout?: 'bar' | 'sheet';
}

/**
 * The feed's filters: kinds as toggle chips (none pressed means every kind), the period, and the
 * "My promotion only" and "Front page only" switches. It holds no state: the screen reads the
 * filters from the URL and writes back what it reports.
 */
export function NewsFilterBar({
  filters,
  onChange,
  hasPromotion,
  layout = 'bar',
}: NewsFilterBarProps) {
  const change = (changes: Partial<NewsFilters>): void => {
    onChange({ ...filters, ...changes });
  };
  const toggleKind = (kind: NewsKind): void => {
    const on = filters.kinds.includes(kind);
    change({
      kinds: NEWS_KINDS.filter((each) => (each === kind ? !on : filters.kinds.includes(each))),
    });
  };
  return (
    <div className={classNames(styles['filters'], styles[`filters-${layout}`])}>
      <fieldset className={styles['kinds']}>
        <legend className={styles['fieldLabel']}>Kind</legend>
        <div className={styles['chips']}>
          <Button
            size="sm"
            variant={filters.kinds.length === 0 ? 'primary' : 'secondary'}
            aria-pressed={filters.kinds.length === 0}
            onClick={() => {
              change({ kinds: [] });
            }}
          >
            All kinds
          </Button>
          {NEWS_KINDS.map((kind) => {
            const on = filters.kinds.includes(kind);
            return (
              <Button
                key={kind}
                size="sm"
                variant={on ? 'primary' : 'secondary'}
                aria-pressed={on}
                onClick={() => {
                  toggleKind(kind);
                }}
              >
                {NEWS_KIND_LABELS[kind]}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <div className={styles['otherFilters']}>
        <Select
          label="Period"
          options={PERIOD_OPTIONS}
          value={filters.period}
          onValueChange={(value) => {
            change({ period: periodOf(value) });
          }}
        />
        {hasPromotion && (
          <Switch
            label="My promotion only"
            checked={filters.mine}
            onCheckedChange={(mine) => {
              change({ mine });
            }}
          />
        )}
        <Switch
          label="Front page only"
          checked={filters.frontPageOnly}
          onCheckedChange={(frontPageOnly) => {
            change({ frontPageOnly });
          }}
        />
        {layout === 'bar' && activeNewsFilterCount(filters) > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(NO_NEWS_FILTERS);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
