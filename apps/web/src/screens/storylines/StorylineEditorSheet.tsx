import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAX_STORYLINE_SUMMARY_LENGTH, STORYLINE_NAME_MAX_LENGTH } from '@ringside/engine';
import type {
  BrandId,
  PromotionId,
  Reason,
  StorylineDetail,
  StorylineMemberOption,
} from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { FieldError, TextField } from '@/components/TextField';
import { MemberPicker } from './MemberPicker';
import type { ChosenMember } from './MemberPicker';
import { STORYLINE_WARNINGS_STATE } from './storylineWarnings';
import styles from './StorylineEditor.module.css';

/** The brand choice that means "no brand": the storyline runs across the promotion. */
export const WHOLE_PROMOTION = 'whole';

/** One brand the storyline may run on. */
export interface StorylineBrandChoice {
  readonly brandId: BrandId;
  readonly name: string;
}

/** What the editor edits. */
export interface StorylineEditorValues {
  readonly name: string;
  readonly summary: string;
  readonly brandId: BrandId | null;
  readonly members: readonly ChosenMember[];
}

export const EMPTY_STORYLINE_VALUES: StorylineEditorValues = {
  name: '',
  summary: '',
  brandId: null,
  members: [],
};

export type StorylineEditorMode = 'create' | 'edit';

/** Where each refusal shows: under its field, or above the footer when it names none. */
export interface PlacedReasons {
  readonly name: string | undefined;
  readonly summary: string | undefined;
  readonly brandId: string | undefined;
  readonly members: string | undefined;
  readonly general: readonly string[];
}

function joined(reasons: readonly Reason[]): string | undefined {
  return reasons.length === 0 ? undefined : reasons.map((reason) => reason.message).join(' ');
}

/** Sorts the engine's refusals by field: `members` and `members[2].personId` go to the picker. */
export function placeReasons(reasons: readonly Reason[]): PlacedReasons {
  const byField = (test: (field: string) => boolean): Reason[] =>
    reasons.filter((reason) => reason.field !== undefined && test(reason.field));
  const isMembers = (field: string): boolean => field === 'members' || field.startsWith('members[');
  const known = (field: string | undefined): boolean =>
    field === 'name' ||
    field === 'summary' ||
    field === 'brandId' ||
    (field !== undefined && isMembers(field));
  return {
    name: joined(byField((field) => field === 'name')),
    summary: joined(byField((field) => field === 'summary')),
    brandId: joined(byField((field) => field === 'brandId')),
    members: joined(byField(isMembers)),
    general: reasons.filter((reason) => !known(reason.field)).map((reason) => reason.message),
  };
}

export interface StorylineEditorSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly mode: StorylineEditorMode;
  /** The values the form starts from each time it opens. */
  readonly initial: StorylineEditorValues;
  /** The promotion's active brands, flagship first. No brand choice when empty. */
  readonly brands: readonly StorylineBrandChoice[];
  /** `storylines.memberOptions` (create mode), or null while it loads. */
  readonly memberOptions: readonly StorylineMemberOption[] | null;
  readonly pending: boolean;
  /** The engine's refusals of the last save. */
  readonly reasons: readonly Reason[];
  readonly onSave: (values: StorylineEditorValues) => void;
}

/**
 * The storyline editor as a sheet, with no engine behind it (the gallery draws this): name,
 * summary with a counter, brand when the promotion has brands, and, when creating, the member
 * picker. Refusals that name a field show under it; the others show above the footer.
 */
export function StorylineEditorSheetView({
  open,
  onClose,
  mode,
  initial,
  brands,
  memberOptions,
  pending,
  reasons,
  onSave,
}: StorylineEditorSheetViewProps) {
  const formId = useId();
  const summaryId = useId();
  const summaryCountId = useId();
  const summaryErrorId = useId();
  const brandErrorId = useId();
  const [values, setValues] = useState<StorylineEditorValues>(initial);
  // Start from `initial` each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValues(initial);
  }

  const placed = placeReasons(reasons);
  const brandOptions: SelectOption[] = [
    { value: WHOLE_PROMOTION, label: 'Whole promotion' },
    ...brands.map((brand) => ({ value: brand.brandId, label: brand.name })),
  ];
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSave(values);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'New storyline' : 'Edit storyline'}
      size="md"
      phoneHeight={mode === 'create' ? 'full' : 'auto'}
      footer={
        <div className={styles['footer']}>
          {placed.general.length > 0 && (
            <p role="alert" className={styles['generalError']}>
              {placed.general.join(' ')}
            </p>
          )}
          <div className={styles['footerButtons']}>
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {mode === 'create' ? 'Start storyline' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <form id={formId} className={styles['form']} onSubmit={submit} noValidate>
        <TextField
          label="Name"
          value={values.name}
          onValueChange={(name) => {
            setValues((current) => ({ ...current, name }));
          }}
          maxLength={STORYLINE_NAME_MAX_LENGTH}
          hint={`Up to ${formatNumber(STORYLINE_NAME_MAX_LENGTH)} characters.`}
          error={placed.name}
          autoComplete="off"
          disabled={pending}
        />
        <div className={styles['field']}>
          <label htmlFor={summaryId} className={styles['label']}>
            Summary
          </label>
          <textarea
            id={summaryId}
            className={styles['textarea']}
            value={values.summary}
            maxLength={MAX_STORYLINE_SUMMARY_LENGTH}
            rows={4}
            disabled={pending}
            aria-invalid={placed.summary === undefined ? undefined : true}
            aria-describedby={
              placed.summary === undefined ? summaryCountId : `${summaryCountId} ${summaryErrorId}`
            }
            onChange={(event) => {
              const summary = event.target.value;
              setValues((current) => ({ ...current, summary }));
            }}
          />
          <p id={summaryCountId} className={styles['hint']}>
            {formatNumber(values.summary.length)} of {formatNumber(MAX_STORYLINE_SUMMARY_LENGTH)}{' '}
            characters
          </p>
          <FieldError id={summaryErrorId} message={placed.summary} />
        </div>
        {brands.length > 0 && (
          <div className={styles['field']}>
            <Select
              label="Brand"
              options={brandOptions}
              value={values.brandId ?? WHOLE_PROMOTION}
              disabled={pending}
              onValueChange={(value) => {
                const brand = brands.find((candidate) => candidate.brandId === value);
                setValues((current) => ({ ...current, brandId: brand?.brandId ?? null }));
              }}
            />
            <FieldError id={brandErrorId} message={placed.brandId} />
          </div>
        )}
        {mode === 'create' && (
          <MemberPicker
            options={memberOptions}
            chosen={values.members}
            onChange={(members) => {
              setValues((current) => ({ ...current, members }));
            }}
            error={placed.members}
            disabled={pending}
          />
        )}
      </form>
    </Sheet>
  );
}

/** The promotion's active brands, from `roster.summary`. */
function useBrandChoices(promotionId: PromotionId | null, enabled: boolean) {
  const summary = useEngineQuery('roster.summary', promotionId === null ? {} : { promotionId }, {
    enabled,
  });
  return (summary.data?.promotion?.brands ?? []).map((brand) => ({
    brandId: brand.brandId,
    name: brand.name,
  }));
}

export type StorylineEditorSheetProps =
  | { readonly mode: 'create'; readonly open: boolean; readonly onClose: () => void }
  | {
      readonly mode: 'edit';
      readonly open: boolean;
      readonly onClose: () => void;
      readonly storyline: StorylineDetail;
    };

/**
 * The editor wired to the engine. Create starts a storyline for the seat's promotion with
 * `storylines.create`, then opens its page carrying the engine's warnings; edit sends only the
 * fields that changed with `storylines.edit`.
 */
export function StorylineEditorSheet(props: StorylineEditorSheetProps) {
  const { open, onClose, mode } = props;
  const navigate = useNavigate();
  const seatPromotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  const promotionId = props.mode === 'edit' ? props.storyline.promotionId : seatPromotionId;
  const create = useEngineCommand('storylines.create');
  const edit = useEngineCommand('storylines.edit');
  const [reasons, setReasons] = useState<readonly Reason[]>([]);
  const brands = useBrandChoices(promotionId, open);
  const options = useEngineQuery(
    'storylines.memberOptions',
    promotionId === null ? {} : { promotionId },
    { enabled: open && mode === 'create' },
  );

  const close = (): void => {
    setReasons([]);
    onClose();
  };

  const save = async (values: StorylineEditorValues): Promise<void> => {
    if (props.mode === 'create') {
      if (promotionId === null) return;
      const result = await create.run({
        promotionId,
        name: values.name,
        summary: values.summary,
        brandId: values.brandId,
        members: values.members.map(({ personId, side }) => ({ personId, side })),
      });
      if (!result.ok) {
        setReasons(result.reasons);
        return;
      }
      close();
      navigate(routes.game.storyline(result.data.storylineId), {
        state: {
          [STORYLINE_WARNINGS_STATE]: result.data.warnings.map((warning) => warning.message),
        },
      });
      return;
    }
    const { storyline } = props;
    const changes = {
      ...(values.name === storyline.name ? {} : { name: values.name }),
      ...(values.summary === storyline.summary ? {} : { summary: values.summary }),
      ...(values.brandId === storyline.brandId ? {} : { brandId: values.brandId }),
    };
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    const result = await edit.run({ storylineId: storyline.id, ...changes });
    if (!result.ok) {
      setReasons(result.reasons);
      return;
    }
    close();
  };

  const initial: StorylineEditorValues =
    props.mode === 'edit'
      ? {
          name: props.storyline.name,
          summary: props.storyline.summary,
          brandId: props.storyline.brandId,
          members: [],
        }
      : EMPTY_STORYLINE_VALUES;

  return (
    <StorylineEditorSheetView
      open={open}
      onClose={close}
      mode={mode}
      initial={initial}
      brands={brands}
      memberOptions={options.data?.options ?? null}
      pending={create.pending || edit.pending}
      reasons={reasons}
      onSave={(values) => {
        void save(values);
      }}
    />
  );
}
