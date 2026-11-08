/**
 * The money ledger: one row per movement of a promotion's cash.
 *
 * The ledger is append-only. A mistake is corrected by a new entry, never by editing or deleting an
 * old one, so the history always reconciles. Amounts are signed by category: income categories are
 * positive and cost categories negative, so the sum of a promotion's entries over a period is its
 * cash change over that period. Zero-amount entries are refused; they would only add noise.
 *
 * Roll-ups and finance reports belong to the economy systems.
 */

import { z } from 'zod';
import type { Cents } from '../../core/money';
import { zCents, zGameDate, zId } from '../primitives';
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
  appendOnly: true,
});
