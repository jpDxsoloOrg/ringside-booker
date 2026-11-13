/**
 * The money ledger: one row per movement of a promotion's cash.
 *
 * The ledger is append-only. A mistake is corrected by a new entry, never by editing an old one,
 * so the history always reconciles. Amounts are signed by category: income categories are
 * positive and cost categories negative, so the sum of a promotion's entries over a period is its
 * cash change over that period. Zero-amount entries are refused; they would only add noise. Rows
 * older than `history.keepDetailDays` are rolled up into the promotion's monthly totals
 * (`ledgerMonths`) and then deleted (POL4-08), so rows plus roll-ups still reconcile with cash.
 *
 * Only `postMoney` (`systems/finance/post.ts`) writes rows during play, and it moves the
 * promotion's cash in the same transaction, so the entries always sum to the change in cash. Each
 * row carries the `traceRef` of its Why? trace; it is null only for rows written before the finance
 * system existed (test fixtures).
 *
 * The category set is complete for the whole economy epic, so later features never change the enum.
 * The categories added with the finance system and who posts them:
 *
 * - `charity`: charity shows and donations (ECO2).
 * - `networkUpkeep`: running a streaming network (ECO10).
 * - `buyout`: buying out a contract or a rival promotion (ECO9).
 * - `subsidy`: money a parent promotion pays to support a territory (ECO9, ECO11).
 * - `subsidyIncome`: the same money received by the territory (ECO9, ECO11).
 *
 * Roll-ups and finance reports belong to the economy systems.
 */

import { z } from 'zod';
import type { Cents } from '../../core/money';
import { TraceRefSchema } from '../../core/trace/store';
import { zCents, zGameDate, zId, zPositiveInt, zYearMonth } from '../primitives';
import { defineTable } from '../table-def';

export const LEDGER_INCOME_CATEGORIES = [
  'tickets',
  'liveMerch',
  'merch',
  'broadcast',
  'ppv',
  'streaming',
  'sponsorship',
  'otherIncome',
  'subsidyIncome',
] as const;

export const LEDGER_COST_CATEGORIES = [
  'wages',
  'appearanceFees',
  'signingBonuses',
  'severance',
  'venueRent',
  'production',
  'travel',
  'marketing',
  'backOffice',
  'medical',
  'catering',
  'otherCost',
  'charity',
  'networkUpkeep',
  'buyout',
  'subsidy',
] as const;

export const LEDGER_CATEGORIES = [...LEDGER_INCOME_CATEGORIES, ...LEDGER_COST_CATEGORIES] as const;

export const LedgerCategorySchema = z.enum(LEDGER_CATEGORIES);
export type LedgerCategory = z.infer<typeof LedgerCategorySchema>;

/** The sign every amount in a category must have: +1 for income, -1 for costs. */
export const LEDGER_CATEGORY_SIGN: Readonly<Record<LedgerCategory, 1 | -1>> = Object.freeze({
  tickets: 1,
  liveMerch: 1,
  merch: 1,
  broadcast: 1,
  ppv: 1,
  streaming: 1,
  sponsorship: 1,
  otherIncome: 1,
  subsidyIncome: 1,
  wages: -1,
  appearanceFees: -1,
  signingBonuses: -1,
  severance: -1,
  venueRent: -1,
  production: -1,
  travel: -1,
  marketing: -1,
  backOffice: -1,
  medical: -1,
  catering: -1,
  otherCost: -1,
  charity: -1,
  networkUpkeep: -1,
  buyout: -1,
  subsidy: -1,
});

/** True when `amount` is non-zero and has the sign its category requires. */
export function hasLedgerSign(category: LedgerCategory, amount: Cents): boolean {
  return amount !== 0 && Math.sign(amount) === LEDGER_CATEGORY_SIGN[category];
}

export const LedgerRefsSchema = z.strictObject({
  eventInstanceId: zId('eventInstance').nullable(),
  personId: zId('person').nullable(),
  dealId: zId('deal').nullable(),
});

export type LedgerRefs = z.infer<typeof LedgerRefsSchema>;

export const LedgerEntrySchema = z
  .strictObject({
    id: zId('ledgerEntry'),
    promotionId: zId('promotion'),
    date: zGameDate,
    category: LedgerCategorySchema,
    /** Signed: income positive, costs negative, never zero. */
    amount: zCents,
    memo: z.string().min(1).max(120).nullable(),
    refs: LedgerRefsSchema,
    /**
     * Where the row's Why? trace is stored. Every row `postMoney` writes has one; null only for
     * rows written before the finance system (test fixtures).
     */
    traceRef: TraceRefSchema.nullable(),
  })
  .superRefine((entry, context) => {
    if (entry.amount === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A ledger entry cannot be zero',
        path: ['amount'],
      });
    } else if (!hasLedgerSign(entry.category, entry.amount)) {
      const expected = LEDGER_CATEGORY_SIGN[entry.category] > 0 ? 'positive' : 'negative';
      context.addIssue({
        code: 'custom',
        message: `A ${entry.category} amount must be ${expected}`,
        path: ['amount'],
      });
    }
  });

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/**
 * One month of a promotion's ledger rolled up into totals (POL4-08): the rows dated before the
 * history cutoff are added here by category and deleted, so charts, month totals and the year's
 * profit and loss still add up. A month may be part rolled up and part still in rows; readers add
 * the two (`monthBreakdownOf` in `systems/finance/months.ts`).
 */
export const LedgerMonthSchema = z.strictObject({
  month: zYearMonth,
  /** The rolled-up amount per category; a category with nothing rolled up is left out. */
  byCategory: z.partialRecord(LedgerCategorySchema, zCents),
  /** How many rows went into it. */
  rows: zPositiveInt,
  /** The last day whose rows are in it. */
  through: zGameDate,
});

export type LedgerMonth = z.infer<typeof LedgerMonthSchema>;

/** The `byPromotionMonth` index key for a promotion and a `YYYY-MM` month. */
export function ledgerMonthKey(promotionId: string, yearMonth: string): string {
  return `${promotionId}|${yearMonth}`;
}

export const ledgerEntriesTable = defineTable({
  kind: 'ledgerEntry',
  name: 'ledgerEntries',
  schema: LedgerEntrySchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'refs.eventInstanceId', target: 'eventInstance', nullable: true },
    { path: 'refs.personId', target: 'person', nullable: true },
    { path: 'refs.dealId', target: 'deal', nullable: true },
  ],
  indexes: [
    { name: 'byPromotion', key: (entry) => entry.promotionId },
    /** Key `<promotionId>|<YYYY-MM>`: one promotion's entries for one month. */
    {
      name: 'byPromotionMonth',
      key: (entry) => ledgerMonthKey(entry.promotionId, entry.date.slice(0, 7)),
    },
  ],
  // Rows are never edited; the history roll-up (POL4-08) deletes rows past the detail window once
  // their amounts are in the promotion's `ledgerMonths`.
  appendOnly: 'pruneOnly',
});
