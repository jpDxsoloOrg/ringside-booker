import { useCallback, useEffect, useMemo, useState } from 'react';
import { askTermsOf, cents } from '@ringside/engine';
import type {
  AskingTermsView,
  ContractKind,
  EmploymentId,
  EmploymentRole,
  GameDate,
  NegotiationId,
  Offer,
  OfferBrand,
  OfferPreview,
  PersonId,
  PromotionId,
  Push,
  Reason,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';

/** How long the draft rests before the meter asks the engine again. */
export const PREVIEW_DEBOUNCE_MS = 250;

/** The lengths the sheet offers, in months, up to `contracts.offer.maxLengthMonths`. */
export const OFFER_LENGTHS = [6, 12, 18, 24, 36, 48, 60] as const;

/** The lengths allowed under the cap, always with the draft's own length among them. */
export function lengthOptions(maxLengthMonths: number, current: number): number[] {
  const allowed = OFFER_LENGTHS.filter((months) => months <= maxLengthMonths);
  const options: number[] = allowed.length === 0 ? [maxLengthMonths] : [...allowed];
  if (!options.includes(current)) options.push(current);
  return options.sort((left, right) => left - right);
}

/** The nearest allowed length to `months`, never above the cap. */
export function nearestLength(months: number, maxLengthMonths: number): number {
  const options = lengthOptions(maxLengthMonths, Math.min(months, maxLengthMonths));
  return options.reduce((best, option) =>
    Math.abs(option - months) < Math.abs(best - months) ? option : best,
  );
}

/** Their ask as an offer: the terms they ask, their preferred length, shared brand, expected push. */
export function offerFromAsk(ask: AskingTermsView, maxLengthMonths: number): Offer {
  return {
    terms: askTermsOf(ask),
    startsOn: null,
    lengthMonths: nearestLength(ask.preferredLengthMonths.value, maxLengthMonths),
    brand: { kind: 'shared' },
    role: ask.role,
    push: ask.expectedPush.value,
    extra: {},
  };
}

/** A copy of an offer the engine handed over (its arrays and objects are read-only there). */
export function copyOffer(offer: Offer): Offer {
  return {
    terms: {
      ...offer.terms,
      shares: { ...offer.terms.shares },
      perks: { ...offer.terms.perks },
    },
    startsOn: offer.startsOn,
    lengthMonths: offer.lengthMonths,
    brand: { ...offer.brand },
    role: offer.role,
    push: offer.push,
    extra: { ...offer.extra },
  };
}

/** Holds a value until it has stopped changing for `delayMs`. */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

/** Who the draft is for. */
export interface NegotiationDraftInput {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
  /** Their ask as first loaded (the default kind): it seeds the draft when `seed` is null. */
  readonly initialAsk: AskingTermsView;
  /** Open talks: the preview weighs the draft as the next round of these. */
  readonly negotiationId?: NegotiationId | undefined;
  /** A renewal of this contract. */
  readonly renewalOf?: EmploymentId | undefined;
  /** Where the draft starts: the last counter, the offer on the table, or null for their ask. */
  readonly seed: Offer | null;
  readonly maxLengthMonths: number;
}

/** The fields the form edits, each setter keeping the rest of the offer as it is. */
export interface NegotiationDraft {
  /** The offer being drafted. */
  readonly offer: Offer;
  /** Their ask for the draft's kind and exclusivity (the last one loaded while a new one loads). */
  readonly ask: AskingTermsView;
  readonly askError: boolean;
  /** The engine's preview of the draft (it lags the typing by `PREVIEW_DEBOUNCE_MS`). */
  readonly preview: OfferPreview | undefined;
  /** True while the preview shown is for an older draft. */
  readonly previewPending: boolean;
  /** Goes up whenever the whole offer is replaced ("Use their ask"), so typed text can reset. */
  readonly version: number;
  /** Command refusals tied to a field, by the field's path (`offer.lengthMonths`). */
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly useTheirAsk: () => void;
  readonly reset: (offer: Offer) => void;
  readonly setKind: (kind: ContractKind) => void;
  readonly setExclusive: (exclusive: boolean) => void;
  readonly setMoney: (
    field: 'monthlyWage' | 'perAppearanceFee' | 'signingBonus',
    value: number,
  ) => void;
  readonly setLength: (months: number) => void;
  readonly setStartsOn: (date: GameDate | null) => void;
  readonly setBrand: (brand: OfferBrand) => void;
  readonly setRole: (role: EmploymentRole) => void;
  readonly setPush: (push: Push) => void;
  readonly setPerk: (perk: 'ironClad' | 'travelCovered', on: boolean) => void;
  readonly setAppearanceCap: (cap: number | null) => void;
  /** Shows a refusal's field reasons under their fields; returns the reasons tied to no field. */
  readonly showRefusal: (reasons: readonly Reason[]) => Reason[];
}

/**
 * The Negotiation Sheet's draft (ECO5-06): every offer field, seeded from the last counter, the
 * offer on the table or their ask, and the engine's preview of it. The preview is asked again
 * once the draft has rested for `PREVIEW_DEBOUNCE_MS`, and the previous answer stays on screen
 * meanwhile, so the meter does not flicker while you type. Nothing here works out a reaction.
 */
export function useNegotiationDraft(input: NegotiationDraftInput): NegotiationDraft {
  const { promotionId, personId, initialAsk, negotiationId, renewalOf, seed, maxLengthMonths } =
    input;
  const [offer, setOffer] = useState<Offer>(() =>
    seed === null ? offerFromAsk(initialAsk, maxLengthMonths) : copyOffer(seed),
  );
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [version, setVersion] = useState(0);

  const askQuery = useEngineQuery(
    'contracts.askingTerms',
    {
      promotionId,
      personId,
      kind: offer.terms.kind,
      exclusive: offer.terms.exclusive,
      ...(renewalOf === undefined ? {} : { renewalOf }),
    },
    { keepPreviousData: true },
  );
  const ask = askQuery.data ?? initialAsk;

  const settled = useDebouncedValue(offer, PREVIEW_DEBOUNCE_MS);
  const previewQuery = useEngineQuery(
    'contracts.offerPreview',
    {
      promotionId,
      personId,
      offer: settled,
      ...(negotiationId === undefined ? {} : { negotiationId }),
      ...(renewalOf === undefined ? {} : { renewalOf }),
    },
    { keepPreviousData: true },
  );
  const preview = previewQuery.data;

  const edit = useCallback((change: (current: Offer) => Offer, field?: string): void => {
    setOffer(change);
    if (field !== undefined) {
      setFieldErrors((current) => {
        if (!(field in current)) return current;
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== field));
      });
    }
  }, []);

  return useMemo<NegotiationDraft>(
    () => ({
      offer,
      ask,
      askError: askQuery.status === 'error',
      preview,
      previewPending:
        offer !== settled || previewQuery.isStale || previewQuery.status === 'loading',
      fieldErrors,
      version,
      useTheirAsk: () => {
        setOffer(offerFromAsk(ask, maxLengthMonths));
        setFieldErrors({});
        setVersion((current) => current + 1);
      },
      reset: (next) => {
        setOffer(copyOffer(next));
        setFieldErrors({});
        setVersion((current) => current + 1);
      },
      setKind: (kind) => {
        edit((current) => {
          const written = kind !== 'perAppearance';
          const wage = ask.monthlyWage.value;
          const fee = ask.perAppearanceFee.value;
          return {
            ...current,
            terms: {
              ...current.terms,
              kind,
              exclusive: written ? current.terms.exclusive : false,
              monthlyWage: cents(written ? wage : 0),
              perAppearanceFee: cents(written ? 0 : fee),
            },
          };
        }, 'offer.terms.kind');
      },
      setExclusive: (exclusive) => {
        edit(
          (current) => ({ ...current, terms: { ...current.terms, exclusive } }),
          'offer.terms.exclusive',
        );
      },
      setMoney: (field, value) => {
        edit(
          (current) => ({ ...current, terms: { ...current.terms, [field]: cents(value) } }),
          `offer.terms.${field}`,
        );
      },
      setLength: (months) => {
        edit((current) => ({ ...current, lengthMonths: months }), 'offer.lengthMonths');
      },
      setStartsOn: (date) => {
        edit((current) => ({ ...current, startsOn: date }), 'offer.startsOn');
      },
      setBrand: (brand) => {
        edit((current) => ({ ...current, brand }), 'offer.brand.brandId');
      },
      setRole: (role) => {
        edit((current) => ({ ...current, role }), 'offer.role');
      },
      setPush: (push) => {
        edit((current) => ({ ...current, push }), 'offer.push');
      },
      setPerk: (perk, on) => {
        edit(
          (current) => ({
            ...current,
            terms: { ...current.terms, perks: { ...current.terms.perks, [perk]: on } },
          }),
          `offer.terms.perks.${perk}`,
        );
      },
      setAppearanceCap: (cap) => {
        edit(
          (current) => ({ ...current, terms: { ...current.terms, appearanceCap: cap } }),
          'offer.terms.appearanceCap',
        );
      },
      showRefusal: (reasons) => {
        const byField: Record<string, string> = {};
        const general: Reason[] = [];
        for (const reason of reasons) {
          if (reason.field === undefined) general.push(reason);
          else byField[reason.field] ??= reason.message;
        }
        setFieldErrors(byField);
        return general;
      },
    }),
    [
      offer,
      ask,
      askQuery.status,
      preview,
      settled,
      previewQuery.isStale,
      previewQuery.status,
      fieldErrors,
      version,
      maxLengthMonths,
      edit,
    ],
  );
}
