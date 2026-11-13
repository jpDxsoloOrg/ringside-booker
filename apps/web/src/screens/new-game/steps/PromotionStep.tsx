import { useMemo, useState } from 'react';
import { cents } from '@ringside/engine';
import type { PreviewPromotion, WorldPreview } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { formatNumber, formatPopularity, useMoneyFormatter } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Panel } from '@/components/Panel';
import { Sheet } from '@/components/Sheet';
import { useIsMobile } from '@/styles/useMediaQuery';
import { FieldError } from '../fields/Fields';
import type { WizardIssue } from '../issues';
import { fieldMessage } from '../issues';
import { codeLabel } from '../labels';
import type { FoundFormValues, PlayerDraft } from '../useNewGameDraft';
import { FoundPromotionForm } from './FoundPromotionForm';
import styles from './Steps.module.css';

export interface PromotionStepProps {
  readonly preview: WorldPreview;
  readonly player: PlayerDraft;
  readonly issues: readonly WizardIssue[];
  readonly onChoosePromotion: (promotionKey: string) => void;
  readonly onFoundMode: (founding: boolean) => void;
  readonly onFoundChange: (changes: Partial<FoundFormValues>) => void;
}

/** A promotion's logo: the placeholder art seeded from its key, until real logos arrive. */
function PromotionLogo({
  promotion,
  size,
}: {
  readonly promotion: Pick<PreviewPromotion, 'key' | 'name' | 'shortName'>;
  readonly size: 'sm' | 'md' | 'lg';
}) {
  return (
    <ImageSlot
      subject={{
        kind: 'promotion',
        id: promotion.key,
        name: promotion.name,
        shortName: promotion.shortName,
      }}
      size={size}
      decorative
    />
  );
}

function promotionColumns(formatMoney: MoneyFormatter): ColumnDef<PreviewPromotion>[] {
  return [
    {
      id: 'logo',
      header: 'Logo',
      cell: (row) => <PromotionLogo promotion={row} size="sm" />,
      card: 'media',
      width: 'xs',
      hideable: false,
    },
    {
      id: 'name',
      header: 'Promotion',
      cell: (row) => (
        <span className={styles['nameCell']}>
          <span className={styles['nameMain']}>{row.name}</span>
          <span className={styles['nameSub']}>{row.shortName}</span>
        </span>
      ),
      sortValue: (row) => row.name,
      card: 'title',
    },
    {
      id: 'home',
      header: 'Home',
      cell: (row) => `${row.homeRegion.name}, ${row.homeCountry.name}`,
      sortValue: (row) => `${row.homeCountry.name} ${row.homeRegion.name}`,
      card: 'subtitle',
    },
    {
      id: 'style',
      header: 'Style',
      cell: (row) => codeLabel(row.style),
      sortValue: (row) => row.style,
      card: 'meta',
    },
    {
      id: 'cash',
      header: 'Cash',
      cell: (row) => formatMoney(cents(row.cash), { style: 'compact' }),
      sortValue: (row) => row.cash,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'roster',
      header: 'Roster',
      cell: (row) => formatNumber(row.rosterSize),
      sortValue: (row) => row.rosterSize,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'titles',
      header: 'Titles',
      cell: (row) => formatNumber(row.titleCount),
      sortValue: (row) => row.titleCount,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'popularity',
      header: 'Home popularity',
      cardLabel: 'Popularity',
      cell: (row) => formatPopularity(row.homeCountryPopularity),
      sortValue: (row) => row.homeCountryPopularity,
      numeric: true,
      card: 'stat',
    },
  ];
}

interface PromotionDetailsProps {
  readonly promotion: PreviewPromotion;
  readonly preview: WorldPreview;
}

/** Brands, titles and the best-known wrestlers of one promotion. */
function PromotionDetails({ promotion, preview }: PromotionDetailsProps) {
  const formatMoney = useMoneyFormatter();
  const workers = preview.topWorkers.filter(
    (worker) => worker.promotionShortName === promotion.shortName,
  );
  return (
    <div className={styles['detail']}>
      <div className={styles['detailHeader']}>
        <PromotionLogo promotion={promotion} size="lg" />
        <div className={styles['detailName']}>
          <p className={styles['detailTitle']}>{promotion.name}</p>
          <p className={styles['nameSub']}>
            {codeLabel(promotion.style)} · {promotion.homeRegion.name}, {promotion.homeCountry.name}
          </p>
        </div>
      </div>
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Cash</dt>
          <dd className={styles['factValue']}>{formatMoney(cents(promotion.cash))}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Prestige</dt>
          <dd className={styles['factValue']}>{formatNumber(promotion.prestige)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Roster</dt>
          <dd className={styles['factValue']}>{formatNumber(promotion.rosterSize)}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Titles</dt>
          <dd className={styles['factValue']}>{formatNumber(promotion.titleCount)}</dd>
        </div>
      </dl>
      <div>
        <h3 className={styles['subheading']}>Brands</h3>
        {promotion.brands.length === 0 ? (
          <p className={styles['status']}>One show brand under the promotion’s own name.</p>
        ) : (
          <ul className={styles['chipList']}>
            {promotion.brands.map((brand) => (
              <li key={brand.key}>
                <Badge tone="data">{brand.name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className={styles['subheading']}>Best-known wrestlers</h3>
        {workers.length === 0 ? (
          <p className={styles['status']}>None of the world’s best-known names work here yet.</p>
        ) : (
          <ul className={styles['workerList']}>
            {workers.map((worker) => (
              <li key={worker.key} className={styles['workerRow']}>
                <ImageSlot
                  subject={{ kind: 'person', id: worker.key, name: worker.ringName }}
                  size="sm"
                  decorative
                />
                <span className={styles['workerText']}>
                  <span className={styles['workerName']}>{worker.ringName}</span>
                  <span className={styles['workerMeta']}>
                    {codeLabel(worker.style)} · age {formatNumber(worker.age)}
                    {worker.popularitySummary.bestCountry !== null &&
                      ` · ${formatPopularity(worker.popularitySummary.bestCountryPopularity)} in ${worker.popularitySummary.bestCountry.name}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Step 2: the promotion to run. A sortable table of the world's promotions (stacked cards on a
 * phone) with the chosen one's brands, titles and best-known wrestlers beside it, or a form to
 * found a promotion of your own.
 */
export function PromotionStep({
  preview,
  player,
  issues,
  onChoosePromotion,
  onFoundMode,
  onFoundChange,
}: PromotionStepProps) {
  const isMobile = useIsMobile();
  const formatMoney = useMoneyFormatter();
  const columns = useMemo(() => promotionColumns(formatMoney), [formatMoney]);
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);

  if (player.mode === 'found') {
    return (
      <div className={styles['step']}>
        <div className={styles['foundCallout']}>
          <div className={styles['foundCalloutText']}>
            <p className={styles['foundCalloutTitle']}>Founding your own promotion</p>
            <p className={styles['status']}>
              You start small, with no roster: sign wrestlers from the free agents.
            </p>
          </div>
          <Button
            iconStart="back"
            onClick={() => {
              onFoundMode(false);
            }}
          >
            Choose an existing promotion
          </Button>
        </div>
        <FoundPromotionForm
          preview={preview}
          values={player.found}
          issues={issues}
          onChange={onFoundChange}
        />
      </div>
    );
  }

  const chosen = preview.promotions.find((row) => row.key === player.promotionKey) ?? null;
  const inspected = preview.promotions.find((row) => row.key === inspectedKey) ?? null;

  return (
    <div className={styles['step']}>
      <div className={styles['foundCallout']}>
        <div className={styles['foundCalloutText']}>
          <p className={styles['foundCalloutTitle']}>Start from nothing</p>
          <p className={styles['status']}>
            Name it, pick a home and a size, and build a roster from nothing.
          </p>
        </div>
        <Button
          variant="primary"
          iconStart="add"
          onClick={() => {
            onFoundMode(true);
          }}
        >
          Found your own promotion
        </Button>
      </div>
      <p className={styles['lead']}>Or take over one of the promotions already running.</p>
      <div className={styles['promotionLayout']}>
        <DataTable
          rows={preview.promotions}
          columns={columns}
          getRowId={(row) => row.key}
          caption="Promotions in this world"
          initialSort={null}
          selectedRowId={isMobile ? (inspectedKey ?? player.promotionKey) : player.promotionKey}
          onSelect={(row) => {
            if (isMobile) {
              setInspectedKey(row.key);
            } else {
              onChoosePromotion(row.key);
            }
          }}
          onActivate={(row) => {
            if (isMobile) setInspectedKey(row.key);
          }}
        />
        <FieldError id="promotion-step-error" message={fieldMessage(issues, 'promotionKey')} />
        {!isMobile && chosen !== null && (
          <Panel title={`About ${chosen.name}`} headingLevel={3}>
            <PromotionDetails promotion={chosen} preview={preview} />
          </Panel>
        )}
      </div>
      {isMobile && (
        <Sheet
          open={inspected !== null}
          onClose={() => {
            setInspectedKey(null);
          }}
          title={inspected?.name ?? 'Promotion'}
          side="bottom"
          footer={
            inspected === null ? undefined : (
              <Button
                variant="primary"
                onClick={() => {
                  onChoosePromotion(inspected.key);
                  setInspectedKey(null);
                }}
              >
                Choose this promotion
              </Button>
            )
          }
        >
          {inspected !== null && <PromotionDetails promotion={inspected} preview={preview} />}
        </Sheet>
      )}
    </div>
  );
}
