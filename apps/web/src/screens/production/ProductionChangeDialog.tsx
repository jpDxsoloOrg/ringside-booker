import { useState } from 'react';
import { cents, PRODUCTION_LEVEL_MAX } from '@ringside/engine';
import type {
  ProductionArea,
  ProductionChangePreview,
  ProductionPreviewRow,
  PromotionId,
} from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DeltaChip } from '@/components/DeltaChip';
import { Icon } from '@/components/Icon';
import { LevelStepper } from '@/components/LevelStepper';
import { formatMoney, formatNumber, useMoneyFormatter } from '@/components/format';
import { Explained, formatTraceNumber } from '@/components/Trace';
import { displayUnitOf, isMoneyUnit, queryErrorText } from './productionText';
import styles from './ProductionScreen.module.css';

/** What the fee line says when the change costs nothing. */
export const LOWERING_IS_FREE_TEXT = 'Lowering is free';

/** "Camera: level 2 → 4". */
export function changeTitle(label: string, from: number, to: number): string {
  return `${label}: level ${formatNumber(from)} → ${formatNumber(to)}`;
}

/** "Pay $28,000 and raise", "Raise to 4" (no fee), "Lower to 1", "Keep level 2". */
export function confirmLabelFor(
  from: number,
  to: number,
  fee: number | null,
  money: (amount: number) => string,
): string {
  if (to < from) return `Lower to ${formatNumber(to)}`;
  if (to === from) return `Keep level ${formatNumber(from)}`;
  if (fee !== null && fee > 0) return `Pay ${money(fee)} and raise`;
  return `Raise to ${formatNumber(to)}`;
}

/** The change of one row, signed and in its unit: "+$400", "−2.5". */
function changeText(row: ProductionPreviewRow): string {
  const change = row.after - row.before;
  const unit = displayUnitOf(row.unit);
  const magnitude = formatTraceNumber(Math.abs(change), unit === 'money/month' ? 'money' : unit);
  if (change > 0) return `+${magnitude}`;
  if (change < 0) return `−${magnitude}`;
  return magnitude;
}

export interface PreviewRowsProps {
  readonly rows: readonly ProductionPreviewRow[];
}

/**
 * Every number the change moves, before → after, the after value with its Why?, and a chip for the
 * change: a cost going up is bad (rose), a ceiling going up good (green). Label over values on a
 * phone.
 */
export function PreviewRows({ rows }: PreviewRowsProps) {
  return (
    <dl className={styles['previewRows']}>
      {rows.map((row) => {
        const unit = displayUnitOf(row.unit);
        return (
          <div key={row.id} className={styles['previewRow']} data-row={row.id}>
            <dt className={styles['previewLabel']}>{row.label}</dt>
            <dd className={styles['previewValues']}>
              <span className="tabular">{formatTraceNumber(row.before, unit)}</span>
              <span aria-label="to">→</span>
              <Explained
                value={row.after}
                label={row.label}
                trace={row.trace}
                {...(unit === undefined ? {} : { unit })}
              />
              {row.after === row.before ? (
                <span className={styles['muted']}>No change</span>
              ) : (
                <DeltaChip
                  value={row.after - row.before}
                  display={changeText(row)}
                  goodWhen={isMoneyUnit(row.unit) ? 'down' : 'up'}
                  variant="plain"
                />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export interface ProductionChangeDialogViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Runs the change. Reject (throw) to keep the dialog open with the message. */
  readonly onConfirm: () => Promise<void> | void;
  /** The area's name, such as "Camera". */
  readonly label: string;
  /** The level today. */
  readonly from: number;
  /** The level asked about. */
  readonly to: number;
  /** The lowest level the stepper offers: the TV floor for camera, 0 otherwise. */
  readonly minLevel: number;
  /** Why the stepper stops at `minLevel` above 0. */
  readonly minReason?: string;
  /** The engine's answer for `to`, or null before the first one. */
  readonly preview: ProductionChangePreview | null;
  /** True while the answer for `to` is on its way (the shown one may be for another level). */
  readonly loading: boolean;
  /** Why the engine could not preview the change at all, when it could not. */
  readonly failure?: string | null;
  readonly onLevelChange: (level: number) => void;
}

/** One refusal as the dialog shows it: the engine's `Reason` has these and more. */
interface RefusalLine {
  readonly code: string;
  readonly message: string;
}

/** The engine's refusals, in place, before anything is confirmed. */
function Refusals({ reasons }: { readonly reasons: readonly RefusalLine[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className={styles['refusals']}>
      <Icon name="warning" decorative />
      <ul>
        {reasons.map((reason) => (
          <li key={`${reason.code}:${reason.message}`}>{reason.message}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The change dialog as the engine's preview draws it, without asking the engine: the proposed
 * level (adjustable here), the one-time fee with its Why? or "Lowering is free", every number
 * before → after, and the refusals. The confirm waits for the preview and for `canApply`.
 */
export function ProductionChangeDialogView({
  open,
  onClose,
  onConfirm,
  label,
  from,
  to,
  minLevel,
  minReason,
  preview,
  loading,
  failure = null,
  onLevelChange,
}: ProductionChangeDialogViewProps) {
  const current = preview !== null && preview.to === to && !loading ? preview : null;
  // The payment in full ("Pay $28,000 and raise"), whatever the money style: it is a price.
  const money = (amount: number): string => formatMoney(cents(amount));
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={changeTitle(label, from, to)}
      confirmLabel={confirmLabelFor(from, to, current?.fee ?? null, money)}
      confirmDisabled={current?.canApply !== true}
      body={
        <div className={styles['dialogBody']}>
          <LevelStepper
            label={label}
            level={to}
            min={minLevel}
            max={PRODUCTION_LEVEL_MAX}
            {...(minReason === undefined ? {} : { minReason })}
            onRequestChange={onLevelChange}
            className={styles['dialogStepper']}
          />
          {to <= from ? (
            <p className={styles['fee']}>{LOWERING_IS_FREE_TEXT}</p>
          ) : (
            <p className={styles['fee']}>
              <span>One-time fee</span>
              {current === null ? (
                <span className={styles['muted']}>Working it out…</span>
              ) : (
                <Explained
                  value={current.fee}
                  unit="money"
                  label={`${label} upgrade fee`}
                  trace={current.feeTrace}
                />
              )}
            </p>
          )}
          {failure !== null && <Refusals reasons={[{ code: 'previewFailed', message: failure }]} />}
          {preview === null ? (
            failure === null && (
              <p className={styles['muted']} role="status">
                Working out what changes…
              </p>
            )
          ) : (
            <div className={loading ? styles['stale'] : undefined}>
              {preview.rows.length > 0 && <PreviewRows rows={preview.rows} />}
              <Refusals reasons={preview.reasons} />
            </div>
          )}
        </div>
      }
    />
  );
}

export interface ProductionChangeDialogProps {
  readonly promotionId: PromotionId;
  readonly area: ProductionArea;
  readonly label: string;
  /** The level today. */
  readonly from: number;
  /** The level − or + asked for; the dialog starts there. */
  readonly initialLevel: number;
  readonly minLevel: number;
  readonly minReason?: string;
  readonly onClose: () => void;
}

/**
 * The change dialog for one area: `production.changePreview` for the level shown, and
 * `production.setLevel` on confirm. A refusal keeps it open with the reasons; a change that goes
 * through closes it, and the screen's overview refetches on the new revision. Mount it only while
 * it is open.
 */
export function ProductionChangeDialog({
  promotionId,
  area,
  label,
  from,
  initialLevel,
  minLevel,
  minReason,
  onClose,
}: ProductionChangeDialogProps) {
  const [to, setTo] = useState(initialLevel);
  const preview = useEngineQuery('production.changePreview', { promotionId, area, level: to });
  const setLevel = useEngineCommand('production.setLevel');
  const announce = useAnnounce();
  const formatAmount = useMoneyFormatter();
  const loading = preview.status === 'loading' || preview.isStale;
  const failure = preview.status === 'error' ? queryErrorText(preview.error) : null;

  const confirm = async (): Promise<void> => {
    const result = await setLevel.run({ promotionId, area, level: to });
    if (!result.ok) {
      throw new Error(result.reasons.map((reason) => reason.message).join(' '));
    }
    const { fee } = result.data;
    announce(
      fee > 0
        ? `${label} raised to level ${formatNumber(to)} for ${formatAmount(cents(fee))}`
        : `${label} set to level ${formatNumber(to)}`,
    );
  };

  return (
    <ProductionChangeDialogView
      open
      onClose={onClose}
      onConfirm={confirm}
      label={label}
      from={from}
      to={to}
      minLevel={minLevel}
      {...(minReason === undefined ? {} : { minReason })}
      preview={preview.data ?? null}
      failure={failure}
      loading={loading}
      onLevelChange={setTo}
    />
  );
}
