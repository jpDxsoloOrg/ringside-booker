import { useId, useState } from 'react';
import { isGameDate, PUSH_LABELS, PUSH_LEVELS } from '@ringside/engine';
import type { BrandOption, ContractKind, EmploymentRole, Push } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatGameDate, formatNumber } from '@/components/format';
import { MoneyField } from '@/components/MoneyField';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Switch } from '@/components/Switch';
import { TextField } from '@/components/TextField';
import { EMPLOYMENT_ROLE_LABELS } from '@/screens/promotions/profile/tabs/RosterTab';
import type { ContractMoney } from '../useContractMoney';
import { lengthOptions } from './useNegotiationDraft';
import type { NegotiationDraft } from './useNegotiationDraft';
import styles from './Negotiation.module.css';

/** What an unhonoured perk says beside its disabled switch. */
export const NOT_ENFORCED_TEXT = 'Not enforced by the game yet';

/** The perks the form shows: the two the game honours, then the two it does not yet. */
const PERKS = [
  { key: 'ironClad', label: 'Iron-clad', term: 'perk.ironClad', enforced: true },
  { key: 'travelCovered', label: 'Travel covered', term: 'perk.travelCovered', enforced: true },
  {
    key: 'creativeControl',
    label: 'Creative control',
    term: 'perk.creativeControl',
    enforced: false,
  },
  { key: 'noHouseShows', label: 'No house shows', term: 'perk.noHouseShows', enforced: false },
] as const;

const SHARED_BRAND = 'shared';

export interface OfferFormProps {
  readonly draft: NegotiationDraft;
  readonly money: ContractMoney;
  /** The roles they could be hired in. */
  readonly roles: readonly EmploymentRole[];
  readonly maxLengthMonths: number;
  /** Locks every field while a command is on its way. */
  readonly disabled?: boolean;
}

/** The first error among the given field paths. */
function errorOf(draft: NegotiationDraft, ...fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const error = draft.fieldErrors[field];
    if (error !== undefined) return error;
  }
  return undefined;
}

/**
 * Your offer, every term the engine weighs: kind (options you may not offer say why), exclusive,
 * the money by kind, length, start, brand, role, card position, the perks the game honours and an
 * appearance cap. Each money field shows what they ask beside it; a refused command's reasons
 * appear under the field they are about.
 */
export function OfferForm({
  draft,
  money,
  roles,
  maxLengthMonths,
  disabled = false,
}: OfferFormProps) {
  const { offer, ask } = draft;
  const headingId = useId();
  const [startText, setStartText] = useState<string>(offer.startsOn ?? '');
  const [capText, setCapText] = useState<string>(
    offer.terms.appearanceCap === null ? '' : String(offer.terms.appearanceCap),
  );
  const perAppearance = offer.terms.kind === 'perAppearance';

  const kindOptions: readonly RadioOption<ContractKind>[] = ask.allowedKinds.map((entry) => ({
    value: entry.kind,
    label: entry.label,
    ...(entry.allowed
      ? {}
      : {
          unavailable: true,
          description: entry.reasons.map((reason) => reason.message).join(' '),
        }),
  }));
  const brandOptions: readonly SelectOption[] = [
    { value: SHARED_BRAND, label: 'Shared across every brand' },
    ...ask.brandOptions.map((brand: BrandOption) => ({ value: brand.brandId, label: brand.name })),
  ];
  const roleOptions: readonly SelectOption[] = [...new Set([ask.role, ...roles, offer.role])].map(
    (role) => ({ value: role, label: EMPLOYMENT_ROLE_LABELS[role] }),
  );
  const pushOptions: readonly SelectOption[] = PUSH_LEVELS.map((push) => ({
    value: push,
    label: PUSH_LABELS[push],
  }));
  const lengths: readonly SelectOption[] = lengthOptions(maxLengthMonths, offer.lengthMonths).map(
    (months) => ({ value: String(months), label: `${formatNumber(months)} months` }),
  );
  const askedPerks = new Set(ask.perks.map((perk) => perk.term));
  const exclusiveReason = ask.exclusiveReasons.map((reason) => reason.message).join(' ');

  return (
    <section className={styles['offerForm']} aria-labelledby={headingId}>
      <div className={styles['formHead']}>
        <h3 id={headingId} className={styles['sectionHeading']}>
          Your offer
        </h3>
        <Button variant="secondary" size="sm" onClick={draft.useTheirAsk} disabled={disabled}>
          Use their ask
        </Button>
      </div>
      <RadioGroup
        legend="Kind"
        options={kindOptions}
        value={offer.terms.kind}
        onValueChange={draft.setKind}
        layout="row"
        disabled={disabled}
      />
      {errorOf(draft, 'offer.terms.kind') !== undefined && (
        <p className={styles['fieldError']} role="alert">
          {errorOf(draft, 'offer.terms.kind')}
        </p>
      )}
      <Switch
        label="Exclusive"
        checked={offer.terms.exclusive}
        onCheckedChange={draft.setExclusive}
        disabled={disabled || perAppearance || !ask.exclusiveAllowed}
        description={
          !ask.exclusiveAllowed
            ? exclusiveReason
            : perAppearance
              ? 'Per-appearance deals are never exclusive'
              : 'They work for nobody else while it runs'
        }
      />
      {errorOf(draft, 'offer.terms.exclusive') !== undefined && (
        <p className={styles['fieldError']} role="alert">
          {errorOf(draft, 'offer.terms.exclusive')}
        </p>
      )}
      <div className={styles['moneyRow']}>
        {perAppearance ? (
          <MoneyField
            label="Fee per appearance"
            value={offer.terms.perAppearanceFee}
            onValueChange={(value) => {
              draft.setMoney('perAppearanceFee', value);
            }}
            hint={`They ask ${money(ask.perAppearanceFee.value)}`}
            error={errorOf(draft, 'offer.terms.perAppearanceFee')}
            disabled={disabled}
          />
        ) : (
          <MoneyField
            label="Monthly wage"
            value={offer.terms.monthlyWage}
            onValueChange={(value) => {
              draft.setMoney('monthlyWage', value);
            }}
            hint={`They ask ${money(ask.monthlyWage.value)}`}
            error={errorOf(draft, 'offer.terms.monthlyWage')}
            disabled={disabled}
          />
        )}
        <MoneyField
          label="Signing bonus"
          value={offer.terms.signingBonus}
          onValueChange={(value) => {
            draft.setMoney('signingBonus', value);
          }}
          hint={`They ask ${money(ask.signingBonus.value)}`}
          error={errorOf(draft, 'offer.terms.signingBonus')}
          disabled={disabled}
        />
      </div>
      <div className={styles['selectRow']}>
        <div>
          <Select
            label="Length"
            options={lengths}
            value={String(offer.lengthMonths)}
            onValueChange={(value) => {
              draft.setLength(Number(value));
            }}
            disabled={disabled}
          />
          <p className={styles['fieldHint']}>
            {`They prefer ${formatNumber(ask.preferredLengthMonths.value)} months`}
          </p>
          {errorOf(draft, 'offer.lengthMonths') !== undefined && (
            <p className={styles['fieldError']} role="alert">
              {errorOf(draft, 'offer.lengthMonths')}
            </p>
          )}
        </div>
        <div>
          <Select
            label="Card position"
            options={pushOptions}
            value={offer.push}
            onValueChange={(value) => {
              const push = PUSH_LEVELS.find((level) => level === value);
              if (push !== undefined) draft.setPush(push satisfies Push);
            }}
            disabled={disabled}
          />
          <p className={styles['fieldHint']}>{`Expects ${PUSH_LABELS[ask.expectedPush.value]}`}</p>
        </div>
        <div>
          <Select
            label="Role"
            options={roleOptions}
            value={offer.role}
            onValueChange={(value) => {
              const role = roleOptions.find((option) => option.value === value);
              const picked = [ask.role, ...roles].find((entry) => entry === role?.value);
              if (picked !== undefined) draft.setRole(picked);
            }}
            disabled={disabled}
          />
          {errorOf(draft, 'offer.role') !== undefined && (
            <p className={styles['fieldError']} role="alert">
              {errorOf(draft, 'offer.role')}
            </p>
          )}
        </div>
        <div>
          <Select
            label="Brand"
            options={brandOptions}
            value={offer.brand.kind === 'brand' ? offer.brand.brandId : SHARED_BRAND}
            onValueChange={(value) => {
              const brand = ask.brandOptions.find((option) => option.brandId === value);
              draft.setBrand(
                brand === undefined
                  ? { kind: 'shared' }
                  : { kind: 'brand', brandId: brand.brandId },
              );
            }}
            disabled={disabled}
          />
          {errorOf(draft, 'offer.brand.brandId') !== undefined && (
            <p className={styles['fieldError']} role="alert">
              {errorOf(draft, 'offer.brand.brandId')}
            </p>
          )}
        </div>
      </div>
      <RadioGroup
        legend="Start"
        options={[
          { value: 'asap', label: 'As soon as possible' },
          { value: 'date', label: 'On a date' },
        ]}
        value={offer.startsOn === null && startText === '' ? 'asap' : 'date'}
        onValueChange={(value) => {
          if (value === 'asap') {
            setStartText('');
            draft.setStartsOn(null);
          } else if (startText === '') {
            setStartText(ask.eligibility.earliestStart);
            draft.setStartsOn(ask.eligibility.earliestStart);
          }
        }}
        layout="row"
        disabled={disabled}
      />
      {(offer.startsOn !== null || startText !== '') && (
        <TextField
          label="Start date"
          type="date"
          value={startText}
          min={ask.eligibility.earliestStart}
          pattern="\d{4}-\d{2}-\d{2}"
          placeholder="YYYY-MM-DD"
          onValueChange={(text) => {
            setStartText(text);
            draft.setStartsOn(isGameDate(text) ? text : null);
          }}
          hint={`They can start on ${formatGameDate(ask.eligibility.earliestStart)} at the earliest`}
          error={errorOf(draft, 'offer.startsOn')}
          disabled={disabled}
        />
      )}
      <fieldset className={styles['perksGroup']} disabled={disabled}>
        <legend className={styles['legend']}>Perks</legend>
        {PERKS.map((perk) => {
          const asked = askedPerks.has(perk.term);
          let description: string;
          if (!perk.enforced) description = NOT_ENFORCED_TEXT;
          else if (asked) description = 'They insist on it';
          else description = 'Adds to what the offer is worth to them';
          return (
            <Switch
              key={perk.key}
              label={perk.label}
              checked={perk.enforced && offer.terms.perks[perk.key]}
              onCheckedChange={(on) => {
                if (perk.key === 'ironClad' || perk.key === 'travelCovered')
                  draft.setPerk(perk.key, on);
              }}
              disabled={!perk.enforced}
              description={description}
            />
          );
        })}
      </fieldset>
      <TextField
        label="Most appearances a year"
        value={capText}
        inputMode="numeric"
        placeholder="No cap"
        onValueChange={(text) => {
          setCapText(text);
          const digits = text.replace(/\D/gu, '');
          const cap = digits === '' ? null : Number.parseInt(digits, 10);
          draft.setAppearanceCap(cap === null || cap < 1 ? null : cap);
        }}
        hint={
          ask.appearanceCap === null
            ? 'Leave it empty for no cap'
            : `They agree to ${formatNumber(ask.appearanceCap.value)} at most`
        }
        error={errorOf(draft, 'offer.terms.appearanceCap')}
        disabled={disabled}
      />
    </section>
  );
}
