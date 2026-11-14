import { useState } from 'react';
import type { PromotionId, TitleCardRow } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AwardTitleSheetView } from './AwardTitleSheet';
import type { AwardPick } from './AwardTitleSheet';
import { emptyTitleForm, titleFormFromRow } from './titleForm';
import type { TitleFormErrors, TitleFormValues } from './titleForm';
import { TitleFormSheet } from './TitleFormSheet';
import type { TitleFormBrand } from './TitleFormSheet';
import type { OpenTitleAction, TitleActionsState } from './useTitleActions';

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** The champion's name as the confirms say it: the reign's label ("Test Name", a team's name). */
function championName(row: TitleCardRow): string {
  return row.champion?.label ?? 'The champion';
}

/** The confirm's words for vacating, retiring and reactivating a title. */
export function endOrReturnCopy(
  kind: 'vacate' | 'retire' | 'reactivate',
  row: TitleCardRow,
): { title: string; body: string; confirmLabel: string; danger: boolean } {
  switch (kind) {
    case 'vacate':
      return {
        title: `Vacate the ${row.name}?`,
        body: `${championName(row)}'s reign ends today as Vacated.`,
        confirmLabel: 'Vacate',
        danger: true,
      };
    case 'retire':
      return {
        title: `Retire the ${row.name}?`,
        body:
          row.champion === null
            ? 'It moves to Retired. Its lineage is kept, and you can bring it back later.'
            : `It moves to Retired. ${championName(row)}'s reign ends today. Its lineage is kept, and you can bring it back later.`,
        confirmLabel: 'Retire',
        danger: true,
      };
    case 'reactivate':
      return {
        title: `Bring the ${row.name} back?`,
        body: 'It returns vacant. Award it to someone when you are ready.',
        confirmLabel: 'Bring it back',
        danger: false,
      };
  }
}

/** The award confirm's words: who gets it and how the current reign ends. */
export function awardConfirmCopy(
  row: TitleCardRow,
  pick: AwardPick,
): { title: string; body: string } {
  return {
    title: `Award the ${row.name} to ${pick.names}?`,
    body: `${championName(row)}'s reign ends as Stripped.`,
  };
}

interface FormContainerProps {
  readonly open: boolean;
  readonly action: Extract<OpenTitleAction, { kind: 'create' } | { kind: 'edit' }>;
  readonly pending: boolean;
  readonly errors: TitleFormErrors;
  readonly onSubmit: (values: TitleFormValues) => void;
  readonly onClose: () => void;
}

/** The promotion's running brands, plus the title's own when it is no longer running. */
function formBrands(
  running: readonly TitleFormBrand[],
  row: TitleCardRow | null,
): readonly TitleFormBrand[] {
  if (row?.brandId == null || running.some((brand) => brand.brandId === row.brandId)) {
    return running;
  }
  return [
    ...running,
    { brandId: row.brandId, name: `${row.brandName ?? 'Old brand'} (not running)` },
  ];
}

/** The form sheet with the promotion's brands from `promotions.profile`. */
function TitleFormContainer({
  open,
  action,
  pending,
  errors,
  onSubmit,
  onClose,
}: FormContainerProps) {
  const row = action.kind === 'edit' ? action.row : null;
  const promotionId: PromotionId =
    action.kind === 'edit' ? action.row.promotionId : action.promotionId;
  const profile = useEngineQuery('promotions.profile', { promotionId }, { enabled: open });
  const running: readonly TitleFormBrand[] =
    profile.data?.header.brands.map((brand) => ({ brandId: brand.brandId, name: brand.name })) ??
    [];
  const initial = row === null ? emptyTitleForm() : titleFormFromRow(row);
  return (
    <TitleFormSheet
      open={open}
      mode={action.kind}
      initial={initial}
      brands={formBrands(running, row)}
      {...(row === null ? {} : { titleName: row.name, held: row.champion !== null })}
      pending={pending}
      errors={errors}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  );
}

interface AwardContainerProps {
  readonly open: boolean;
  readonly row: TitleCardRow;
  readonly pending: boolean;
  readonly messages: readonly string[];
  readonly onAward: (pick: AwardPick) => void;
  readonly onClose: () => void;
}

/** The award sheet fed by `titles.eligibleHolders`; the switch refetches with the rest. */
function AwardContainer({ open, row, pending, messages, onAward, onClose }: AwardContainerProps) {
  const [includeIneligible, setIncludeIneligible] = useState(false);
  const query = useEngineQuery(
    'titles.eligibleHolders',
    { titleId: row.titleId, includeIneligible },
    { enabled: open },
  );
  return (
    <AwardTitleSheetView
      open={open}
      onClose={onClose}
      titleName={row.name}
      holderCount={row.holderCount}
      holders={query.data ?? null}
      loadError={query.status === 'error' ? errorText(query.error) : null}
      includeIneligible={includeIneligible}
      onIncludeIneligibleChange={setIncludeIneligible}
      pending={pending}
      messages={messages}
      onAward={onAward}
    />
  );
}

/**
 * Draws whatever `useTitleActions` has open: the create or edit sheet, the award sheet with its
 * "strip the champion?" confirm, and the vacate, retire and reactivate confirms. Put it once on a
 * screen that uses the hook.
 */
export function TitleActionOverlays({ actions }: { readonly actions: TitleActionsState }) {
  const { current, last } = actions;
  const kind = current?.kind ?? null;
  const formAction =
    last !== null && (last.kind === 'create' || last.kind === 'edit') ? last : null;
  const rowAction = last !== null && last.kind !== 'create' ? last : null;

  return (
    <>
      {formAction !== null && (
        <TitleFormContainer
          // A new opening (or another title) starts a fresh form and brand query.
          key={formAction.kind === 'edit' ? `edit-${formAction.row.titleId}` : 'create'}
          open={kind === formAction.kind}
          action={formAction}
          pending={actions.formPending}
          errors={actions.formErrors}
          onSubmit={(values) => {
            void actions.submitForm(values);
          }}
          onClose={actions.close}
        />
      )}
      {rowAction?.kind === 'award' && (
        <>
          <AwardContainer
            key={rowAction.row.titleId}
            open={kind === 'award'}
            row={rowAction.row}
            pending={actions.awardPending}
            messages={actions.awardMessages}
            onAward={(pick) => {
              void actions.award(pick);
            }}
            onClose={actions.close}
          />
          <ConfirmDialog
            open={kind === 'award' && actions.awardToConfirm !== null}
            onClose={actions.cancelAwardConfirm}
            onConfirm={actions.confirmAward}
            title={
              actions.awardToConfirm === null
                ? ''
                : awardConfirmCopy(rowAction.row, actions.awardToConfirm).title
            }
            body={
              actions.awardToConfirm === null
                ? ''
                : awardConfirmCopy(rowAction.row, actions.awardToConfirm).body
            }
            confirmLabel="Award"
            tone="danger"
          />
        </>
      )}
      {rowAction !== null &&
        (rowAction.kind === 'vacate' ||
          rowAction.kind === 'retire' ||
          rowAction.kind === 'reactivate') && (
          <EndOrReturnConfirm
            open={kind === rowAction.kind}
            kind={rowAction.kind}
            row={rowAction.row}
            onConfirm={actions.confirmEndOrReturn}
            onClose={actions.close}
          />
        )}
    </>
  );
}

function EndOrReturnConfirm({
  open,
  kind,
  row,
  onConfirm,
  onClose,
}: {
  readonly open: boolean;
  readonly kind: 'vacate' | 'retire' | 'reactivate';
  readonly row: TitleCardRow;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const copy = endOrReturnCopy(kind, row);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      tone={copy.danger ? 'danger' : 'default'}
    />
  );
}
